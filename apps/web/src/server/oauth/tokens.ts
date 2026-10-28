import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { OAUTH_ACCESS_PREFIX, OAUTH_CODE_PREFIX, OAUTH_REFRESH_PREFIX } from "@tc/contracts";
import { db } from "@/server/db/client";
import { oauthCodes, oauthTokens } from "@/server/db/schema";
import { keyedDigest, keyedDigestCandidates } from "@/server/secrets/keyedDigest";
import { storedClientRowId } from "./clients";
import { cutOffGrant, grantIsLive, grantOf, grantScopes, mintSecret, type GrantRow } from "./grants";
import { mcpResource } from "./metadata";
import { verifyS256 } from "./pkce";

// **The token endpoint's two grants, and revocation** (ADR-083 §4, RFC 6749
// §4.1.3 and §6, RFC 7009).
//
// **Single use is one statement (amendment D).** A code is spent, and a refresh
// token rotated, by an `UPDATE … WHERE used_at IS NULL RETURNING` (or
// `rotated_at`). The checks before it read the row to answer precisely, but
// only that statement decides who wins: two parallel requests can both pass
// the checks, and exactly one gets a row back. The other has presented a spent
// secret, which is reuse, and reuse revokes the grant (OAuth 2.1 §4.1.3), the
// winner's tokens included.
//
// **No grace window for a rotated refresh token (amendment K).** If the
// response carrying the new one is lost, the client's next refresh presents the
// old one and the grant is revoked; the person consents again. A grace window
// would reopen exactly the reuse rotation exists to catch.

const DAY_MS = 24 * 60 * 60 * 1000;
/** ADR-083 §4. */
export const ACCESS_LIFETIME_MS = 60 * 60 * 1000;
/** Sliding: each rotation starts a new 90 days, never past the grant's year. */
export const REFRESH_LIFETIME_MS = 90 * DAY_MS;

export type TokenErrorCode = "invalid_request" | "invalid_grant" | "invalid_target" | "unsupported_grant_type";

export interface TokenResponse {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
}

export type TokenOutcome = { ok: true; body: TokenResponse } | { ok: false; error: TokenErrorCode; description: string };

const refuse = (error: TokenErrorCode, description: string): TokenOutcome => ({ ok: false, error, description });

/** Every digest a presented secret could be stored under (current pepper, then previous). */
const hashesOf = (secret: string) => keyedDigestCandidates(secret).map((candidate) => candidate.digest);

async function issueTokens(grant: GrantRow, now: Date): Promise<TokenResponse> {
  const access = mintSecret(OAUTH_ACCESS_PREFIX);
  const refresh = mintSecret(OAUTH_REFRESH_PREFIX);
  const refreshExpiry = Math.min(now.getTime() + REFRESH_LIFETIME_MS, grant.expiresAt.getTime());
  const row = (secret: string, kind: "access" | "refresh", expiresAt: Date) => {
    const { digest, keyVersion } = keyedDigest(secret);
    return { id: randomUUID(), tokenHash: digest, keyVersion, grantId: grant.id, kind, createdAt: now, expiresAt };
  };
  await db
    .insert(oauthTokens)
    .values([
      row(access, "access", new Date(now.getTime() + ACCESS_LIFETIME_MS)),
      row(refresh, "refresh", new Date(refreshExpiry)),
    ]);
  return {
    access_token: access,
    token_type: "Bearer",
    expires_in: ACCESS_LIFETIME_MS / 1000,
    refresh_token: refresh,
    scope: grantScopes(grant).join(" "),
  };
}

/**
 * The checks every grant type shares: the grant is live, it was made for the
 * client presenting it, and the `resource` named (if any) is this server's
 * (amendment C).
 */
async function grantFor(
  grantId: string,
  clientId: string,
  resource: string | undefined,
  now: Date,
): Promise<{ ok: true; grant: GrantRow } | { ok: false; outcome: TokenOutcome }> {
  const grant = await grantOf(grantId);
  if (grant === null || !grantIsLive(grant, now)) {
    return { ok: false, outcome: refuse("invalid_grant", "the grant has been revoked or has expired") };
  }
  if ((await storedClientRowId(clientId)) !== grant.clientId) {
    return { ok: false, outcome: refuse("invalid_grant", "this was not issued to that client_id") };
  }
  if ((resource !== undefined && resource !== grant.resource) || grant.resource !== mcpResource()) {
    return { ok: false, outcome: refuse("invalid_target", `the only resource here is ${mcpResource()}`) };
  }
  return { ok: true, grant };
}

/** `grant_type=authorization_code`. */
export async function exchangeCode(
  input: { code?: string; codeVerifier?: string; redirectUri?: string; clientId?: string; resource?: string },
  now: Date = new Date(),
): Promise<TokenOutcome> {
  if (!input.code || !input.redirectUri || !input.clientId) {
    return refuse("invalid_request", "code, redirect_uri and client_id are required");
  }
  if (!input.code.startsWith(OAUTH_CODE_PREFIX)) return refuse("invalid_grant", "unknown code");
  const [code] = await db.select().from(oauthCodes).where(inArray(oauthCodes.codeHash, hashesOf(input.code)));
  if (code === undefined) return refuse("invalid_grant", "unknown code");
  if (code.usedAt !== null) {
    await cutOffGrant(code.grantId, "code-reuse", now);
    return refuse("invalid_grant", "the code was already used, so its grant has been revoked");
  }
  if (code.expiresAt.getTime() <= now.getTime()) return refuse("invalid_grant", "the code has expired");
  const checked = await grantFor(code.grantId, input.clientId, input.resource, now);
  if (!checked.ok) return checked.outcome;
  if (code.resource !== checked.grant.resource) {
    return refuse("invalid_target", `the only resource here is ${mcpResource()}`);
  }
  // Exact: the redirect the code was sent to, as a string (RFC 6749 §4.1.3).
  if (code.redirectUri !== input.redirectUri) return refuse("invalid_grant", "redirect_uri differs from the authorize request's");
  // Amendment I: no code is redeemed without the proof it was issued against.
  // A missing verifier, and a code with no challenge, are both a downgrade.
  if (code.codeChallenge === "" || !input.codeVerifier || !verifyS256(input.codeVerifier, code.codeChallenge)) {
    return refuse("invalid_grant", "code_verifier does not match the code_challenge");
  }
  const [spent] = await db
    .update(oauthCodes)
    .set({ usedAt: now })
    .where(and(eq(oauthCodes.id, code.id), isNull(oauthCodes.usedAt)))
    .returning({ id: oauthCodes.id });
  if (spent === undefined) {
    await cutOffGrant(code.grantId, "code-reuse", now);
    return refuse("invalid_grant", "the code was already used, so its grant has been revoked");
  }
  return { ok: true, body: await issueTokens(checked.grant, now) };
}

/** `grant_type=refresh_token`. `scope` is not read: scopes live on the grant, and a refresh cannot change them. */
export async function refresh(
  input: { refreshToken?: string; clientId?: string; resource?: string },
  now: Date = new Date(),
): Promise<TokenOutcome> {
  if (!input.refreshToken || !input.clientId) return refuse("invalid_request", "refresh_token and client_id are required");
  if (!input.refreshToken.startsWith(OAUTH_REFRESH_PREFIX)) return refuse("invalid_grant", "unknown refresh token");
  const [token] = await db
    .select()
    .from(oauthTokens)
    .where(and(inArray(oauthTokens.tokenHash, hashesOf(input.refreshToken)), eq(oauthTokens.kind, "refresh")));
  if (token === undefined) return refuse("invalid_grant", "unknown refresh token");
  if (token.rotatedAt !== null) {
    await cutOffGrant(token.grantId, "refresh-reuse", now);
    return refuse("invalid_grant", "the refresh token was already used, so its grant has been revoked");
  }
  if (token.revokedAt !== null || token.expiresAt.getTime() <= now.getTime()) {
    return refuse("invalid_grant", "the refresh token has been revoked or has expired");
  }
  const checked = await grantFor(token.grantId, input.clientId, input.resource, now);
  if (!checked.ok) return checked.outcome;
  const [rotated] = await db
    .update(oauthTokens)
    .set({ rotatedAt: now })
    .where(and(eq(oauthTokens.id, token.id), isNull(oauthTokens.rotatedAt)))
    .returning({ id: oauthTokens.id });
  if (rotated === undefined) {
    await cutOffGrant(token.grantId, "refresh-reuse", now);
    return refuse("invalid_grant", "the refresh token was already used, so its grant has been revoked");
  }
  return { ok: true, body: await issueTokens(checked.grant, now) };
}

/**
 * RFC 7009. An access token stops on its own; a refresh token takes its grant
 * with it (RFC 7009 §2.1), since a client revoking one is disconnecting. A
 * secret we do not know is not an error: the answer is the same either way, so
 * it says nothing about which secrets exist.
 */
export async function revokeSecret(secret: string, now: Date = new Date()): Promise<void> {
  if (!secret.startsWith(OAUTH_ACCESS_PREFIX) && !secret.startsWith(OAUTH_REFRESH_PREFIX)) return;
  const [token] = await db.select().from(oauthTokens).where(inArray(oauthTokens.tokenHash, hashesOf(secret)));
  if (token === undefined) return;
  await db
    .update(oauthTokens)
    .set({ revokedAt: now })
    .where(and(eq(oauthTokens.id, token.id), isNull(oauthTokens.revokedAt)));
  if (token.kind === "refresh") await cutOffGrant(token.grantId, "owner", now);
}
