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

## 2026-08-27 — `ActivityView.kind` and `.tags` read a pre-M18 document

- Changed: `ActivityView.kind` is now `ActivityKind.default("planned")` and
  `ActivityView.tags` is `z.array(ActivityTag).default([])`, where M18 (#63)
  made both required. `hydrate()` gained the matching `?? "planned"` / `?? []`
- Why: this was a live 500, found by Mitchell walking the #71 preview.
  `getTripDetail` returns `trip_details.doc` as RAW jsonb — no parse — and the
  read route then runs `TripDetail.parse` on it. A document written before M18
  carries neither key, and a projection row is only rewritten when its trip
  next changes, so `GET /api/trips/:id` threw `ZodError: kind Required` for
  every trip nobody had touched since M18. `main` has this too; it is not
  specific to M11 and it is not a missing migration
- Not a widening of the contract: `AddActivity.kind` is already optional and
  documented "omitted = planned", `ActivityAddedV1` and `ActivityUpdatedV1`
  already carry `.default("planned")` / `.default([])`, and `state.ts` calls
  "planned" the zero value that is never null. The read model was the only
  place that did not apply the zero values the rest of the stack agrees on
- Chosen over rebuilding the projections: a rebuild is an ops step that fixes
  today's rows and nothing about the next stale one, and it would have to be
  run against every environment. A default is additive and needs no migration
- Consumers updated: `packages/contracts`, `packages/domain` (`hydrate.ts`)
- Breaking? no — additive. An activity that DOES store a kind or tags keeps
  them, pinned by a test

## 2026-08-27 — M11 link 6: saved days

- Added: `packages/contracts/src/saved.ts`, exported from the package index —
  `SavedStop`, `SavedDay`, `CreateSavedDayInput`
- Why: M11's fourth user story, "select parts of my trip and save them for
  reuse". A saved day is a personal, reusable fragment — it belongs to a
  person, not to a trip — so it is CRUD in its own module, not planning state
  (ADR-029)
- `SavedStop` is `ActivityView` minus `activityId`, and a contract test pins
  exactly that against `ActivityView.shape` so the two cannot drift. The id is
  dropped on purpose: it would tie the fragment to the activity it came from,
  and inserting one saved day into two trips would put one id in two streams —
  the KI-1 hazard, and the same reason `cloneTrip` remaps ids
- `CreateSavedDayInput` is `{ name, tripId, dayId }` and deliberately NOT
  `{ name, stops }`: letting a client post plan content would make this an
  unvalidated write path into a person's library, and the server has to read
  the trip to authorize the save anyway
- **`TripDetail`, `TripSummary`, `TripMember`, `TripRole` and every planning
  command are unchanged.** Like links 3 and 4 this adds a module rather than
  touching the planning contracts, so the hand-enumeration trap
  (`equality.ts`, `diff.ts`, `hydrate.ts`, `detail.ts`, `tripGenerator.ts`)
  had nothing to catch
- Consumers updated: `apps/web` only — `server/savedDays.ts` (new),
  `lib/savedStops.ts` (new, shared with the UI because the lint wall forbids
  UI importing `@/server/*` and two copies of "what is included" would be two
  chances to disagree), the `saved-days` routes, `lib/apiClient.ts`,
  `KeepDayFlag`, `KeepDayDialog`, `SavedDaysDialog` (new),
  `AddSavedDayButton`, `EndOfTrip`, `TimelineLens`, `TripProvider`
  (exposes `tripId`), `preview-registry.ts`.
  `@tc/domain`, `@tc/factories`, `@tc/pages` and `@tc/predict` needed no change
- Migration: `apps/web/drizzle/0009_numerous_red_skull.sql` — creates
  `saved_days`. Additive; nothing existing is altered
- Breaking? no — every schema here is new, and no existing schema changed

## 2026-08-27 — M11 link 5: the trip lineage pointer

- Added: `TripLineage` (`{ tripId, atSeq, name }`) in
  `packages/contracts/src/trip.ts`
- Changed: `CreateTrip.forkedFrom`, `TripCreatedV1.payload.forkedFrom` and
  `TripDetail.forkedFrom`, all `TripLineage.nullable().default(null)`
- Why: M11's third user story is cloning a trip someone shared with you, and
  "with lineage" is the milestone's headline. M8 shipped Duplicate deliberately
  lineage-free (its decision 4) and this is where that comes due (ADR-028)
- **This one is a real planning-contract change**, unlike links 3 and 4 — so
  the hand-enumeration trap was live, and every site was walked:
  `state.ts` (the field), `evolve.ts` (carried from the genesis event),
  `detail.ts` and `hydrate.ts` (both directions of the state↔document
  round trip), `equality.ts` (a new `lineageEqual`), and
  `test/support/tripGenerator.ts`. `diff.ts` needed no change and has none —
  lineage is genesis-only, no command changes it, and there is nothing to
  diff; that is stated in `decide.ts`'s comment rather than left implied
- **The generator half of the trap, specifically:** `historyFrom` now takes
  `forkedFrom` as a parameter instead of hardcoding null. No raw op can
  produce lineage, so a generator that always passed null would let every
  property built on it pass while never once seeing a forked trip.
  `diff.property.test.ts`'s round-trip property generates one and asserts
  replay carries it through; `hydrate.property.test.ts`'s arbitrary generates
  one directly, for the same reason it generates non-owner members
- `.default(null)`, NOT `.optional()`: every `TripCreated` row already in
  `events` and every `trip_details.doc` already in Postgres omits the key, and
  a default makes them all parse to one shape — explicit null — rather than
  two. `hydrate()` additionally coalesces `?? null`, because it is called on a
  raw `trip_details.doc` that never goes through `TripDetail.parse`.
  `packages/contracts/test/trip.test.ts` asserts all three defaults against
  payloads written the old way
- Deliberately NOT on `TripSummary`: the home grid's card says nothing about
  provenance, and adding it there would mean a `trip_summaries` column and a
  migration for a line of text the trip's own settings sheet already carries
- Consumers updated: `@tc/domain` (the six sites above), `@tc/factories`
  (`trip.ts`, `legacy.ts`, `conflicts.test.ts`), `@tc/pages` (three fixtures),
  `apps/web` (`server/cloneTrip.ts` — renamed from `duplicateTrip.ts` —
  `server/history.ts`'s `getTripHead`, `server/access/shares.ts`'s
  `readShareForClone`, the new `api/shares/[token]/clone` route,
  `lib/apiClient.ts`, `SharedTripScreen`, `SettingsSheet`, `TripHeader`)
- Migration: **none.** The field rides in an existing jsonb payload and an
  existing jsonb projection document
- Breaking? no — every change is a nullable field with a default

## 2026-08-27 — M11 link 4: pinned share links

- Added: `packages/contracts/src/share.ts`, exported from the package index —
  `TripShare` (the sharer's view, including the token to re-copy) and
  `SharedTripView` (what a stranger holding the link is served)
- Why: M11's second user story is a link pinned to the history point it was
  created at, so the share has to carry a `seq` and the read has to replay to
  it. `trip_details` is the trip as it is NOW, so serving that projection
  would make every link track the live trip (ADR-027)
- **`SharedTripView` is an explicit field list, not a `TripDetail` derivative.**
  A public read is the one place a field leaks to people the trip's owner never
  chose, so a new `TripDetail` field must be opted IN rather than arriving by
  spread. It drops `members` (actor ids are real people — `travellerCount`
  replaces them), `conflicts`/`dismissedConflictIds` (planning advice for
  whoever is editing) and `status` (a deleted trip's link is refused outright).
  `packages/contracts/test/share.test.ts` asserts all four absences, asserts
  that supplying them strips them, and pins every remaining field name against
  `TripDetail.shape` so the two cannot drift into meaning different things
- **`TripDetail`, `TripSummary`, `TripMember` and `TripRole` are again
  unchanged**, so the hand-enumeration trap (`equality.ts`, `diff.ts`,
  `hydrate.ts`, `detail.ts`, `tripGenerator.ts`) had nothing to catch here
  either
- Consumers updated: `apps/web` only — `server/access/shares.ts` (new),
  `server/history.ts` (`getTripDetailAtWithHead`, so the pinned read answers
  "what did it look like" and "has it moved on" from one stream read),
  the `shares` routes, the public `api/shares/[token]` and
  `api/shares/featured` routes, `lib/apiClient.ts`,
  `components/trip/ShareButton.tsx` (was an inert Preview shell),
  `components/access/SharedTripScreen.tsx` (new),
  `app/(front)/s/[token]/page.tsx` (new), `LandingScreen`, `TripHeader`,
  `app/(app)/page.tsx`, `preview-registry.ts`.
  `@tc/domain`, `@tc/factories`, `@tc/pages` and `@tc/predict` needed no change
- Migration: `apps/web/drizzle/0008_glamorous_giant_girl.sql` — creates
  `trip_shares`. Additive; nothing existing is altered
- Breaking? no — every schema here is new, and no existing schema changed

## 2026-08-27 — M11 link 3: the Access & Membership contract

- Added: `packages/contracts/src/access.ts`, exported from the package index —
  `InviteRole` (`viewer|editor`), `InviteStatus` (`pending|accepted|revoked`),
  `TripInvite`, `CreateInviteInput`, `TripMemberProfile`, `TripAccess`,
  `InvitePreview`
- Why: link 3 creates non-owner members, and none of what that needs — an
  invite, its status, who accepted it, a member's display name — belongs on
  `TripDetail`. The Access & Membership module owns invites/roles/revocation
  (AGENTS.md module map) and Identity owns names; putting either on a planning
  read model would be the ADR-003 boundary smell in the other direction
- `InviteRole` is deliberately NOT `TripRole`: an invite hands out
  participation, never ownership. Transferring a trip is a different operation
  (the owner is the only role that can delete one) and no milestone has asked
  for it
- **`TripDetail`, `TripSummary`, `TripMember` and `TripRole` are unchanged.**
  That is the point of the split: the planning contracts did not move, so the
  hand-enumeration trap (`equality.ts`, `diff.ts`, `hydrate.ts`, `detail.ts`
  and `tripGenerator.ts` each enumerating fields by hand) had nothing to catch
  this time. `members` is passed through whole on every one of those paths and
  no new field was added to it
- Consumers updated: `apps/web` only — `server/access/*` (new module),
  `server/accessPolicy.ts` (`memberRole`/`hasAtLeast` added; `canExecute` now
  delegates to `hasAtLeast` so one ranking serves both), `server/commands.ts`
  (authorizes against the effective member list), `server/pages-guard.ts`
  (required minimum-role parameter), `server/ai/handleAiRequest.ts` (`editor`),
  the trip read/list/history routes, `lib/apiClient.ts`, `mocks/handlers.ts`,
  `components/trip/TravelersPanel.tsx` (new), `components/access/
  InviteAcceptScreen.tsx` (new), `SettingsSheet`, `TripHeader`, `TripProvider`,
  `NewTripWizard`, `middleware.ts`, `preview-registry.ts`.
  `@tc/domain`, `@tc/factories`, `@tc/pages` and `@tc/predict` needed no change
- Migration: `apps/web/drizzle/0007_silly_quasimodo.sql` — creates
  `trip_invites` and `trip_memberships`. Additive; nothing existing is altered
- Breaking? no — every schema here is new, and no existing schema changed

## 2026-08-27 — M11: TripMember roles
- Added: `TripRole` (`viewer|editor|owner`, ordered least- to most-privileged)
- Changed: `TripMember.role` from `z.literal("owner")` to `TripRole`
- Why: M11 link 2 — `AccessPolicy` could only ask "is this actor a member?",
  so an invited person (link 3) would land with the owner's powers, including
  `DeleteTrip`. Roles have to exist and be enforced *before* anything creates a
  non-owner member, not alongside it
- Values: three, matching the milestone table. `viewer` and `editor` are the
  two distinctions the five M11 user stories actually need — "invite someone
  and have them modify it" and "share a read-only version". A fourth
  (`commenter`) was considered and dropped: nothing in the planning domain
  models a comment, so it would be a role with no command to distinguish it
- Where the role is interpreted: `apps/web/src/server/accessPolicy.ts` only.
  The planning domain still never reads a role (AGENTS.md invariant 6c) — the
  domain carries `members` and the server decides. The policy is a `Record<
  Exclude<TripCommand["type"], "CreateTrip">, TripRole>`, so a new command
  cannot compile until someone decides who may run it; `DeleteTrip`/
  `RestoreTrip` are owner-only, every other command is editor-or-above, and no
  command is viewer-reachable
- Consumers updated: `apps/web` (`accessPolicy.ts` — `soleMemberPolicy` renamed
  `memberRolePolicy` because it no longer describes what it does; `commands.ts`,
  where the batch path now authorizes EVERY sub-command rather than just the
  first, since minimums are per-command; `api/dev/reset-demo-data`, now scoped
  to trips you *own*; `preview-registry`, `SettingsSheet`, `NewTripWizard`,
  whose comments each asserted the literal). `@tc/domain` needed no production
  change — `equality.ts` already compared `role`, and `detail.ts`/`hydrate.ts`
  pass `members` through whole rather than field-by-field, so the M18 PR 1
  hand-enumeration trap did NOT recur here. It is now tested rather than
  assumed: `equality.test.ts` asserts two states differing only by role are
  unequal, and `hydrate.property.test.ts` generates mixed-role member lists
  with a measured witness floor
- Not generated by `packages/domain/test/support/tripGenerator.ts`: that
  generator builds states by replaying commands, and no command adds a member
  or changes a role, so a non-owner member is unreachable there by
  construction. Non-owner roles are therefore asserted directly instead
- Breaking? no — `z.enum` widening accepts every `role: "owner"` already
  persisted in the `trip_summaries` / `trip_details` `members` jsonb. No
  migration, no event payload carries a role, and the projection rebuild is
  unaffected

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
