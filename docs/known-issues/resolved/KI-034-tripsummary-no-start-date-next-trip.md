### KI-34 — `TripSummary` has no start date, so "next trip" and trip-card dates are approximations — RESOLVED
- **Severity:** correctness (the "next trip" selection — see below — can genuinely surface the wrong trip, not just an approximate date) / cosmetic (the `createdAt` display fallback). Split rather than a single label, per CodeRabbit's review of PR #35: the two consequences below are not the same class of problem.
- **Area:** `packages/contracts/src/trip.ts`, `apps/web/src/app/page.tsx`, `apps/web/src/components/home/NextTripHero.tsx`, `apps/web/src/components/home/TripCard.tsx`
- **Symptom:** `TripSummary` (what `/api/trips` returns for the whole list) carries no start/end date field at all — only `createdAt`, an instant recording when the trip record was made, not when it happens. Two consequences, deliberately not the same severity:
  - **Correctness:** `page.tsx`'s `nextTrip` is `visibleTrips[0]`, the first trip in the list order the API returns, not the true next-upcoming-by-date trip — there is no date to sort by. If `/api/trips`'s order is ever not chronological (nothing in the contract guarantees it is), the hero can present a genuinely wrong trip as "next", not merely an approximate date on the right one.
  - **Cosmetic:** `TripCard` shows `Created {date}` (derived from `createdAt`) in the slot the design's trip card uses for the trip's actual dates; `NextTripHero`'s meta row does the same when its own `TripDetail` fetch (which does carry a real `startDate`) hasn't resolved yet or the trip has none set. The trip shown is still the right one here — only its displayed date is an approximation.
- **Why it's not fixed here:** the real fix is a contract change — adding a start date (or a denormalized "sort key" date) to `TripSummary` — which M10 Wave 2's Phase 8 (Task 8.5 — plan deleted at M10's gate close, see `docs/milestones/M10-visual-craft.md`'s "Wave 2 scope") explicitly ruled out of scope: it is presentational-only, no `packages/contracts` growth. Fabricating a placeholder date on the card instead of the honest `createdAt` label would be worse than the current approximation, not better, so neither `nextTrip`'s selection nor `TripCard`'s date line changed for this task.
- **Fix path:** add a start date to `TripSummary`, then swap `nextTrip` to a real date-sort and `TripCard`'s date line to that field, the same way `NextTripHero` already prefers its real `TripDetail.startDate` over `createdAt` once that fetch resolves.
- **First noted:** 2026-08-24 (M10 Wave 2 Phase 8, Task 8.5).
- **Resolved 2026-09-24**, contract change (`docs/contracts/CHANGELOG.md`).
  `TripSummary` gains `startDate` (`YYYY-MM-DD | null`, `.default(null)`),
  carried on a new nullable `trip_summaries.start_date` column (migration
  `0028_trip_summary_start_date`, backfilled from `trip_details`) and kept by
  both `applyTripEvents` and `projectTripSummaries` from `TripStartDateSet`.
  `listTripSummariesVisibleTo` now has an `ORDER BY created_at DESC, trip_id
  DESC` (it had none, so the hero was the heap's first row). Home orders its
  trips with `lib/homeTripOrder.ts`: upcoming (start on or after the reader's
  today) soonest first, then undated, then past most recent first; ties keep
  the server order. The hero is the first of those; *Other trips* follow in the
  same order. `TripCard` and the hero's pre-detail meta row print the start
  date, keeping "Created …" only for an undated trip.
  Reproduced first, red on the unfixed tree: `page.test.tsx` (hero on a list
  whose later-dated trip came first — `Unable to find role="heading" and name
  "Japan"`), `TripCard.test.tsx` / `NextTripHero.test.tsx` (`Unable to find an
  element with the text: Thu, Oct 1`), and `projections.int.test.ts`
  (`expected [ [ 'Older', undefined ], …(1) ] to deeply equal [ [ 'Newer',
  null ], …(1) ]`). All green after; each was also turned red again by
  removing its half of the fix (the `ORDER BY`, the `TripStartDateSet` case in
  either projector, the page's use of `orderHomeTrips`, the hero's summary
  fallback). **Limit, not fixed:** a trip that is under way ranks as past,
  because the summary still carries no end date. *(Fixed 2026-09-25 by KI-2026-09-24-e: `TripSummary.endDate`,
  read at list time, and an "under way" band first.)*
