# M2 — History & time travel

**Goal:** prove the event-sourcing bet. The trip's event log becomes a
user-facing feature: a readable history, linear undo/redo, read-only preview
of any past state, and revert-to-state — all appended through the same one
command pipeline, never rewinding the log. M2 also retires the infra debt M1
found (shared preview/production database, hand-run production migrations,
ad-hoc psql resets) before any feature work starts.

Design record: `docs/specs/2026-07-08-M2-history-time-travel-design.md` ·
Mechanism decision: `docs/architecture/ADR-005` ·
Plan: `docs/plans/2026-07-08-M2-history-time-travel.md`

## Scope

- **Infra first (Tasks 0a–0c, done and committed before feature work,
  from M1's "Ops follow-ups for M2"):**
  - *0a — split preview/production databases:* Vercel Preview gets its own
    Neon branch database; Preview and Production `DATABASE_URL` become
    distinct values. Preview writes can no longer touch production data.
  - *0b — automated migrations:* a GitHub Actions job gated to `push: main`,
    running after CI passes, applies `drizzle-kit migrate` to production;
    preview deploys migrate their own branch database at build time. No more
    hand-run migrations.
  - *0c — DB reset/reseed helper:* `pnpm db:reset` truncates the event log +
    projections against a confirmed target. Temporary scaffolding — removed
    or folded into a real seed/fixture story before release.
- **Compensating events (ADR-005):** `UndoLastChange`, `RedoChange`, and
  `RevertToState` are ordinary `TripCommand`s whose decide step emits
  ordinary domain events computed by `diffTripStates(current, target)` — a
  pure function whose round-trip property (applying the diff reproduces the
  target state exactly) is fast-check tested. No new event types for history
  operations; no head pointer; the log only ever grows.
- **Envelope provenance:** `EventEnvelope` (and the `events` table) gain
  `batchId` (one per command execution) and `origin`
  (`user | undo | redo | revert`, with target refs). Existing events
  backfill as single-event `user` batches. The undo/redo stack
  (`deriveUndoRedo`) and history grouping are derived purely from this
  metadata.
- **Undo/redo semantics:** standard stack UX — repeated undo walks backward
  through effective batches; redo re-applies in reverse-undo order; any new
  effective change clears redo; the initial `TripCreated` batch is never
  undoable; a revert or dismissal is itself an effective, undoable action.
  To keep the stack sound, decide now rejects no-op commands (same-value
  start date, unchanged activity update, same-position move) with code
  `no-op` — every stored batch changes state.
- **History API + UI:** `GET /api/trips/[tripId]/history` (batch-grouped,
  human-readable entries, newest first, `canUndo`/`canRedo`) and
  `GET /api/trips/[tripId]/history/[seq]` (replay-to-seq `TripDetail`, no
  new storage). Board gains undo/redo buttons + `Cmd/Ctrl+Z` /
  `Shift+Cmd/Ctrl+Z`; a history panel lists entries (reverts as one entry,
  undone entries struck); clicking an entry shows a read-only board preview
  with "Revert to here" / "Back to now". Built against contract-derived MSW
  mocks first, then wired (M1 pattern).
- **Persistent conflict dismissal** (retires M1's client-local stopgap):
  `DismissConflict` → `ConflictDismissed` through the pipeline;
  `ConflictUndismissed` exists so dismissals are diffable/undoable.
  `TripState` and `TripDetail` track `dismissedConflictIds`. Conflict ids
  were verified already content-derived (`kind:dayId:idA:idB`), so a
  dismissal survives recomputation while the conflict's content is
  unchanged, and resurfaces if it changes.

## Design decisions recorded at planning (2026-07-08)

| Decision | Rationale |
|---|---|
| Linear undo + revert; selective mid-history undo deferred | Both compose the same per-event inverse machinery; selective undo's dependency-conflict semantics are a rabbit hole M2 doesn't need to prove the bet |
| Compensating events, not marker events or a head pointer | Log stays uniform and append-only; replay, projections, golden test, and conflict engine untouched; ADR-005 records the rejected options |
| Provenance on the envelope, not in the event vocabulary | Provenance describes how a change came to be, not what changed; Phase 2 inherits correlation ids for free |
| Decide rejects no-op commands (`no-op` code) | Guarantees every batch is state-changing, which the undo stack and non-empty diffs rely on; also stops same-spot drags polluting history |
| Read-only preview via replay endpoint | Proves time travel with zero new storage; the demo that shows the bet paid off |
| Dismissal keyed by content-derived conflict ids | Verified already true in M1's rules; dismissal persists while the conflict is identical, resurfaces when its content changes |

## Exit gate — all must be true

- [ ] Infra: a preview deployment demonstrably reads/writes the Neon branch
      database (a write on preview does not appear in production); a merge
      to `main` runs the migration job green with no manual step; `pnpm
      db:reset` works against the preview branch and is documented as
      scaffolding.
- [ ] Demo on the deployed Vercel URL: make board edits, undo them, redo
      them, open history, preview an earlier state read-only, revert to it,
      see conflicts recompute (a formerly-conflicted state resurfaces its
      badges), dismiss a conflict and see the dismissal survive a reload.
- [ ] Property tests (fast-check) green: the diff round-trip invariant and
      the undo/redo laws (undo∘redo = identity on state; new change clears
      redo; initial batch never undoable).
- [ ] Golden test: dropping both projection tables and rebuilding from a log
      that contains undo, redo, revert, and dismissal batches reproduces
      identical state — conflicts and dismissals included.
- [ ] Every new write goes through the one command pipeline; projection
      writes exist only in `src/server/projections.ts`; UI still imports
      only contracts + the typed client (lint wall green).
- [ ] History commands racing a concurrent write return the existing typed
      concurrency conflict (integration-tested).
- [ ] All M0 + M1 gates still green: both prior e2e scripts, optimistic
      concurrency, lint wall.
- [ ] `docs/contracts/CHANGELOG.md` has entries for the envelope change and
      every new M2 schema.
- [ ] Retro note appended to this file.

## Explicitly out of scope

Selective mid-history undo, fork/clone-with-lineage (M8), replay
snapshots/performance work, cross-trip or global history, history for CRUD
modules (Identity/Access — ADR-003), date semantics/anchors/geocoding/maps
(M3), costs (M4), realtime (M7), trip rename/delete, styling beyond
functional defaults.
