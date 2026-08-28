# Contracts changelog

Every change to `packages/contracts` (commands, events, DTOs, Conflict types)
gets an entry here, in the same PR as the change and all consumer updates.

Format:

```
## YYYY-MM-DD — short title
- What changed (schema names)
- Why
- Consumers updated (packages/apps touched)
- Breaking? yes/no — if yes, migration notes
```

## 2026-08-28 — KI-35: `Location.area`
- Added: `area: z.string().min(1).max(200).optional()` on `Location`
  (`packages/contracts/src/activity.ts`) — the sub-settlement locality
  (neighbourhood/suburb/quarter/city district), one level finer than `city`
  and read from the same structured geocoder address breakdown
- Why: KI-35 — nothing carried an area, so `shortPlace()` and `cityFor()` fell
  back to the first comma-delimited segment of `name` when there was no city,
  and that segment is the *venue*: a coffee shop rendered where a neighbourhood
  should be, and a day inside one city rendered "Tokyo → Tokyo → Tokyo"
- Display-only. Nothing groups, colours or buckets by it —
  `calendarCityCards.ts` still groups strictly on `location.city`
- Consumers updated (same change): `@tc/domain` `equality.ts` (it is the ONE
  module that compares `Location` field by field; without it `diffTripStates`
  treats an area-only edit as a no-op and revert/undo silently keeps the old
  value), the shared property generator
  (`packages/domain/test/support/tripGenerator.ts`) so the field is actually
  in the generated input space, and in `apps/web`: `geocoding/geocoder.ts` +
  `geocoding/locationiq.ts` (`suburb ?? neighbourhood ?? quarter ??
  city_district`, the `city` read untouched), `ai/geocodeEnrichment.ts`,
  `LocationInput.tsx`, the MSW handlers, `lib/place.ts`, `DayChips.tsx`,
  `japanTripImporter.ts` and `scripts/db-seed.ts`.
  `diff.ts`/`hydrate.ts`/`detail.ts` pass `location` through whole and needed
  no change
- Breaking? no — `.optional()`, exactly like `city`. A `trip_details.doc` or a
  stored event written before this change parses unchanged; there is no
  migration and no event rewrite. Asserted directly, not just claimed:
  `packages/contracts/test/ki35-location-area.test.ts` parses a complete
  pre-`area` projection document. M18 added *required* fields to this same
  raw-jsonb-then-parse shape and 500'd every untouched board (fix `8abbaa3`) —
  that test is the tripwire

## 2026-08-27 — M18: activity kind & tags
- Added: `ActivityKind` (`booked|hold|idea|transit|planned`) and `ActivityTag`
  (`meal|lodging|ticketed|outdoors`) enums
- Added: `kind`/`tags` on `AddActivity` and `UpdateActivity` (both `.optional()`,
  neither nullable — a kind is cleared by setting `planned`, tags by `[]`;
  `tags` replaces the whole array, matching `anchors`)
- Added: `kind: ActivityKind.default("planned")` and
  `tags: z.array(ActivityTag).default([])` on the `ActivityAddedV1` and
  `ActivityUpdatedV1` payloads — still **version 1**, no V2 event
- Added: `ActivityView.kind`, `.tags` (both required — the projection always
  produces them, so no consumer has to ask what absence means)
- Why: M18 — a stop had no kind, so the Calendar's travel-day split, `N to book`,
  the home hero's "not booked" tile and `act.badge` were all blocked, and the
  seed encoded the kind as `(transit)` prose inside a note a user can edit (KI-47)
- Note: the design handoff lists SIX tags; `considering` and `travel` are
  deliberately omitted because `ActivityKind` already carries `idea` and
  `transit`. Two fields that can disagree about one fact is a bug generator — a
  stop tagged `considering` while its kind says `booked` would render dashed
  under a "Booked" badge with its cost outside the committed total, and no
  surface would own the contradiction. Mitchell's call, 2026-08-27
- Consumers updated: `@tc/domain` (state/evolve/decide/equality/diff/hydrate/
  detail), `@tc/pages`, `@tc/factories`, `apps/web` (MSW handlers,
  duplicateTrip, japanTripImporter, db-seed, test fixtures) — same PR.
  `equality.ts` mattered most: without it `okUnlessNoOp` rejects a kind-only
  `UpdateActivity` as a no-op. The shared property generator
  (`packages/domain/test/support/tripGenerator.ts`) gained both fields too, or
  `diff.property.test.ts` would keep passing while never generating either
- Breaking? no — event payload additions default (`kind` → `"planned"`,
  `tags` → `[]`), so `TripEvent.parse` accepts all previously stored events
  unchanged. **There is no migration and no event rewrite.** DTO additions are
  new required fields produced only by the updated projection

## 2026-07-28 — M8: trip lifecycle
- Added commands: `SetTripName`, `SetTripDates`, `DeleteTrip`, `RestoreTrip`
- Added events: `TripNameSetV1`, `TripDeletedV1`, `TripRestoredV1`
- Added: `TripStatus` enum; `status` on `TripSummary` and `TripDetail`
- `SetTripName`/`SetTripDates` joined `BatchableCommand` (AI-reachable);
  `DeleteTrip`/`RestoreTrip` deliberately did NOT — destructive and
  stream-level operations stay out of the derived tool surface
- `SetTripDates` carries `newDayIds` because the domain may not mint UUIDs
  (Invariant 4); it supersedes `SetTripStartDate`, which is left in place —
  deprecation plan deferred (see known-issues KI-15)
- Why: M8 — a trip could not be renamed or deleted by anyone
- Consumers updated: `packages/domain`, `apps/web` (routes, projections, AI
  tools, UI)
- Breaking? no — additive

## 2026-07-20 — M7: add page & macro contracts
- Added: `Page`, `PageContext`, `DayRef`, `MacroNode`, `PageContent`, `MacroKind`,
  `PageSummary`, `CreatePageInput`, `UpdatePageInput`
- Why: M7 Solo delight — dynamic macro pages, CRUD operations, Yjs collaboration support
- Consumers updated: `@tc/pages`, `apps/web` pages routes + UI
- Breaking? no — additive

## 2026-07-19 — M6 command endpoints return authoritative state
- Changed: `POST /api/trips/:id/commands` success response now includes
  `{ detail: TripDetail, history: TripHistory }` (was `{ ok, tripId }`)
- Added: `POST /api/trips/:id/commands/batch` with body `{ commands: BatchableCommand[] }`,
  same response shape
- Why: M6 optimistic updates reconcile from the response instead of refetching
- Consumers updated: apps/web apiClient + TripProvider
- Breaking? no — response fields added; new endpoint is additive

## 2026-07-19 — M6 atomic changes + optimistic updates
- Added: `BatchableCommand` (discriminated union — TripCommand minus CreateTrip
  and the history commands) for the batch endpoint
- Why: M6 — submit a series of commands as one atomic batch (one history entry)
- Consumers updated: packages/domain (predict), apps/web (batch route, apiClient)
- Breaking? no — additive

## 2026-07-10 — M4 money & lenses schemas
- Added: `Money` (integer minor units + ISO-4217 currency)
- Added: `cost` on `AddActivity` (optional) / `UpdateActivity` (nullable, optional)
  and on `ActivityAddedV1`/`ActivityUpdatedV1` payloads (`Money.nullable().default(null)`)
- Added: commands `SetTripCurrency`, `SetTripBudget`; events `TripCurrencySetV1`,
  `TripBudgetSetV1` (joined `TripCommand`/`TripEvent`)
- Added: `ActivityView.cost`; `TripDetail.currency`, `.budget`, `.tripCostTotal`,
  `.unscheduledCostSubtotal`, `.budgetRemaining`, `days[].costSubtotal`
- Why: M4 — costs on activities, derived cost rollups, trip currency & budget,
  over-budget conflict (ADR-008, ADR-009)
- Consumers updated: `@tc/domain` (state/evolve/equality/diff/decide/costs/
  conflicts/detail), `apps/web` (projection wiring, mocks, money editors, lenses)
  — same PR
- Breaking? no — event payload additions default (`cost` → null), so
  `TripEvent.parse` accepts all previously stored events unchanged; DTO additions
  are new required fields produced only by the updated projection

## 2026-07-09 — M3 place & time schemas
- Added: `Weekday`, `Anchor` (union: dayOfWeek | dateRange | timeOfDay | publicHoliday)
- Added: `anchors` on `AddActivity`/`UpdateActivity` (optional) and on
  `ActivityAddedV1`/`ActivityUpdatedV1` payloads (`z.array(Anchor).default([])`)
- Added: `Location.countryCode` (optional, ISO-3166 alpha-2)
- Added: `ActivityView.anchors`; `TripDetail.days[].date` (nullable derived date)
- Why: M3 — date-anchored activities, derived day dates, geocoded locations
- Consumers updated: `@tc/domain` (state/evolve/decide/diff/equality/conflicts/
  detail), `apps/web` (projection wiring, mocks, lens UI) — same PR
- Breaking? no — event payload additions default, so `TripEvent.parse` accepts
  all previously stored events unchanged; DTO additions are new required fields
  produced only by the updated projection

## 2026-07-08 — M2 history & time travel schemas
- Added: `Origin`; `EventEnvelope` gains required `batchId` + `origin`
- Added: commands `UndoLastChange`, `RedoChange`, `RevertToState`,
  `DismissConflict` (joined `TripCommand`)
- Added: events `ConflictDismissedV1`, `ConflictUndismissedV1` (joined `TripEvent`)
- Added: DTOs `HistoryEntry`, `TripHistory`; `TripDetail` gains `dismissedConflictIds`
- Why: M2 — undo/redo/revert via compensating events (ADR-005), history UI,
  persistent conflict dismissal
- Consumers updated: `@tc/domain`, `apps/web` (pipeline, event store + column
  migration with backfill, routes, UI) — in this same PR
- Breaking? yes, envelope only — stored events need the Task 5 backfill
  migration (batch_id = own uuid, origin = user); event payloads unchanged,
  `TripEvent.parse` accepts all previously stored events

## 2026-07-08 — M1 planning-core schemas
- Added: commands `AddDay`, `RemoveDay`, `SetTripStartDate`, `AddActivity`,
  `UpdateActivity`, `MoveActivity`, `RemoveActivity`; command union `TripCommand`
- Added: events `DayAddedV1`, `DayRemovedV1`, `TripStartDateSetV1`,
  `ActivityAddedV1`, `ActivityUpdatedV1`, `ActivityMovedV1`, `ActivityRemovedV1`;
  `TripEvent` grew from a single schema into a discriminated union
- Added: value objects `TimeWindow`, `Location`; DTOs `ActivityView`, `TripDetail`
- Why: M1 planning core — days, backlog, activities, board moves, conflicts read model
- Consumers updated: `@tc/domain` (decide/evolve/projections), `apps/web` (pipeline, routes, UI) — in this same PR
- Breaking? no — `TripEvent.parse` accepts all previously stored events unchanged

## 2026-07-08 — backfill: M0 initial schemas (created 2026-07-07)
- Added (in M0): `CreateTrip`, `TripCreatedV1`, `TripEvent`, `TripMember`,
  `TripSummary`, `EventEnvelope`, `Conflict`
- Why: recorded retroactively — M0 created the package without a changelog entry
- Consumers: `@tc/domain`, `apps/web`
- Breaking? no
