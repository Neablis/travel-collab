# M2 design — History & time travel

**Date:** 2026-07-08 · **Status:** Approved by Mitchell (decisions 1–6 below)
**Companions:** ADR-003 (history substrate), ADR-005 (compensating events),
`docs/milestones/M2-history-time-travel.md`, `AGENTS.md`

## 1. Goal

Prove the event-sourcing bet before M3–M5 build breadth on top of it: a
history UI over the trip's event log, linear undo/redo, and revert-to-state —
all without weakening Invariant 1 (the log is the sole source of truth, every
write goes `command → validate → append → project`).

M2 also pays down the infra debt recorded in M1's "Ops follow-ups for M2"
(§7): those land first, as Task 0-style items, before any feature work.

## 2. Decision log (all explicitly made by Mitchell, 2026-07-08)

| # | Decision | Alternatives rejected |
|---|---|---|
| 1 | **Linear undo + revert-to-state.** Undo reverses the most recent effective change; revert jumps to any past point. Both compose the same per-event inverse machinery | selective mid-history undo (dependency-conflict rabbit hole; defer until demanded); revert-only (loses the ctrl-Z affordance) |
| 2 | **Standard stack undo/redo UX.** Repeated undo walks backward through effective actions; redo re-applies in order; any new change clears the redo affordance | undo-only; Emacs-style undo chain (confusing UX) |
| 3 | **Read-only past-state preview.** Clicking a history entry shows the full board as of that point (banner-marked, drag disabled) with "Revert to here" | diff-summary-only (weak proof); full scrub/slider browse mode (extra machinery, same substrate proof) |
| 4 | **Persistent conflict dismissal ships in M2** via `DismissConflict` through the standard pipeline — retiring the debt M1 explicitly parked for M2 | defer again (debt was deferred *to* M2) |
| 5 | **Mechanism A: compensating events** (ADR-005). Undo/redo/revert append ordinary domain events computed as a state diff; history moves forward even when the trip moves back | B: marker/snapshot event (breaks the pure fold, or freezes TripState into an eternal event schema — the ADR-003 trap); C: movable head pointer (log stops being the sole truth; weakens Invariant 1) |
| 6 | **Provenance lives on the envelope**: `batchId` + `origin` columns/fields, not marker events | no-op marker events (non-domain events in the eternal vocabulary; doesn't solve grouping for plain user commands) |

## 3. Domain & contracts

**New commands** (join the `TripCommand` union; same single `/commands`
endpoint): `UndoLastChange`, `RedoChange`, `RevertToState { toSeq }`,
`DismissConflict { conflictId }`.

**New events:** only `ConflictDismissed { conflictId }` and
`ConflictUndismissed { conflictId }` (the latter exists so dismissals are
diffable, hence undoable). Undo/redo/revert emit **existing** domain event
types — no `TripReverted` event exists.

**The workhorse — `diffTripStates(current, target): TripEvent[]`** (pure, in
`packages/domain`): emits ordinary domain events that transform `current`
into `target`. All three history operations reduce to it:

- revert to seq N → diff(current, fold-to-N)
- undo → revert to just before the last effective batch
- redo → revert to just before the undo batch being redone

Its correctness property is the milestone's central fast-check invariant:
*for any event history and any target point, applying the diff to the current
state reproduces the target state exactly* — conflicts and dismissals
included.

**`deriveUndoRedo(envelopes) → { undoTarget?, redoTarget? }`** (pure): the
undo/redo stack derived entirely from envelope provenance. Laws (pinned by
property tests; exact fold algorithm specified in the implementation plan):

- undo is never offered for the initial `TripCreated` batch (there is no
  prior state to diff to);
- a revert or dismissal batch is itself an effective, undoable action;
- undo∘redo is the identity on state;
- any new effective change clears `redoTarget`;
- nothing to undo/redo → the command is rejected with a typed error through
  the normal decide path.

**`describeBatch(stateBefore, batch)`** (pure): structured human-readable
history entry ("Moved 'Colosseum' from Backlog to Day 2"). Takes the state
before the batch so names resolve even when payloads carry only ids; the
server replays anyway, so this is free.

**Envelope contract change** (its own reviewed step, per AGENTS.md):
`EventEnvelope` gains `batchId` (uuid, one per command execution) and
`origin`, a tagged union: `{ kind: 'user' } | { kind: 'undo', undoesBatchId }
| { kind: 'redo', redoesBatchId } | { kind: 'revert', toSeq }`. Migration
backfills existing M0/M1 events as single-event `user` batches. Changelog
entry + all consumers updated in the same PR.

**Content-derived conflict ids** (prerequisite for dismissal): a conflict's
`id` becomes a deterministic hash of `(kind, subjects)` so the same conflict
keeps its identity across recomputations. Consequence, stated deliberately:
a dismissed conflict stays dismissed while its content is identical; if the
underlying situation changes (e.g. an activity moves and the overlap pair
changes), the id changes and the conflict resurfaces undismissed. Dismissed
ids are part of `TripState` (event-sourced), so they rebuild from the log
and participate in undo/revert.

## 4. Server & API

The pipeline keeps its exact shape — that is the point of mechanism A:

- **Decide** for the three history commands receives the envelope history
  (already loaded in pipeline step 2 — zero extra I/O; domain stays pure,
  events are passed in).
- **Append** writes `batchId` + `origin` on every event.
- **Step 7** recomputes conflicts as always — reverting into a
  formerly-conflicted state resurfaces its badges. Conflicts stay data.
- A history command racing another write hits the existing
  optimistic-concurrency guard and returns the existing typed retry result.

**New read endpoints** (contract-typed, changelog entries):

- `GET /api/trips/[tripId]/history` → batch-grouped entries, newest first:
  `{ batchId, seqRange, actorId, occurredAt, kind, description, undone }`,
  plus `canUndo` / `canRedo` for the board buttons.
- `GET /api/trips/[tripId]/history/[seq]` → `TripDetail` as of that seq —
  pure replay via the existing fold + `tripDetailFromState`; no new storage.
  Phase 1 trips are small; replay latency is a non-concern (snapshots remain
  deferred per the foundation design).

## 5. UI

- Board gains undo/redo buttons (enabled from `canUndo`/`canRedo`) and
  `Cmd/Ctrl+Z` / `Shift+Cmd/Ctrl+Z` shortcuts.
- History panel on `/trips/[tripId]`: batch-grouped entries, newest first;
  a revert renders as **one** entry ("Reverted to before …"), never an event
  burst; undone entries visibly struck/dimmed.
- Clicking an entry swaps the board into read-only preview of that past
  state: banner "Viewing as of …", drag and editing disabled, actions
  "Revert to here" and "Back to now".
- The conflict banner's dismiss button becomes a real `DismissConflict`
  command — dismissals persist across reloads, appear in history, and are
  undoable. (Replaces M1's client-local hiding.)
- Built against contract-derived MSW mocks with component tests first, then
  wired to the real API — the M1 pattern.

## 6. Testing

- **Property (fast-check):** the diff round-trip invariant (§3); the
  undo/redo laws (§3).
- **Golden rebuild test extended:** histories containing undo, redo, revert,
  and dismissal batches drop-and-rebuild to identical state, conflicts and
  dismissals included.
- **Integration:** envelope migration + backfill; history/preview endpoints;
  a revert racing a concurrent append returns the typed concurrency
  conflict; a dismissal survives reload and recomputation.
- **E2E (Playwright), one new script:** edit → undo → redo → open history →
  preview a past state → revert → a dismissed conflict stays dismissed after
  reload. M0 + M1 scripts stay green untouched.

## 7. Infra first (from M1's "Ops follow-ups for M2")

Done and committed **before any feature work**, M1's Task 0 pattern:

- **0a. Separate preview and production databases.** Vercel Preview gets a
  proper Neon branch database; `DATABASE_URL` for Preview and Production
  become distinct values (ADR-004's original intent, never wired up).
- **0b. Automate the production migration step.** GitHub Actions job gated
  to `push: main`, running after CI passes, executing `drizzle-kit migrate`
  against production via a `DATABASE_URL` secret. No more hand-run
  migrations. (Preview build-step migration against the branch DB becomes
  safe once 0a lands; wire it there.)
- **0c. DB reset/reseed helper** for testing against Preview/Neon without
  ad-hoc psql one-liners. Explicitly temporary scaffolding — removed or
  folded into a real seed/fixture story before release, per ADR-004's "DB
  resets are cheap" framing.

## 8. Out of scope

Selective mid-history undo, fork/clone-with-lineage (M7), replay
snapshots/performance work, cross-trip or global history, history for
non-planning (CRUD) modules, date semantics/anchors/maps (M3), costs (M4),
realtime (M6).
