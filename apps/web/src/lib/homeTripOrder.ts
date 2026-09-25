import type { TripSummary } from "@tc/contracts";

/**
 * **Home's trips in the order Home shows them: the "Next trip" hero first,
 * then *Other trips*** (KI-034).
 *
 * Four bands, in this order:
 *
 * 1. **Under way** — `startDate` on or before `today` and `endDate` on or
 *    after it — most recently started first (KI-2026-09-24-e). The hero
 *    matters most while you are on the trip.
 * 2. **Upcoming** — `startDate` after `today`, or today with no known end —
 *    soonest first. A trip starting today is never a past one.
 * 3. **Undated** — no `startDate`. Its start is unknown, not past, so it
 *    outranks a trip that is over.
 * 4. **Past** — `startDate` before `today` and not under way — most recent
 *    first. That includes a dated trip with no days (`endDate` null): its end
 *    is unknown, and a start already gone by is the only evidence there is.
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
 */
export function orderHomeTrips(trips: readonly TripSummary[], today: string | null): TripSummary[] {
  return [...trips].sort((a, b) => {
    const bandA = band(a, today);
    const bandB = band(b, today);
    if (bandA !== bandB) return bandA - bandB;
    if (a.startDate === null || b.startDate === null || a.startDate === b.startDate) return 0;
    // ISO calendar dates compare correctly as strings.
    const soonerFirst = a.startDate < b.startDate ? -1 : 1;
    return bandA === UPCOMING ? soonerFirst : -soonerFirst;
  });
}

const UNDER_WAY = 0;
const UPCOMING = 1;
const UNDATED = 2;
const PAST = 3;

function band({ startDate, endDate }: TripSummary, today: string | null): number {
  if (startDate === null) return UNDATED;
  if (today === null) return UPCOMING;
  if (startDate <= today && endDate !== null && endDate >= today) return UNDER_WAY;
  if (startDate >= today) return UPCOMING;
  return PAST;
}
