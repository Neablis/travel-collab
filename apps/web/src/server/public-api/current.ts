import type { ApiScope, TripDetail } from "@tc/contracts";
import { turnNowOf } from "@/server/assistant/context";
import { buildTripGlobals } from "@/server/tripGlobals";
import { actorHasScope, type Actor } from "./actor";
import { PublicApiError } from "./commands";
import { NO_SUCH_TRIP } from "./route";

// **The current scopes' trip question, in one place.** `current:read` and
// `current:write` are the narrow twins of `trips:read` and `trips:write`: the
// credential's visible set is the trips under way now or starting soon, and
// every other trip is answered as if it did not exist. The wrapper's gate
// (`route()`) decides which scope a call needs; this module decides, for a
// caller holding only the narrow one, whether the trip in front of it is in
// that set. Handlers call `requireCurrentTrip`; the list forces its scan
// instead, because it has no one trip to ask about.

/**
 * Whether this trip is current at `now`: under way, or starting within
 * `SOON_DAYS`. The phase is `tripNow`'s, read through `turnNowOf` for the
 * server's zone fallback (ADR-080) — never recomputed here, never hardcoded.
 * A deleted trip is never current: the stream survives, but the trip is gone.
 */
export function tripIsCurrent(detail: TripDetail, now: number): boolean {
  if (detail.status !== "active") return false;
  const phase = turnNowOf(detail, buildTripGlobals(detail), now).phase;
  return phase === "underway" || phase === "soon";
}

/**
 * Whether this actor holds only the narrow scope for the `full` one. A token
 * holding the full scope as well is not current-only, and a session holds
 * every scope, so it never is.
 */
export function actorIsCurrentOnly(actor: Actor, full: ApiScope, current: ApiScope): boolean {
  return actorHasScope(actor, current) && !actorHasScope(actor, full);
}

/**
 * Refuse a non-current trip to a current:-only actor with the trip's own 404.
 * A caller holding the full scope, or a session, is never refused here — the
 * guard is about the credential's visible set, not the trip.
 */
export function requireCurrentTrip(
  actor: Actor,
  detail: TripDetail,
  full: ApiScope,
  current: ApiScope,
  now: number,
): void {
  if (actorIsCurrentOnly(actor, full, current) && !tripIsCurrent(detail, now)) {
    throw new PublicApiError(404, NO_SUCH_TRIP, "not-found");
  }
}
