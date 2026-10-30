### KI-2026-10-30-m — a new trip with no start date is created with no days, whatever How long said

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
