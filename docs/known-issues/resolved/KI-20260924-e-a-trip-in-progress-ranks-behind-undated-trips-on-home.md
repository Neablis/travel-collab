### KI-2026-09-24-e — a trip that has started but not finished ranks as past on Home, behind every undated trip — RESOLVED

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
- **Resolved 2026-09-25 (overnight sweep)**, contract change
  (`docs/contracts/CHANGELOG.md`). `TripSummary` gains `endDate`
  (`YYYY-MM-DD | null`, `.default(null)`): the trip's last calendar day, null
  when undated or dated with no days. It is **not** a `trip_summaries` column:
  `listTripSummariesVisibleTo` and `listTripSummariesPage` LEFT JOIN
  `trip_details` and read `doc -> 'days' -> -1 ->> 'date'`, the date
  `tripDetailFromState` already gives the last day. `projectTripSummaries` now
  returns the new `StoredTripSummary` (`Omit<TripSummary, "endDate">`), so the
  table, its projector and the golden rebuild are unchanged. **No migration, no
  deploy step — `migrate-production` is not needed for this.**
  `lib/homeTripOrder.ts` gains an **under way** band ahead of upcoming: start
  on or before the reader's today and end on or after it, most recently started
  first. A dated trip with no days keeps the old rule (its end is unknown).
  `openapi.json` regenerated (`GET /v1/trips` items gain `endDate`).
  **Reproduction, red on the unfixed tree:** two new cases in
  `homeTripOrder.test.ts` — *"puts a trip that is under way first…"* failed
  with `expected [ 'upcoming', 'undated', …(2) ] to deeply equal [ 'under-way',
  'upcoming', …(2) ]` (the trip that began yesterday and ends 2026-10-01 came
  third, behind the undated one), and *"counts a trip whose last day is today
  as under way…"* with `expected [ 'undated', 'ended-yesterday', …(1) ] to
  deeply equal [ 'ends-today', 'undated', …(1) ]`. Green after. The
  `projections.int.test.ts` KI-034 case now asserts `endDate` from both list
  queries (and that it follows a moved start date); with the SQL expression
  replaced by `null` it failed `expected [ [ 'Newer', null, null ], …(1) ] to
  deeply equal …`. The contracts round-trip test for a pre-`endDate` payload
  failed `expected true to be false` with the regex removed. All restored and
  green. Checks (contracts change, AGENTS.md invariant 5): full `pnpm check`,
  exit 0 — typecheck, lint and every wall, all unit suites (web 292 files /
  4014 tests), and the whole integration suite it runs against a live
  database (85 files / 1068 tests).
- **Decision (2026-09-25 overnight sweep):** `endDate`, read at list time from
  the trip's `trip_details` document, rather than stored. Rejected: (a) a
  `trip_summaries.end_date` or `day_count` column as KI-034 did for
  `startDate` — it needs migration + backfill + a production
  `migrate-production` dispatch (M14's production migrations have not run yet),
  and a second projector that re-implements either the day-date math or
  `evolve`'s DayAdded/DayRemoved semantics, which could drift from the
  document; (b) `dayCount` instead of `endDate` — it would make the client
  redo date arithmetic the domain already did. Cost accepted: the list reads
  one scalar out of each listed trip's jsonb document (a detoast per trip), and
  the summary DTO is now assembled from two projections that are always
  written together. Ordering within the under-way band (latest start first) is
  also a choice; soonest-ending first was the alternative.
