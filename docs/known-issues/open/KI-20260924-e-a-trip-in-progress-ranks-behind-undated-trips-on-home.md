### KI-2026-09-24-e — a trip that has started but not finished ranks as past on Home, behind every undated trip

- **Severity:** correctness of an ordering, narrow. Nothing is lost; while you
  are ON a trip, Home's hero can be some undated trip you have not planned yet.
- **Area:** `apps/web/src/lib/homeTripOrder.ts` (the rule: upcoming by start
  date, then undated, then past), `packages/contracts/src/trip.ts`
  (`TripSummary` — carries `startDate` since KI-34, no end date or day count).
- **Symptom / What happens:** KI-34's fix (2026-09-24) orders Home by
  `TripSummary.startDate`: a start on or after the reader's local today is
  upcoming. A trip whose start is yesterday is therefore *past*, even when it
  runs another week, so it falls behind every undated trip and never takes the
  hero while it is happening — the one time the hero matters most.
- **Why not fixed here:** the summary cannot tell "in progress" from "over"
  without an end date or a day count, and adding either is another
  `TripSummary` contract change (plus the projection column and backfill KI-34
  needed for `startDate`). Recorded by KI-34's fixer rather than widened into
  that change.
- **Intended fix:** add `endDate` (or `dayCount`) to `TripSummary` the way KI-34
  added `startDate`, and rank "today falls inside the trip" first.
- **Cross-reference:** `resolved/KI-034-tripsummary-no-start-date-next-trip.md`.
- **First noted:** 2026-09-24, KI pass.
