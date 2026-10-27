import { and, eq, inArray } from "drizzle-orm";
import { OAUTH_ACCESS_PREFIX, type ApiScope } from "@tc/contracts";
import { db } from "@/server/db/client";
import { oauthTokens } from "@/server/db/schema";
import { accountCan } from "@/server/entitlements/resolver";
import { keyedDigestCandidates } from "@/server/secrets/keyedDigest";
import { grantOf, grantScopes } from "./grants";
import { mcpResource } from "./metadata";

// **An OAuth access token, verified on every call** (ADR-083 §7), the way
// `verifyToken` verifies a `tc_` token: everything resolved on read, nothing
// cached, nothing swept. A token is only as alive as its grant, so the grant is
// read here too, and the owner's plan with it.

/** Why an access token was refused. `route()` maps each to a status and a wire code. */
export type AccessRefusal =
  /** No access token carries this digest. Also the answer for a malformed secret. */
  | { reason: "unknown" }
  /** The token itself (RFC 7009), or its grant, was revoked. */
  | { reason: "revoked"; revokedAt: Date }
  /** The token's hour, or its grant's year, ran out. */
  | { reason: "expired"; expiresAt: Date }
  /** Presented outside an MCP dispatch, where its audience is not (`resolveActor`). */
  | { reason: "audience" }
  /** The grant was made for another resource than this server's `/api/mcp` (amendment C). */
  | { reason: "resource" }
  /** Real and live, but its owner's plan no longer grants `api.tokens`. */
  | { reason: "not-entitled"; ownerId: string };

export interface VerifiedAccess {
  grantId: string;
  ownerId: string;
  clientName: string;
  scopes: ReadonlySet<ApiScope>;
}

export type AccessResult = { ok: true; access: VerifiedAccess } | { ok: false; refusal: AccessRefusal };

const refuse = (refusal: AccessRefusal): AccessResult => ({ ok: false, refusal });

export async function verifyAccessToken(secret: string, now: Date = new Date()): Promise<AccessResult> {
  if (!secret.startsWith(OAUTH_ACCESS_PREFIX)) return refuse({ reason: "unknown" });
  const digests = keyedDigestCandidates(secret).map((candidate) => candidate.digest);
  // `kind = 'access'`: a refresh token presented as a bearer is not one.
  const [token] = await db
    .select()
    .from(oauthTokens)
    .where(and(inArray(oauthTokens.tokenHash, digests), eq(oauthTokens.kind, "access")));
  if (token === undefined) return refuse({ reason: "unknown" });
  const grant = await grantOf(token.grantId);
  if (grant === null) return refuse({ reason: "unknown" });

  // **Revoked before expired**, as `verifyToken` orders them. The token's own
  // `revoked_at` is checked as well as the grant's: RFC 7009 revocation of an
  // access token marks the token alone and leaves its grant live.
  const revokedAt = token.revokedAt ?? grant.revokedAt;
  if (revokedAt !== null) return refuse({ reason: "revoked", revokedAt });
  if (token.expiresAt <= now) return refuse({ reason: "expired", expiresAt: token.expiresAt });
  if (grant.expiresAt <= now) return refuse({ reason: "expired", expiresAt: grant.expiresAt });

  // Checked against the grant's own record, not inferred from where the call
  // arrived: a grant made for another deployment's resource is not ours to honour.
  if (grant.resource !== mcpResource()) return refuse({ reason: "resource" });

  // A lapse disables, as it does a `tc_` token: re-subscribing restores the
  // connection with no writes and no new consent.
  if (!(await accountCan(grant.ownerId, "api.tokens", now))) {
    return refuse({ reason: "not-entitled", ownerId: grant.ownerId });
  }
  return {
    ok: true,
    access: {
      grantId: grant.id,
      ownerId: grant.ownerId,
      clientName: grant.clientName,
      scopes: new Set(grantScopes(grant)),
    },
  };
}
