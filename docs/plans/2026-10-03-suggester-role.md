# Plan: the `suggester` role

Spec: `docs/specs/2026-10-03-suggester-role-design.md` (decisions §2, working decisions W1–W14).
ADR-063. Branch `claude/trip-propose-role-e917e7-hbqyx9`. Checked against `main` at `cffddee`.

**How it runs.**
- Each task goes to one `phase-implementer` subagent and stays inside the files it lists.
- Every new test is seen red first. The report gives the source edit and the failure text.
- Tier 2 checks run per task, using the `minimal-check-subset` skill's output for the files
  touched.
- T1 is a contracts change, so its sufficient subset is `pnpm check` (the skill does not narrow
  contracts).
- Tier 3 runs once, at T10.

**Decisions made during the build** are appended to the spec's §3 table as W15 and on. A
decision that changes Mitchell's approved §2 stops the task and comes back to the main thread.

---

## T1 — Contracts (its own step; AGENTS.md Workstreams rule)

**Scope:**
- `packages/contracts/src/{trip.ts,access.ts,history.ts,envelope.ts,suggestion.ts(new),index.ts}`
- `packages/contracts/test/{trip,access,suggestion(new)}.test.ts`
- `docs/contracts/CHANGELOG.md`
- The minimum consumer edits needed to compile:
  - `packages/domain/src/trip/history.ts` (`case "suggestion"` beside `"user"` in both switches,
    per W11)
  - `apps/web/src/server/accessPolicy.ts` (`RANK` = viewer 0, suggester 1, editor 2, owner 3,
    **exported**)
  - `apps/web/src/server/access/members.ts` (delete its `RANK`, import it)
  - any `Record<TripRole, …>` / `Record<InviteRole, …>` the compiler names

**Content:**
- `TripRole` = `["viewer","suggester","editor","owner"]`
- `InviteRole` = `["viewer","suggester","editor"]`
- `Origin` gains `{ kind: "suggestion", suggestionId: uuid, changeId: uuid, authorId: string.min(1) }`
- `TripEventsPage.suggestionsRev?: string`
- `suggestion.ts` holds the schemas in spec §4:
  - `CreateSuggestionInput` refuses a `DismissConflict` command, with a refine and a clear
    message (W3).
  - Bounds: units 1..100, commands per unit 1..50, note ≤ 500 trimmed.

**Tests:**
- The literal-list tests are updated.
- New: a suggestion schema test covering the DismissConflict refusal, the bounds and the
  `Origin` round-trip.
- Domain: a history test that a `suggestion` batch is undoable and described like a user batch.

**Checks:** `pnpm check` (contracts), then `pnpm --filter @tc/domain test`.

## T2 — One place decides what a role may do (W8)

**Scope:**
- `apps/web/src/lib/tripRole.ts` and its test
- `components/trip/context/TripProvider.tsx`: `readOnly` becomes `boardMode(myRole) !== "write"`,
  and the context gains `canEditBoard` (`boardMode !== "read"`) and `boardMode`. Suggest mode
  itself is T6.
- `components/trip/SettingsSheet.tsx`
- `components/pages/NotebookScreen.tsx`
- `components/pages/PageScreen.tsx`

**Content:**
- `boardMode(role: TripRole | null | undefined): "read" | "suggest" | "write"`
- `canEditNotebook(role): boolean`, true for editor and owner only

Every literal `"viewer"` check in those files moves onto one of the two helpers. A suggester sees
the notebook exactly as a viewer does.

**Default closed (W8 as amended).** `readOnly` stays true for a suggester, so every existing
consumer keeps hiding its controls until it opts in. T2 opts nothing in. It only changes the
helpers and the literals. T6 opts in the board surfaces: `Board`, `ActivityEditorSheet`,
`TripBoardScreen`'s edit paths, and `SettingsSheet`'s trip fields. These stay behind `readOnly`,
and the tests prove it:
- `ShareButton` (via `SettingsSheet`)
- `NotebooksMenu` create (via `TripProvider`)
- `AddSavedDayButton`
- `ConflictBanner` Dismiss
- `UndoRedoControls`
- `OverviewLens` and `TripHeader`, whatever they gate on `readOnly`. Audit both and list them in
  the report.

**Tests:**
- Table tests for both helpers.
- One render test proving a suggester gets the notebook read-only. Use the existing
  `NotebookScreen` or `PageScreen` test harness with `myRole: "suggester"`. It must go red when
  `canEditNotebook` returns true for a suggester.
- With `myRole: "suggester"`, `SettingsSheet` shows no Share and `NotebooksMenu` shows no create.
  This must go red when `readOnly` is computed as `boardMode === "read"`.

## T3 — Inviting as "Can suggest"

**Scope:**
- `components/trip/TravelersPanel.tsx` and its test
- `server/email/templates.ts` and its test
- `components/access/InviteLandingScreen.tsx`, `InviteLookScreen.tsx` and their tests
- the role-label helper if one exists, else a `roleLabel` in `lib/tripRole.ts` (T2's file; T3
  runs after T2)

**Content:**
- The picker offers Can edit / Can suggest / Can view.
- The member and invite badges read "Can suggest".
- The email's suggester wording: action "suggest changes to"; body "You'll be able to suggest
  changes, and the trip's editors decide what goes in."
- The landing `crewLine` for a suggester: "You can suggest stops and changes for the planners to
  approve."
- The look line for a suggester: "You're having a look first. Join and you can suggest changes
  for the planners to approve."
- The email's `role` type becomes `InviteRole`.

**Tests:**
- The picker offers the option and posts `role: "suggester"`.
- The email and both landing screens render the suggester line.

## T4 — Storage and the Suggestions module (server)

**Scope:**
- `apps/web/src/server/db/schema.ts`
- `apps/web/drizzle/0035_*.sql` and `meta/` (generated with `pnpm --filter web db:generate`;
  never hand-written)
- `apps/web/src/server/suggestions/**` (new)
- `apps/web/src/server/commands.ts` (`options.origin`, and the hook comment naming the second
  caller per ADR-063)
- integration tests under `server/suggestions/`

**Content** (spec §4 Server):
- `dependencies.ts` (pure):
  - `createdIds(unit)` and `referencedIds(unit)`, from `AddDay.dayId`,
    `AddActivity.activityId`, `SetTripDates.newDayIds`, and every dayId/activityId a command
    targets
  - `dependsOn(units)`, which gives the indices of earlier units whose created ids a unit
    references
- `create.ts` (`createSuggestion`, sketched below)
- `list.ts`: role-scoped listing
- `resolve.ts`:
  - accept: dependency gate → `executeTripCommandBatch(commands, reviewerId, hook,
    { origin })`. The hook runs a conditional update, and on 0 rows it throws a
    `SuggestionAlreadyResolved` error, which the route maps to 409.
  - dismiss and withdraw: transitive cascade over pending dependents, in one transaction.
  - A batch rejection answers `no-longer-applies` and leaves the row pending (W10).
- `rev.ts`: `suggestionsRevFor(tripId, viewer)`, a short hash over (id, status) of the changes
  this viewer may see, or `undefined` for a viewer or anonymous reader.

`createSuggestion(tripId, actorId, input)`:
1. Role check through the AccessPolicy seam: the member's role must be exactly `suggester`.
2. Load the detail.
3. Dry-run the units in order with domain `predictBatch`, chaining the predicted detail.
4. On a failure, answer `{ code: "does-not-apply", index }`.
5. On success, insert the suggestion and its change rows with each unit's description and
   `dependsOn`, as ids, in one transaction.

**Access rules:**
- Create needs `suggester` exactly.
- List needs at least `suggester`. A suggester sees only their own changes.
- Accept and dismiss need at least `editor`.
- Withdraw is the author only, while the change is pending.

These checks go through `accessPolicy.ts` (`memberRole`, `roleAtLeast`) on `effectiveMembers`,
so a lapse cap applies.

**Tests:**
- Unit tests for `dependencies.ts` (a property test: an independent unit never depends on
  anything).
- Integration tests (real Postgres, `*.int.test.ts`):
  - create refused for viewer and editor; does-not-apply refused with nothing stored
  - list scoping
  - accept appends a batch whose `origin.kind === "suggestion"`, with `actorId` the reviewer,
    and marks the row accepted
  - a double accept answers already-resolved with exactly one batch appended
  - accepting a dependent first is refused
  - dismissing a parent cascades
  - withdraw by a non-author is refused
  - accept by an editor capped to viewer by a lapse is refused
  - a rejected replay leaves the row pending

**Checks:** web typecheck, lint for touched files, the new unit tests, and `pnpm --filter web
test:int -- suggestions commands`.

## T5 — Routes, the poll's revision, exposure, client API, MSW

**Scope:**
- `apps/web/src/app/api/trips/[tripId]/suggestions/route.ts` (GET, POST)
- `.../suggestions/changes/[changeId]/route.ts` (POST `{action}`)
- `.../events/route.ts` (adds `suggestionsRev`)
- `server/public-api/exposure.ts` (two `PLANNED("Suggestions — not on the public API in v1")`)
- `lib/apiClient.ts` (`fetchTripSuggestions`, `createTripSuggestion`, `resolveSuggestionChange`)
- `mocks/handlers.ts` (the three routes; an in-memory list on `makeTripHandlers`)
- route int tests

**Content:**
- Errors use the existing route conventions (look at `commands/batch/route.ts`).
- Statuses: 404 for a non-member and for a viewer on list, 403 for a wrong role on a write, 409
  for already-resolved, dependency-pending or no-longer-applies, 422 for does-not-apply.
- Events: `suggestionsRev` is set only when the reader is a signed-in member with at least
  `suggester`. It is never set for a demo or invite-token read.

**Tests:**
- One route int test per route for the status mapping. Do not re-prove T4's rules.
- An events route test: a viewer's page has no `suggestionsRev`, and an owner's changes after a
  suggestion is created.

## T6 — Suggest mode in the provider, and the tray

**Scope:**
- `components/trip/context/TripProvider.tsx`
- `context/queueDrain.ts` and `unloadFlush.ts` (only if they need a guard)
- `components/board/SuggestionTray.tsx` (new) and its test
- `TripBoardScreen.tsx` (mount the tray)

**Content:**
- When `boardMode(myRole) === "suggest"`, `runDispatch` enqueues as it does for an editor, and
  the sequential sender does not send.
- `pagehide` and the unmount drain skip (W7).
- The context exposes `draft: { count, sending, error, discard(), send(note) }`:
  - `send` posts the units' commands to `createTripSuggestion`.
  - On success it clears pending, so the display returns to confirmed, and refreshes the
    suggestions.
  - On a 422 it keeps the draft and reports which change no longer applies.
- Undo and redo controls are hidden for a suggester (W13). They are already behind `readOnly`,
  which T2 left true for a suggester.
- The board surfaces opt in to suggest mode through `canEditBoard`: `Board`,
  `ActivityEditorSheet`, `TripBoardScreen`'s edit paths, and `SettingsSheet`'s trip fields (name,
  dates, currency, budget). Nothing else opts in, and conflict Dismiss stays hidden (W3).
- The tray:
  - reads "1 change not sent" / "N changes not sent", with Discard, Send suggestion and an
    optional note field
  - is an accessible region with the label "Suggestion draft"

**Tests:**
- A provider test with MSW:
  - a suggester's dispatch sends no command request
  - `send` posts once with all units
  - `discard` restores confirmed
  - `pagehide` sends nothing
- A tray render test.

## T7 — Reading suggestions and the overlay (W5)

**Scope:**
- `components/trip/context/useTripSuggestions.ts` (new)
- `lib/suggestionOverlay.ts` (new, pure) and its test
- `broadcast.ts` / `TripProvider.tsx`, to pass `suggestionsRev` through and expose
  `suggestions` on the context

**Content:**
- `suggestionOverlay(confirmed, changes)` returns:
  ```
  { byActivity: Map<activityId, Ghost[]>, byDay: Map<dayId, Ghost[]>,
    tripLevel: Ghost[], stale: Ghost[] }
  ```
  - `Ghost` is `{ changeId, suggestionId, authorId, description, kind: "add" | "update" |
    "move" | "remove", activity? }`.
  - Only pending changes are considered, in creation order.
  - A change is predicted on confirmed plus its pending `dependsOn` chain. A failure puts it in
    `stale`.
  - Trip-level commands (name, dates, currency, budget, RemoveDay, AddDay with no activities) go
    to `tripLevel`.
- The hook fetches on mount for `boardMode !== "read"`, and again whenever `suggestionsRev`
  changes.
- **`useTripBroadcast` gains `onSuggestionsChanged(rev)` (W16).** It fires when the page's
  `suggestionsRev` differs from the last one seen, independently of `headSeq`. Today's `poll`
  calls back only when `headSeq > before || resync` (`broadcast.ts:154`). That check is
  unchanged.

**Tests:**
- A broadcast test: a poll response with the same `headSeq` and a new `suggestionsRev` calls
  `onSuggestionsChanged` exactly once and `onChanged` not at all. The same rev again calls
  nothing. It must go red with the new branch removed.
- Overlay unit tests built from `@tc/factories`: an add, a move, a remove, a trip-level change, a
  stale target and a dependent pair.
- One property test: the overlay never mutates `confirmed`.

## T8 — Ghosts, the chip, and resolving

**Scope:**
- `components/board/{Board,Column,DayRiver,RiverBlock}.tsx` (ghost rendering only)
- `components/board/SuggestionsChip.tsx` (new)
- `components/board/SuggestionActions.tsx` (new: Accept / Dismiss / Withdraw)
- `TripHeader.tsx` (mount the chip)
- `HistoryPanel.tsx` ("Suggested by <name>" when `origin.kind === "suggestion"`). The name comes
  from the trip's member profiles, and a non-member reads "a former traveler" (W15). Find where
  `TravelersPanel` gets `TripMemberProfile[]` and reuse that fetch. Do not add a route.
- the tests for each

**Content:**
- Added stops render as ghost blocks in their day, labelled "Suggested: <description>".
- Changed, moved and removed stops carry a "Suggested change" marker that opens the actions.
- Accept and Dismiss are shown to editor and owner. Withdraw is shown to the author.
- A dependent's Accept is disabled with "Accept <parent description> first".
- The chip reads "N suggestions" and lists the trip-level and stale changes with the same
  actions. Stale ones read "No longer applies" and offer only Dismiss or Withdraw.
- After a resolve, the board refetches events and suggestions.
- Nothing renders for `boardMode === "read"`.

**Tests:**
- Render tests by role, label and value (never class names): an owner sees Accept on a ghost, a
  suggester sees Withdraw on their own, and a viewer sees no chip.
- An accept click calls the API and refreshes.

## T9 — Docs

**Scope:**
- `AGENTS.md`: a module-map row for Suggestions, after Access & Membership:
  `Suggestions | pending suggested changes and their review state | CRUD with audit fields; reaches the trip only by replaying commands through the pipeline (ADR-063) | planning state — a pending change is not on the stream`
- `docs/STATUS.md`: one line, if the file carries in-flight work off-milestone
- the spec's §3, for any W15+ decisions

## T10 — Tier 3, review, draft PR

- An e2e spec, `apps/web/e2e/suggester.spec.ts`, beside `m11-invites.spec.ts` and reusing its
  helpers: the flow in spec §5.
- `pnpm check`, `pnpm --filter web test:int`, `pnpm --filter web test:e2e:ci-like`,
  `pnpm seed:verify`.
- A full code review of the branch diff, with the findings fixed.
- A draft PR on `.github/PULL_REQUEST_TEMPLATE.md`. Its Migrations section names `0035`.
