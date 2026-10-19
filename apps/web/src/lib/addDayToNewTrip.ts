import { createTrip, insertSavedDay, sendTripCommandBatch, type ApiResult } from "@/lib/apiClient";

/**
 * How far one attempt got, so a retry resumes rather than restarts —
 * `NewTripWizard`'s latch (CodeRabbit, PR 32), which exists because a failure
 * at a later step used to mint a second trip on every attempt.
 *
 * `datedAs` is the half that latch does not have: re-sending the same
 * `SetTripStartDate` is rejected as a no-op (`okUnlessNoOp`, `decide.ts`), so a
 * retry after a failed insert must SKIP the date rather than repeat it, or the
 * user is stuck behind "This change would have no effect." Storing the date
 * rather than a boolean means changing it before retrying still re-sends.
 */
export type NewTripLatch = { tripId: string; datedAs: string | null };

/**
 * A playbook day as day 1 of a trip made for it (Mitchell, 2026-09-08 — "For
 * name same thing, just use name of the day for trip"). Resolves the new trip's
 * id, or the first refusal; a 404 from the insert means the day itself has gone.
 *
 * Two callers, one sequence: `AddToTripDialog`'s *Start a new trip*, and the
 * day page's return from signing up (M50 decision 5), which passes no date.
 * Three facts make it correct, and each cost a read to establish:
 *
 *   1. A freshly created trip has `days: []` and `startDate: null`
 *      (`packages/domain/src/trip/evolve.ts`), so the insert's `AddDay` lands
 *      the playbook day as day 1. Nothing extra makes it "first".
 *   2. The date goes on with `SetTripStartDate`, never `SetTripDates`. The
 *      latter reconciles day COUNT (`decide.ts`) and would mint an empty day 1,
 *      pushing the playbook day to day 2.
 *   3. **The start date is OPTIONAL** (Mitchell, 2026-09-08). Blank means no
 *      `SetTripStartDate` is sent at all — the trip is created undated, a
 *      supported state everywhere (`deriveDayDates` renders it as ordinals) —
 *      not `SetTripStartDate` with an empty date.
 *
 * The insert is the same `POST /api/trips/:id/saved-days/:id` an existing trip
 * gets, so the adds ledger has one path to agree with.
 */
export async function addDayToNewTrip(
  day: { savedDayId: string; dayName: string; startDate?: string },
  latch: { current: NewTripLatch | null },
): Promise<ApiResult<{ tripId: string }>> {
  let made = latch.current;
  if (made === null) {
    // The day's own name, verbatim: both `SavedDay.name` and `CreateTrip.name`
    // are min 1 / max 200, so it always fits and nothing is truncated.
    const created = await createTrip({ name: day.dayName });
    if (!created.ok) return created;
    made = { tripId: created.value.tripId, datedAs: null };
    latch.current = made;
  }
  // Blank keeps `datedAs: null`, which is what makes a retry work: submit
  // blank, fail at the insert, type a date, retry — `null !== "2027-04-01"`, so
  // the command goes out the second time. Dated, then cleared, then retried
  // leaves the date on: nothing here un-dates a trip the user already dated.
  const startDate = day.startDate ?? "";
  if (startDate !== "" && made.datedAs !== startDate) {
    const dated = await sendTripCommandBatch(made.tripId, [
      { type: "SetTripStartDate", tripId: made.tripId, startDate },
    ]);
    if (!dated.ok) return dated;
    made = { ...made, datedAs: startDate };
    latch.current = made;
  }
  const inserted = await insertSavedDay(made.tripId, day.savedDayId);
  return inserted.ok ? { ok: true, value: { tripId: made.tripId } } : inserted;
}
