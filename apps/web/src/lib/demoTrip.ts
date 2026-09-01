/**
 * The built-in demo trip's identity, on the UI side of the lint wall (ADR-031).
 *
 * A fixed, obviously-synthetic id. Every real trip's id comes from
 * `randomUUID`, so this cannot collide with one, and it is stable across
 * instances and deploys — which matters twice: it is what `/demo` asks the
 * ordinary trip endpoints for, and it ends up in the `forkedFrom` lineage of
 * every trip copied from the demo.
 *
 * It names no row in any table, by construction. `server/demoTrip.ts` folds the
 * Japan fixture in memory and answers for it at the one access seam every trip
 * read passes through, so the demo travels the real routes without ever being
 * stored. Nothing may follow this id as a link to a trip page: `/trips/<this>`
 * is a 404 behind a sign-in wall. `/demo` is where it renders.
 *
 * In `lib/` rather than `server/` because both sides need it — the board's
 * chrome asks "am I the demo?" to drop the controls a signed-out visitor has
 * no session for, and the server asks it to decide what to serve.
 */
export const DEMO_TRIP_ID = "00000000-0000-4000-8000-00000000d000";

/** Where the demo board renders. Not under `/trips`, which middleware guards. */
export const DEMO_PATH = "/demo";

export function isDemoTripId(tripId: string): boolean {
  return tripId === DEMO_TRIP_ID;
}
