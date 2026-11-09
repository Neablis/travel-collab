import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { decodeJwt } from "jose";
import { OAUTH_ACCESS_PREFIX, OAUTH_CODE_PREFIX, OAUTH_REFRESH_PREFIX } from "@tc/contracts";
import { db } from "@/server/db/client";
import { oauthClients, oauthCodes, oauthTokens } from "@/server/db/schema";
import { keyedDigest, keyedDigestCandidates } from "@/server/secrets/keyedDigest";
import { clientPublicKey } from "@/server/cache/keys";
import { getCache } from "@/server/cache/redis";
import { fetchClientKeys, resolveClient, storedClientRowId, type ClientDeps } from "./clients";
import { verifyClientAssertion } from "./clientAssertion";
import { cutOffGrant, grantIsLive, grantOf, grantScopes, mintSecret, type GrantRow } from "./grants";
import { mcpResource, oauthIssuer } from "./metadata";
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

export type TokenErrorCode =
  | "invalid_request"
  | "invalid_client"
  | "invalid_grant"
  | "invalid_scope"
  | "invalid_target"
  | "unsupported_grant_type";

/** RFC 7523 section 2.2: the only assertion type there is here. */
export const CLIENT_ASSERTION_TYPE = "urn:ietf:params:oauth:client-assertion-type:jwt-bearer";

/** What a request carries to prove it is the client it names. */
export interface ClientCredentials {
  clientId?: string;
  clientAssertion?: string;
  clientAssertionType?: string;
}

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

/** How long a CIMD client stays known as public; a day, so a document that turns confidential is read again then at the latest. */
const CLIENT_PUBLIC_TTL_SECONDS = 24 * 60 * 60;

async function knownPublic(clientId: string, deps: ClientDeps): Promise<boolean> {
  return (await (deps.cache ?? getCache()).get<true>(clientPublicKey(clientId))) !== null;
}

/**
 * Poppy 4.1: a CIMD client whose document says `private_key_jwt` is only itself
 * with a client assertion. Such a client's document is read again here (cached
 * for five minutes, fetched on the grant owner's share), so one that went back
 * to `none` is a public client again, and a document that cannot be read fails
 * closed. A client last read as public is not read again for a day: its tokens
 * never depended on its document, and a host that is down or a spent quota must
 * not sign people out of it. Nothing about the method is stored in the database.
 */
async function authenticateClient(
  creds: ClientCredentials & { clientId: string },
  /** Whose fetch quota a document or key-set read is charged to. */
  quotaUserId: string,
  deps: ClientDeps,
): Promise<{ ok: true; confidential: boolean } | { ok: false; outcome: TokenOutcome }> {
  if (!creds.clientId.startsWith("https://")) return { ok: true, confidential: false };
  if (await knownPublic(creds.clientId, deps)) return { ok: true, confidential: false };
  const bad = (description: string) => ({ ok: false as const, outcome: refuse("invalid_client", description) });
  const asked = { userId: quotaUserId, ...deps };
  const resolved = await resolveClient(creds.clientId, asked);
  if (!resolved.ok) return bad("the client's metadata document could not be read");
  const { client } = resolved;
  if (client.authMethod === "none") {
    await (deps.cache ?? getCache()).set(clientPublicKey(creds.clientId), true, CLIENT_PUBLIC_TTL_SECONDS);
    return { ok: true, confidential: false };
  }
  if (creds.clientAssertionType !== CLIENT_ASSERTION_TYPE || !creds.clientAssertion) {
    return bad("this client authenticates with a client_assertion");
  }
  const keys = await fetchClientKeys(client, asked);
  if (!keys.ok) return bad(`the client's keys could not be read: ${keys.detail}`);
  const verified = await verifyClientAssertion(creds.clientAssertion, {
    clientId: client.clientId,
    issuer: oauthIssuer(),
    keys: keys.keys,
    now: deps.now ?? new Date(),
    cache: deps.cache ?? getCache(),
    refetchKeys: async () => {
      const again = await fetchClientKeys(client, asked, { again: true });
      return again.ok ? again.keys : null;
    },
  });
  return verified.ok ? { ok: true, confidential: true } : bad(`the client assertion was refused: ${verified.reason}`);
}

/**
 * A request that carries an assertion is authenticated before any code or
 * token is looked up (Poppy 4.4, and the kit's validator sends a made-up refresh
 * token with a bad assertion and expects `invalid_client`, not `invalid_grant`).
 * No grant is known yet, so the read is charged to the client_id itself, whose
 * share is as small as one person's. `null` when nothing was presented.
 */
async function authenticateFirst(
  creds: ClientCredentials,
  deps: ClientDeps,
): Promise<Awaited<ReturnType<typeof authenticateClient>> | null> {
  const { clientId } = creds;
  if (!clientId?.startsWith("https://")) return null;
  if (creds.clientAssertion === undefined && creds.clientAssertionType === undefined) return null;
  return authenticateClient({ ...creds, clientId }, `cimd-client:${clientId}`, deps);
}

/**
 * Reuse of a spent code or rotated token cuts its grant off, which is only for
 * whoever holds the client's credentials: a copied token presented without them
 * is `invalid_client` and leaves the grant alone (Poppy 4.4). `null` to go on.
 */
async function refuseUnauthenticatedReuse(
  grantId: string,
  creds: ClientCredentials,
  early: Awaited<ReturnType<typeof authenticateFirst>>,
  deps: ClientDeps,
): Promise<TokenOutcome | null> {
  if (early !== null || !creds.clientId) return null;
  const grant = await grantOf(grantId);
  if (grant === null) return null;
  const checked = await authenticateClient({ ...creds, clientId: creds.clientId }, grant.ownerId, deps);
  return checked.ok ? null : checked.outcome;
}

/** `grant_type=authorization_code`. */
export async function exchangeCode(
  input: ClientCredentials & { code?: string; codeVerifier?: string; redirectUri?: string; resource?: string },
  now: Date = new Date(),
  deps: ClientDeps = {},
): Promise<TokenOutcome> {
  if (!input.code || !input.redirectUri || !input.clientId) {
    return refuse("invalid_request", "code, redirect_uri and client_id are required");
  }
  const early = await authenticateFirst(input, { ...deps, now });
  if (early !== null && !early.ok) return early.outcome;
  if (!input.code.startsWith(OAUTH_CODE_PREFIX)) return refuse("invalid_grant", "unknown code");
  const [code] = await db.select().from(oauthCodes).where(inArray(oauthCodes.codeHash, hashesOf(input.code)));
  if (code === undefined) return refuse("invalid_grant", "unknown code");
  if (code.usedAt !== null) {
    const unproven = await refuseUnauthenticatedReuse(code.grantId, input, early, { ...deps, now });
    if (unproven !== null) return unproven;
    await cutOffGrant(code.grantId, "code-reuse", now);
    return refuse("invalid_grant", "the code was already used, so its grant has been revoked");
  }
  if (code.expiresAt.getTime() <= now.getTime()) return refuse("invalid_grant", "the code has expired");
  const checked = await grantFor(code.grantId, input.clientId, input.resource, now);
  if (!checked.ok) return checked.outcome;
  const authenticated = early ?? (await authenticateClient({ ...input, clientId: input.clientId }, checked.grant.ownerId, { ...deps, now }));
  if (!authenticated.ok) return authenticated.outcome;
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

/**
 * `grant_type=refresh_token`. Scopes live on the grant, so a `scope` may only
 * name what the grant holds: Poppy 4.7 forbids granting beyond what was asked,
 * and narrowing a token (4.4's MAY) would need a per-token scope this does not
 * store, so asking for fewer is refused rather than answered with more.
 */
export async function refresh(
  input: ClientCredentials & { refreshToken?: string; resource?: string; scope?: string },
  now: Date = new Date(),
  deps: ClientDeps = {},
): Promise<TokenOutcome> {
  if (!input.refreshToken || !input.clientId) return refuse("invalid_request", "refresh_token and client_id are required");
  const early = await authenticateFirst(input, { ...deps, now });
  if (early !== null && !early.ok) return early.outcome;
  if (!input.refreshToken.startsWith(OAUTH_REFRESH_PREFIX)) return refuse("invalid_grant", "unknown refresh token");
  const [token] = await db
    .select()
    .from(oauthTokens)
    .where(and(inArray(oauthTokens.tokenHash, hashesOf(input.refreshToken)), eq(oauthTokens.kind, "refresh")));
  if (token === undefined) return refuse("invalid_grant", "unknown refresh token");
  if (token.rotatedAt !== null) {
    const unproven = await refuseUnauthenticatedReuse(token.grantId, input, early, { ...deps, now });
    if (unproven !== null) return unproven;
    await cutOffGrant(token.grantId, "refresh-reuse", now);
    return refuse("invalid_grant", "the refresh token was already used, so its grant has been revoked");
  }
  if (token.revokedAt !== null || token.expiresAt.getTime() <= now.getTime()) {
    return refuse("invalid_grant", "the refresh token has been revoked or has expired");
  }
  const checked = await grantFor(token.grantId, input.clientId, input.resource, now);
  if (!checked.ok) return checked.outcome;
  const authenticated = early ?? (await authenticateClient({ ...input, clientId: input.clientId }, checked.grant.ownerId, { ...deps, now }));
  if (!authenticated.ok) return authenticated.outcome;
  // A Personal Agent only (Poppy 4.7); a public client's `scope` was always ignored here.
  if (input.scope !== undefined && authenticated.confidential) {
    const asked = [...new Set(input.scope.split(" ").filter((scope) => scope !== "" && scope !== "offline_access"))].sort();
    const held = [...grantScopes(checked.grant)].sort();
    if (asked.length === 0 || asked.join(" ") !== held.join(" ")) {
      return refuse("invalid_scope", `scope must name exactly what the grant holds: ${held.join(" ")}`);
    }
  }
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

/** Whether a revocation that authenticated as `authenticatedRowId` (or as no CIMD client) may touch this grant's tokens. */
async function mayRevoke(grant: GrantRow, authenticatedRowId: string | null, deps: ClientDeps): Promise<boolean> {
  if (authenticatedRowId !== null) return grant.clientId === authenticatedRowId;
  const [row] = await db.select({ cimdUrl: oauthClients.cimdUrl }).from(oauthClients).where(eq(oauthClients.id, grant.clientId));
  if (row?.cimdUrl == null || (await knownPublic(row.cimdUrl, deps))) return true;
  // A CIMD client that signs in with a key is not revoked by a request that does not
  // sign, and a document that cannot be read is not taken to say it does not: otherwise
  // anyone holding a token could revoke it by waiting out the document's cache.
  const resolved = await resolveClient(row.cimdUrl, { userId: grant.ownerId, ...deps });
  return resolved.ok && resolved.client.authMethod === "none";
}

/** The `iss` of an assertion, unverified: only names who to authenticate it as, and the check that follows decides. */
function assertedClient(assertion: string | undefined): string | undefined {
  if (assertion === undefined) return undefined;
  try {
    return decodeJwt(assertion).iss;
  } catch {
    return undefined;
  }
}

/**
 * RFC 7009. An access token stops on its own; a refresh token takes its grant
 * with it (RFC 7009 section 2.1), since a client revoking one is disconnecting.
 * A secret we do not know is not an error: the answer is the same either way, so
 * it says nothing about which secrets exist.
 *
 * **A `private_key_jwt` client's tokens are revoked by that client alone**
 * (Poppy 4.6). A request naming such a client is authenticated, and refused as
 * `invalid_client` if it does not prove itself; a request that names none
 * leaves its tokens where they are and still answers 200. Both only once a
 * token is found, since the owner of its grant is who the document fetch is
 * charged to.
 */
export async function revokeSecret(
  secret: string,
  now: Date = new Date(),
  creds: ClientCredentials = {},
  deps: ClientDeps = {},
): Promise<{ ok: true } | { ok: false; error: "invalid_client"; description: string }> {
  if (!secret.startsWith(OAUTH_ACCESS_PREFIX) && !secret.startsWith(OAUTH_REFRESH_PREFIX)) return { ok: true };
  const [token] = await db.select().from(oauthTokens).where(inArray(oauthTokens.tokenHash, hashesOf(secret)));
  if (token === undefined) return { ok: true };
  const grant = await grantOf(token.grantId);
  if (grant === null) return { ok: true };
  let authenticated: string | null = null;
  // RFC 7521 4.2: the assertion names the client when `client_id` is left out.
  const clientId = creds.clientId ?? assertedClient(creds.clientAssertion);
  if (creds.clientAssertion !== undefined && !clientId?.startsWith("https://")) {
    return { ok: false, error: "invalid_client", description: "the client assertion names no client_id" };
  }
  if (clientId?.startsWith("https://")) {
    // Not the grant's client: nothing to authenticate and nothing to fetch, so a
    // client_id the caller makes up cannot spend the token owner's fetch quota.
    const named = await storedClientRowId(clientId);
    if (named !== grant.clientId) return { ok: true };
    const checked = await authenticateClient({ ...creds, clientId }, grant.ownerId, { ...deps, now });
    if (!checked.ok) {
      return { ok: false, error: "invalid_client", description: checked.outcome.ok ? "" : checked.outcome.description };
    }
    authenticated = named;
  }
  if (!(await mayRevoke(grant, authenticated, { ...deps, now }))) return { ok: true };
  await db
    .update(oauthTokens)
    .set({ revokedAt: now })
    .where(and(eq(oauthTokens.id, token.id), isNull(oauthTokens.revokedAt)));
  if (token.kind === "refresh") await cutOffGrant(token.grantId, "owner", now);
  return { ok: true };
}
