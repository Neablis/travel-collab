import type { ApiScope } from "@tc/contracts";
import { auth } from "@/server/auth";
import { verifyToken, type TokenRefusal } from "@/server/api-tokens";

// **Who is asking, and by what authority** (M22 Phase 2, Decision 3).
//
// Two credentials, one principal. Everything downstream of this file asks
// "which user" and "what were they granted"; nothing downstream asks "was this
// a cookie or a bearer token" except the rate limiter, which keys on a token id
// that a session simply does not have.

/**
 * A resolved caller.
 *
 * **A session actor satisfies every scope check.** The frontend acts as the
 * user with the user's full authority, which is exactly what it does today — a
 * cookie is not a narrowed credential and pretending otherwise would mean
 * inventing a scope set for the browser that nothing grants and nothing revokes.
 *
 * **A token actor satisfies only its granted scopes.** Both then flow into the
 * *existing* authorization seam unchanged, which is gate two.
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
    };

/** Why nobody could be resolved. Mapped to a status and a wire code by `route()`. */
export type ActorRefusal =
  | { reason: "anonymous" }
  | { reason: "token"; refusal: TokenRefusal };

export type ActorResolution = { ok: true; actor: Actor } | { ok: false; refusal: ActorRefusal };

const BEARER = /^Bearer (.+)$/;

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
 * **There is no edge check and there should not be.** JWT sessions have no
 * adapter and the Edge runtime has no database (`proxy.ts:63-66`), so a token
 * must be verified against Postgres — which means it is verified in the route,
 * where every other check in this app already happens.
 */
export async function resolveActor(request: Request, now: Date = new Date()): Promise<ActorResolution> {
  const header = request.headers.get("authorization");
  const bearer = header === null ? null : BEARER.exec(header);
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
 * Does this actor hold this scope?
 *
 * A session holds every scope; a token holds what it was granted. There is no
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
 * unconfined; an account-wide token is unconfined; a trip-scoped token reaches
 * exactly the ids it names.
 */
export function actorMayReachTrip(actor: Actor, tripId: string): boolean {
  if (actor.via === "session") return true;
  return actor.tripIds === null || actor.tripIds.has(tripId);
}
