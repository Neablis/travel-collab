### KI-2026-10-30-m — a new trip with no start date is created with no days, whatever How long said — RESOLVED

- **Severity:** correctness. An answer New trip requires is collected and never reaches the trip,
  which is the defect M56 exists to remove (milestone, *Why this exists*).
- **Area:** `apps/web/src/components/home/newTripSubmit.ts` (`createTripWithSetup`,
  `desiredDates`), `apps/web/src/components/home/newTripScript.ts` (`setupOf`).
- **Symptom / What happens:** on New trip, answer Start date "Not yet" and How long "A week".
  Review shows "A week", and Next on How long stays disabled until it is answered. The created trip
  has no days at all. `setupOf` sends `days: 7` with `arrive: ""`, and `desiredDates` is `null`
  unless `arrive` is an ISO date, so neither dates nor days are sent. A dated trip is unaffected.
- **Why not fixed here:** the review of PR 642 (finding 7) judged it not part 2's regression:
  the dropping is in part 4's write path, and part 2 made How long a required page. It does not
  block part 2, and the gate box "every answer reaches the trip" is phrased for the dated case.
- **Fix path / Tripwire:** for an undated trip with a length, append that many empty days
  (`AddDay`, `packages/contracts/src/trip.ts`), less the chosen published days' lengths, as the
  dated branch already subtracts them. Latch it like `datedAs` so a retry does not append twice.
  Tripwire: M56's gate close, or any change to `desiredDates`.
- **Cross-reference:** M56 part 2 (PR 642) and part 4 (`newTripSubmit.ts`); KI-2026-09-08-a (the
  latch).
- **First noted:** 2026-10-30, review of PR 642 at `39a6bbb`.
- **Resolved 2026-11-14** (overnight KI sweep), by the fix path above, with no contract change.
  `createTripWithSetup` (`apps/web/src/components/home/newTripSubmit.ts`) now, for a trip with no
  start and an answered length, appends that length less the chosen published days' lengths as
  empty days, one `AddDay` each, after the dates step and before the inserts. Each landed
  `AddDay` is latched in `SetupLatch.undatedDaysAdded`, so a retry sends only the missing ones,
  and `dayCount` is reported for such a trip. Proven in `newTripSubmit.test.ts`: *lays out an
  undated trip's length as empty days* failed before the change with `expected [] to deeply
  equal [ { type: 'AddDay', …(2) }, …(6) ]`, and its siblings (the retry and the chosen-days
  subtraction) with `expected null to be 3` and `expected [] to deeply equal [ 'AddDay', 'AddDay' ]`.
  With the loop started at 0 instead of the latched count, the retry test fails with `expected [
  'AddDay', 'AddDay', 'AddDay', …(1) ] to deeply equal [ 'SetTripBudget' ]`. The old test *sends no
  dates command when there is no arrival* asserted that nothing at all was dispatched, which is
  the defect itself; it now asserts only that no `SetTripDates` is sent. Not handled: a retry that
  first dated the trip and then cleared the start keeps the dated attempt's days and then also
  appends the undated ones.
