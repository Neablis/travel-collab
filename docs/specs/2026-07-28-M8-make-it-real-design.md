# M8 design — Make it real (trip lifecycle, ergonomics, subtraction, states)

**Date:** 2026-07-28 · **Status:** Approved by Mitchell (decisions 1–8 below)
**Companions:** ADR-003 (event-sourcing scoped to planning), ADR-006
(`ConflictContext` / timezone — amended by this milestone), ADR-013 (atomic
batches + optimistic updates), ADR-015 (AI tools derived from schemas),
ADR-016 (trip soft delete as a domain event), ADR-017 (duplicate as a server
operation), `docs/milestones/M8-make-it-real.md`, `docs/known-issues.md` (KI-1,
KI-5, KI-12, D-1), `AGENTS.md`

## 1. Goal

Close the floor under the Phase 1 gate. Every M0–M7 milestone is ticked and the
gate — *"Mitchell plans a real trip end-to-end and needs no other tool"* — has
not been met, because **a trip cannot be renamed or deleted by anyone**.
`SetTripName` does not exist as a command, `TripNameSet` does not exist as an
event, and there is no `DELETE` route. A trip's name is written once at
`CreateTrip` and is immutable forever.

This milestone adds the trip lifecycle that absence implies, makes the core
add/move loop bearable, **subtracts** two surfaces that were built but never made
legible (anchors, the Notebook's macro vocabulary), and gives every surface a
first-run and empty state. Interaction design lives here; visual craft is M10 and
is deliberately separate — M5 proved that re-skinning a structure that is still
moving gets redone.

No invariant weakens. Every lifecycle change is a command through the standard
pipeline producing events (§Invariant 1); `TripState` gains a `status` field and
every consumer of that state is updated in the same PR (§Invariant 5).

## 2. Decision log (all explicitly made by Mitchell, 2026-07-28)

| # | Decision | Alternatives rejected |
|---|---|---|
| 1 | **One M8 spec covering all five scope areas, implementation sequenced into four waves.** | Wave-1-only spec (lifecycle now, interaction design later); two specs split subtractive-then-additive |
| 2 | **Deletion is an evented soft delete with an undo toast. No archive yet.** `DeleteTrip` → `TripDeleted`; `TripState.status` gains `deleted`; `decide` rejects every command on a deleted trip except `RestoreTrip`; `trip_summaries` filters it out. Rebuild-from-log still reproduces deletion, so Invariants 1–2 hold untouched. Recovery is an undo toast on the trip list — covers the misclick, no trash view to design | archive **and** delete as separate evented states (doubles the state machine and needs an archived-trips surface the gate doesn't ask for); archive evented + delete as a true hard purge (irreversible by construction, and would orphan lineage pointers when M11's fork lands, since a fork's ancestor stream could vanish) |
| 3 | **`SetTripDates{startDate, endDate}` reconciles day count.** One command, batched events: `TripStartDateSet` plus N × `DayAdded` (extend) or `DayRemoved` (shrink). Shrinking is non-destructive — `DayRemoved` already drops that day's activities to the backlog — and M6 batching makes the whole reconcile **one undoable history entry**. `end < start` is rejected | keep end derived, no new command (then "set its dates" means exactly what the product already does — the thing that didn't feel real); store an explicit `endDate` in state (it can then disagree with `days.length` — a stored value contradicting derived truth, the same species as the anchors problem) |
| 4 | **Duplicate stays in M8, lineage-free.** A duplicate copies a trip's state into a fresh stream with **fresh ids** and no ancestor pointer | cut it to M11 (it isn't in M8's exit gate and is M11's headline); build it with lineage now (pulls a real slice of M11 forward and enlarges M8's contract change) |
| 5 | **`SetTripName` and `SetTripDates` become AI-batchable; `DeleteTrip`, `RestoreTrip`, and duplicate never are.** Tool schemas are *derived* from `BatchableCommand` (ADR-015 / Invariant 5), so inclusion **is** the decision. The system prompt restricts renaming to a placeholder name or an explicit user request. Closes KI-12 | unguarded renaming (the AI renames a trip you already named as a side effect of an unrelated request); dates-only, holding `SetTripName` until M9's approve-before-commit (leaves KI-12 half-open, contradicting the milestone's "Closes KI-12") |
| 6 | **`SetTripStartDate` is left alone.** Not retired, not deprecated, no deprecation plan today. The `TripStartDateSetV1` **event** must be kept for history/replay regardless. The command's supersession by `SetTripDates` is recorded as a known-issues entry so it doesn't evaporate | retire the command from both unions in this PR (real contract removal, changelog + all consumers — churn this milestone doesn't need) |
| 7 | **The Notebook pullback covers authoring and seeding; `ComposePanel` stays.** The slash-menu macro affordance goes and the two seeded templates become plain-content starters. AI compose survives because AI is M9's subject and removing it pre-empts that milestone's design | authoring only (templates keep seeding macro content nobody can author — recreates the anchors problem in a new place); authoring + seeding + AI compose (cleanest dormancy story, but removes a surface M9 will likely want back, and M9 is next) |
| 8 | **Wave C also lands the KI-5 sync indicator.** Quick-add is a rapid-fire command generator pointed at a known silent-data-loss hole; surface the existing `pending` from `useTrip()` as "syncing… / all changes saved", matching KI-5's recorded fix path verbatim | keep Wave C to stated scope (knowingly widens an open bug); add a `beforeunload` guard too (explicitly rejected in KI-5's fix path in favor of a visible indicator) |

## 3. Wave sequencing

The dependency constraints are narrower than the scope list suggests. Wave A
(contracts/domain/server + trip header & settings UI) and Wave B (`AnchorEditor`,
Notebook) touch **disjoint files**. The only hard orderings are **B before C**
(both edit `ActivityEditor`) and **D last** (it is a pass over a surface
inventory every other wave is still changing — the M5 retro lesson the milestone
file already cites).

| Wave | Content | Gate |
|---|---|---|
| **A** | Trip lifecycle: `SetTripName`, `SetTripDates`, `DeleteTrip`, `RestoreTrip`, duplicate | Contract change is its own reviewed step before dependent feature work (AGENTS.md workstream rule) |
| **B** | Anchors UI retired; `ConflictContext.timezone` resolved; Notebook pulled back | Anchor domain tests still green and carrying the dormancy note |
| **C** | Search-to-add, quick-add, non-drag move, KI-5 sync indicator | Existing drag-and-drop still works |
| **D** | First-run and empty states across the stable inventory | Exit-gate script runs without asking how anything works |

Sequential, not parallel. The two file-disjoint waves *could* run in separate
worktrees per AGENTS.md, but M3's git index race — one agent's `git reset --soft`
silently dropping a sibling's committed work — is exactly this setup, and for two
waves this size the coordination cost exceeds the saving.

## 4. Wave A — the contract change

### 4.1 New surface

| Command | Event(s) | Batchable / AI-reachable |
|---|---|---|
| `SetTripName{tripId, name}` | `TripNameSetV1` | yes (prompt-guarded) |
| `SetTripDates{tripId, startDate, endDate, newDayIds}` | `TripStartDateSetV1` + N × `DayAddedV1` / `DayRemovedV1` | yes |
| `DeleteTrip{tripId}` | `TripDeletedV1` | **no** |
| `RestoreTrip{tripId}` | `TripRestoredV1` | **no** |

`name` reuses `CreateTrip`'s bounds (`min(1).max(200)`). Dates reuse the existing
`ISO_DATE` regex and nullable-clears convention.

**`SetTripDates` reconciliation rules**, stated exactly because "N × `DayAdded` /
`DayRemoved`" is otherwise ambiguous:

- Target day count = inclusive day span of `[startDate, endDate]`. Extending
  **appends**; shrinking removes from the **tail**, so day 1 stays pinned to
  `startDate` and no surviving day is silently redated. (Day order *is* date —
  KI-1's lesson.)
- `endDate: null` with a non-null `startDate` sets the start date only and leaves
  day count untouched — the existing `SetTripStartDate` behavior.
- `startDate: null` requires `endDate: null`; it clears the dates and leaves day
  count untouched. A non-null `endDate` with a null `startDate` is **rejected** —
  an end with no start has no day span to reconcile against.
- `endDate < startDate` is **rejected**.
- The reconcile never removes the last day; a target count below 1 is
  **rejected** rather than silently clamped.
- A reconcile that changes nothing is a no-op rejection, like every other
  command (`okUnlessNoOp`).

**Why `SetTripDates` carries `newDayIds`** (found while planning, 2026-07-28):
extending a trip emits `DayAdded`, which requires a `dayId`, and the domain may
not mint UUIDs (Invariant 4 — no I/O, no nondeterminism). The caller supplies
them, exactly as the UI already does for `AddDay`. The AI path needs nothing
special: `idFields.ts` already mints server-side ids for manifest-classified
uuid fields, so the model never emits one.

**Why `RestoreTrip` rather than routing the undo toast through `UndoLastChange`:**
undo would need a carve-out in the delete guard to run on a trip it is otherwise
forbidden to mutate. An explicit inverse avoids the exemption, and gives a future
trash view a restore path with no redesign.

### 4.2 `TripState.status` — the five places it ripples

`TripState` gains `status: "active" | "deleted"`. Missing any one of these is a
silent bug of a species `AGENTS.md` already catalogues:

1. **`evolveTrip`** — two new cases (`TripDeleted`, `TripRestored`).
2. **`decideTripCommand`** — a deleted trip rejects every command except
   `RestoreTrip`.
3. **`tripStatesEqual`** — must compare `status`, or `okUnlessNoOp` misfires and
   a delete-then-delete is accepted as a real change.
4. **`diffTripStates` needs reconciliation steps for BOTH `status` and `name`.**
   Without status, undo/revert cannot cross a delete. **And `name` is the
   sharper one, found while planning:** `diff.ts:12` states a precondition —
   *"tripId/name/members never differ between two states of one trip (no rename
   /membership commands exist in Phase 1)"* — that `SetTripName` falsifies.
   `tripStatesEqual` compares `name`, so without a rename step the M2 round-trip
   property goes red. Both are precisely the KI-1 failure shape (a reconciliation
   step that silently emits nothing), and this is also the
   comment-asserting-an-unenforced-invariant pattern — so the stale comment gets
   rewritten in the same change, and both steps get a property test with a
   **measured** witness floor. Restore is emitted **first** and delete **last**,
   so the rest of the diff always reconciles a live trip.
5. **`applyTripEvents`** currently handles only `TripCreated`
   (`apps/web/src/server/projections.ts:22`, comment: *"M1 events don't touch the
   summaries read model"*). Rename, delete, and restore must all reach
   `trip_summaries`; the rebuild-golden test is what proves it.

`TripDetail` and `TripSummary` both carry `status`. `GET /api/trips` filters
deleted trips. `GET /api/trips/[tripId]` **returns** a deleted trip with
`status: "deleted"` rather than 404-ing, so someone holding the URL — an open tab
at the moment of deletion, or a back-navigation — gets a legible "this trip was
deleted / restore it" state instead of a dead end.

**Pages are untouched by delete and restore.** The Notebook is a separate CRUD
module that references trips by id only (ADR-014); a soft-deleted trip's pages
stay as they are, unreachable because the trip is, and return intact on restore.
Cascading into another module's rows would be exactly the boundary violation
ADR-003 scopes against.

### 4.3 Duplicate is a server operation, not a domain command

Duplicate creates a **new stream**, so it does not fit `TripCommand`'s
one-stream shape. `POST /api/trips/[tripId]/duplicate`:

1. Load the source `TripState`.
2. Remap every `dayId` and `activityId` to a fresh UUID.
3. `CreateTrip{newTripId, name: "<name> (copy)"}`.
4. `diffTripStates(emptyState, remappedState)` → command list → executed as one
   atomic batch on the new stream.

Step 4 reuses machinery built for exactly this transformation. Step 2 is
deliberate: reusing source ids across streams is the KI-1 hazard (its post-mortem
notes fork-with-lineage will want to preserve day ids, which is what made the
ordering bug reachable), and minting fresh ones leaves M11 free to decide id
preservation on its own terms.

The duplicate's history starts clean — one creation entry — rather than
inheriting the source's undos and reverts.

**Planning state only; pages are not copied.** The duplicate gets days,
activities, dates, currency, and budget. It does not get the source trip's
Notebook pages — same module boundary as §4.2, and copying prose is template
machinery, which is M11's bet. Dismissed conflicts are not carried either: they
are occurrence-scoped by KI-14's decision, and a fresh trip has had no
occurrences.

### 4.4 UI (minimal in this wave)

Rename in `TripHeader`; the date range in `SettingsSheet` (extending
`TripDateControl` from a single start date to a range); delete and duplicate in
`SettingsSheet` plus the trip-list row; undo toast on the trip list after delete.

### 4.5 AI

`SetTripName` and `SetTripDates` join `BatchableCommand`. Because decision 6
leaves `SetTripStartDate` in place, the AI ends up with **two overlapping date
tools** — handled in the system prompt (prefer `SetTripDates`), not by touching
the union. KI-11 is the standing warning here: mocked AI tests cannot detect a
model mishandling overlapping tools, so this gets a live-prompt check with `meta`
read afterward, per that entry's mitigation.

## 5. Wave B — subtraction

### 5.1 Anchors: UI retired, domain dormant (D-1)

**Goes:** `apps/web/src/components/board/AnchorEditor.tsx`, its test, and every
entry point in `ActivityEditor`.

**Stays:** the `Anchor` contract, the anchor-violation rules in
`packages/domain/src/trip/conflicts.ts`, `anchor-conflicts.test.ts`,
`anchors-state.test.ts`, **and** `apps/web/src/server/anchors.int.test.ts` — the
server command path still carries anchors, so it remains part of the tripwire.
The dormancy note at the domain code points to D-1 in `known-issues.md`.

**Verification step, not an assumption.** Any activity that *already* carries an
anchor keeps firing anchor-violation conflicts, and after this wave no UI can
show or clear the cause — the user sees a conflict they cannot act on. Before
merging, confirm no trip in production has a non-empty `anchors` array. If any
do, a one-time clear is part of this wave.

### 5.2 `ConflictContext.timezone`

Removed, along with the `TRIP_TIMEZONE` env var, with an ADR-006 amendment
recording why: it is injected, documented, and read by no rule. This is the
milestone file's own instruction ("retire in the same pass or document why not").

### 5.3 Notebook pulled back to plain notes

**Goes from the primary surface:** the slash-command macro affordance
(`useMacroSuggestion`, `MacroSuggestionList`), and macro-bearing content in the
two seeded templates (Trip Overview, Day Sheet), which become plain-content
starters.

**Stays:** `MacroNodeExtension` **registered for rendering**, the registry, the
7 macros, the three block renderers, `DayBindingControl`, and `ComposePanel`.

**The data-loss hazard that makes this distinction load-bearing:** `PageContent`
is stored TipTap/ProseMirror JSON. If `MacroNodeExtension` is unregistered,
existing pages' macro nodes are dropped on the next save. Rendering must stay
registered while authoring leaves. A test pins this: a page containing a macro
node round-trips through load → edit → save with the macro intact.

The ambitious macro vocabulary returns in M14. Seven macros is not an authoring
vocabulary, and the block renderers were built after M5 closed, so they never had
a design pass.

## 6. Wave C — core-loop ergonomics

**Search-to-add.** Geocoding today is bound to the location *field of an
already-created activity* (`LocationInput` inside `ActivityEditor`), behind a
type-then-press-Search interaction. This adds a day-level "Add a place"
affordance: search → pick → one `AddActivity` with the title taken from the place
name and location prefilled. Reuses `/api/geocode` and the existing command —
**no contract change.**

**Quick-add.** Per-column input; Enter appends `AddActivity{title}` to that day.
No editor round-trip.

**Moving activities.** Drag-and-drop already works and is the thing to protect,
not replace. This adds a non-drag path — "Move to…" on `ActivityCard` (day +
position) — which is simultaneously the keyboard and touch path. Emits the
existing `MoveActivity`.

**KI-5 sync indicator (decision 8).** `pending` is already exposed on
`useTrip()`; surface it as "syncing… / all changes saved" so the user can *see*
when it is safe to navigate away. Quick-add materially raises exposure to KI-5's
silent loss — commands still queued behind the one in flight are dropped with no
error and no visual difference, because the UI already rendered them as done.

## 7. Wave D — first-run and empty states

Interaction design only: flows, information architecture, and states. Not
palette — that is M10.

- **First-run.** A newly created trip is currently a bare board with zero days.
  It becomes a first-run state naming the next actions (set dates, add days, ask
  AI) instead of an empty grid.
- **Every surface's empty state**, each saying what it is and the *one* next
  action: board (no days / days but no activities / empty backlog), map (nothing
  located), timeline (nothing timed), itinerary, notebook (no pages — newly
  reachable, since §5.3 stops auto-seeding), history (no changes yet), trip list
  (already exists).

Composition over the existing `EmptyState` and `EmptyChip` primitives. No new
primitives.

## 8. Testing

Per the Definition of Done and the testing model:

- New domain logic gets unit **and** property tests, with witness floors
  **measured near half the observed minimum, not guessed** — a guessed floor
  either flaps or catches nothing, and both have happened here.
- **`diffTripStates` status reconciliation gets its own property test.** It is
  KI-1's exact shape, and KI-1 was a real correctness bug filed as possible flake
  for two weeks.
- The **projection-rebuild golden test** is re-run because `applyTripEvents`
  learns three new events.
- A macro-node round-trip test pins §5.3's rendering-stays-registered rule.
- New routes get integration tests against real Postgres.
- `m8.spec.ts` walks the exit-gate script; every prior milestone's e2e stays
  green.
- After any AI-layer change, run a **live** prompt and read `meta` — mocked tests
  cannot detect the overlapping-date-tool risk §4.5 introduces (KI-11).

## 9. Explicitly out of scope

- **Archive** as a distinct state (decision 2). Revisit when a trip exists worth
  archiving.
- **Lineage / fork / templates** — M11. Duplicate here is deliberately
  lineage-free (decision 4).
- **Retiring or deprecating `SetTripStartDate`** (decision 6). Tracked, not done.
- **The macro authoring vocabulary** — M14.
- **Visual craft** — M10.
- **A trash view / list of deleted trips.** Recovery is the undo toast plus the
  per-trip restore state at a deleted trip's own URL (§4.2). There is no surface
  that enumerates deleted trips.
- **Copying pages on duplicate, or cascading delete into them** (§4.2, §4.3).
- **Approve-before-commit for AI** — M9. It is the durable fix for the silent
  rename risk decision 5 mitigates by prompt.

## 10. Non-negotiables carried from AGENTS.md

- The event log stays the sole source of truth for planning. Delete is an event,
  not a row deletion; the projection filters, it does not diverge.
- Projections stay disposable — rebuild-equals-stored still holds with three new
  events.
- Conflicts stay data, not errors.
- `packages/domain` stays pure — the date reconciliation in §4.1 is computed from
  passed-in values, never a wall-clock read.
- Contracts change by protocol: `docs/contracts/CHANGELOG.md` entry, all
  consumers updated in the same PR.
- Single-player now, multi-persona always: `DeleteTrip` and `RestoreTrip` carry
  `actor_id` like every other event, and the delete guard is a state check, not
  an owner check — permission stays behind the AccessPolicy seam.
