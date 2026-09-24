import type { TripSummary } from "@tc/contracts";

/**
 * **Home's trips in the order Home shows them: the "Next trip" hero first,
 * then *Other trips*** (KI-034).
 *
 * Three bands, in this order:
 *
 * 1. **Upcoming** — `startDate` on or after `today` — soonest first. A trip
 *    starting today is still the next trip, not a past one.
 * 2. **Undated** — no `startDate`. Its start is unknown, not past, so it
 *    outranks a trip that has already begun.
 * 3. **Past** — `startDate` before `today` — most recent first.
 *
 * **Ties keep the list's own order** (`sort` is stable). `GET /api/trips`
 * returns newest-created first with `tripId` as the final tie-break
 * (`listTripSummariesVisibleTo`), so the result is deterministic, and within
 * the undated band the newest trip leads — the order Home had before any trip
 * carried a date, which is what `e2e/m8-make-it-real.spec.ts` relies on.
 *
 * `today` is the READER's calendar day (`YYYY-MM-DD`, `lib/today.ts`), passed
 * in rather than read here: "upcoming" is a question about their calendar, and
 * the server does not know it. `null` — before the first client frame has read
 * the clock — treats every dated trip as upcoming; Home's trips cannot arrive
 * before that frame, so it does not show.
 *
 * A trip that has started but not finished counts as past: `TripSummary`
 * carries a start date and no end, so "still under way" is not knowable here.
 */
export function orderHomeTrips(trips: readonly TripSummary[], today: string | null): TripSummary[] {
  return [...trips].sort((a, b) => {
    const bandA = band(a.startDate, today);
    const bandB = band(b.startDate, today);
    if (bandA !== bandB) return bandA - bandB;
    if (a.startDate === null || b.startDate === null || a.startDate === b.startDate) return 0;
    // ISO calendar dates compare correctly as strings.
    const soonerFirst = a.startDate < b.startDate ? -1 : 1;
    return bandA === PAST ? -soonerFirst : soonerFirst;
  });
}

const UPCOMING = 0;
const UNDATED = 1;
const PAST = 2;

function band(startDate: string | null, today: string | null): number {
  if (startDate === null) return UNDATED;
  if (today === null || startDate >= today) return UPCOMING;
  return PAST;
}
