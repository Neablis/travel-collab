import { OAUTH_ACCESS_PREFIX, type ApiScope } from "@tc/contracts";
import { auth } from "@/server/auth";
import { verifyToken, type TokenRefusal } from "@/server/api-tokens";
import { inMcpDispatch } from "@/server/oauth/dispatchContext";
import { verifyAccessToken, type AccessRefusal } from "@/server/oauth/verifyAccess";

// **Who is asking, and by what authority** (M22 Phase 2, Decision 3).
//
// Three credentials, one principal. Everything downstream of this file asks
// "which user" and "what were they granted"; nothing downstream asks "was this
// a cookie or a bearer token" except the rate limiter and `last_used_at`, which
// key on a credential (`credentialKey`) that a session simply does not have.

/**
 * A resolved caller.
 *
 * **A session actor satisfies every scope check.** The frontend acts as the
 * user with the user's full authority, which is exactly what it does today — a
 * cookie is not a narrowed credential and pretending otherwise would mean
 * inventing a scope set for the browser that nothing grants and nothing revokes.
 *
 * **A token actor satisfies only its granted scopes**, and so does an OAuth
 * actor (ADR-083 §7): a `tco_` access token, whose scopes are its grant's and
 * which is always account-wide. All of them then flow into the *existing*
 * authorization seam unchanged, which is gate two.
 */
export type Actor =
  | { userId: string; via: "session" }
  | {
      userId: string;
      via: "token";
      tokenId: string;
      scopes: ReadonlySet<ApiScope>;
      /** `null` is account-wide — every trip the owner can reach, now and later. */
      tripIds: ReadonlySet<string> | null;
    }
  | {
      userId: string;
      via: "oauth";
      grantId: string;
      clientName: string;
      scopes: ReadonlySet<ApiScope>;
      /** A grant is never confined to trips; the field is here so code over the union reads one shape. */
      tripIds: null;
    };

/** Why nobody could be resolved. Mapped to a status and a wire code by `route()`. */
export type ActorRefusal =
  | { reason: "anonymous" }
  | { reason: "token"; refusal: TokenRefusal }
  /** An OAuth access token refused, or presented outside an MCP dispatch (`audience`). */
  | { reason: "oauth"; refusal: AccessRefusal };

export type ActorResolution = { ok: true; actor: Actor } | { ok: false; refusal: ActorRefusal };

// **Case-insensitive, and the token is the non-space run.** RFC 7235 makes the
// auth-scheme case-insensitive, so `bearer tc_…` from a client that lowercases
// its headers is a real credential — and answering it as "anonymous" is the
// 401 an integrator cannot debug, because their token IS valid. `\S+` rather
// than `.+` also stops a trailing space or `\r` riding along into the digest,
// which would fail verification for a reason nothing in the response names.
const BEARER = /^Bearer[ \t]+(\S+)[ \t]*$/i;

/**
 * Resolve a request to an actor.
 *
 * **A presented bearer token is answered as a bearer token, never silently
 * downgraded to the session.** If a caller sends `Authorization: Bearer` and the
 * token is expired, the answer is "expired" — not "here is your cookie's
 * authority instead". A browser that happens to hold a cookie while calling with
 * a dead token must not appear to succeed, because that is how a broken
 * integration looks healthy in exactly one environment: the developer's own.
 *
 * **There is no proxy check and there should not be.** JWT sessions have no
 * adapter and the proxy reads no database (ADR-024; `proxy.ts`, above
 * `guarded`), so a token must be verified against Postgres — which means it is
 * verified in the route, where every other check in this app already happens.
 */
export async function resolveActor(request: Request, now: Date = new Date()): Promise<ActorResolution> {
  const header = request.headers.get("authorization");
  const bearer = header === null ? null : BEARER.exec(header);
  if (bearer !== null && bearer[1]!.startsWith(OAUTH_ACCESS_PREFIX)) return resolveOAuth(bearer[1]!, now);
  if (bearer !== null) {
    const verified = await verifyToken(bearer[1]!, now);
    if (!verified.ok) return { ok: false, refusal: { reason: "token", refusal: verified.refusal } };
    return {
      ok: true,
      actor: {
        userId: verified.token.ownerId,
        via: "token",
        tokenId: verified.token.tokenId,
        scopes: verified.token.scopes,
        tripIds: verified.token.tripIds,
      },
    };
  }

  // An `Authorization` header we cannot parse is not a session — it is a
  // malformed credential, and answering it with the cookie's authority would be
  // the same silent downgrade as above.
  if (header !== null) return { ok: false, refusal: { reason: "anonymous" } };

  const session = await auth();
  if (!session?.user?.id) return { ok: false, refusal: { reason: "anonymous" } };
  return { ok: true, actor: { userId: session.user.id, via: "session" } };
}

/**
 * A `tco_` access token: its audience is `/api/mcp` (RFC 8707), so it resolves
 * only inside an MCP tool dispatch and is refused, unread, everywhere else.
 * Without this, the same token would work on a direct `/api/v1` call, since
 * the tools dispatch through those very handlers.
 */
async function resolveOAuth(secret: string, now: Date): Promise<ActorResolution> {
  if (!inMcpDispatch()) return { ok: false, refusal: { reason: "oauth", refusal: { reason: "audience" } } };
  const verified = await verifyAccessToken(secret, now);
  if (!verified.ok) return { ok: false, refusal: { reason: "oauth", refusal: verified.refusal } };
  return {
    ok: true,
    actor: {
      userId: verified.access.ownerId,
      via: "oauth",
      grantId: verified.access.grantId,
      clientName: verified.access.clientName,
      scopes: verified.access.scopes,
      tripIds: null,
    },
  };
}

/**
 * The credential a request spent, for what is counted or touched per
 * credential: the token's id, the grant's id, or `null` for a session. Both
 * ids are uuids, so a token and a grant never share a bucket.
 */
export function credentialKey(actor: Actor): string | null {
  switch (actor.via) {
    case "session":
      return null;
    case "token":
      return actor.tokenId;
    case "oauth":
      return actor.grantId;
  }
}

/**
 * Does this actor hold this scope?
 *
 * A session holds every scope; a token or a grant holds what it was granted. There is no
 * implication anywhere — `trips:write` does not satisfy `trips:read`, because a
 * scope is a set and not a rank (ADR-045 rule 4's reasoning, applied here).
 */
export function actorHasScope(actor: Actor, scope: ApiScope): boolean {
  return actor.via === "session" || actor.scopes.has(scope);
}

/**
 * May this actor's credential reach this trip at all?
 *
 * **Not an authorization answer** — it is the token's own confinement, checked
 * before the membership question that decides the actual outcome. A session is
 * unconfined; an account-wide token, and every OAuth grant, is unconfined; a
 * trip-scoped token reaches exactly the ids it names.
 */
export function actorMayReachTrip(actor: Actor, tripId: string): boolean {
  if (actor.via === "session") return true;
  return actor.tripIds === null || actor.tripIds.has(tripId);
}
