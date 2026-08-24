# M2 — History & time travel

**Goal:** prove the event-sourcing bet. The trip's event log becomes a
user-facing feature: a readable history, linear undo/redo, read-only preview
of any past state, and revert-to-state — all appended through the same one
command pipeline, never rewinding the log. M2 also retires the infra debt M1
found (shared preview/production database, hand-run production migrations,
ad-hoc psql resets) before any feature work starts.

Design record: `docs/specs/2026-07-08-M2-history-time-travel-design.md` ·
Mechanism decision: `docs/architecture/ADR-005` ·
Plan: `docs/plans/2026-07-08-M2-history-time-travel.md` (archived)

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

- [x] Infra: a preview deployment demonstrably reads/writes the Neon branch
      database (a write on preview does not appear in production); a merge
      to `main` runs the migration job green with no manual step; `pnpm
      db:reset` works against the preview branch and is documented as
      scaffolding.
- [x] Demo on the deployed Vercel URL: make board edits, undo them, redo
      them, open history, preview an earlier state read-only, revert to it,
      see conflicts recompute (a formerly-conflicted state resurfaces its
      badges), dismiss a conflict and see the dismissal survive a reload.
- [x] Property tests (fast-check) green: the diff round-trip invariant and
      the undo/redo laws (undo∘redo = identity on state; new change clears
      redo; initial batch never undoable).
- [x] Golden test: dropping both projection tables and rebuilding from a log
      that contains undo, redo, revert, and dismissal batches reproduces
      identical state — conflicts and dismissals included.
- [x] Every new write goes through the one command pipeline; projection
      writes exist only in `src/server/projections.ts`; UI still imports
      only contracts + the typed client (lint wall green).
- [x] History commands racing a concurrent write return the existing typed
      concurrency conflict (integration-tested).
- [x] All M0 + M1 gates still green: both prior e2e scripts, optimistic
      concurrency, lint wall.
- [x] `docs/contracts/CHANGELOG.md` has entries for the envelope change and
      every new M2 schema.
- [x] Retro note appended to this file.

## Explicitly out of scope

Selective mid-history undo, fork/clone-with-lineage (M9), replay
snapshots/performance work, cross-trip or global history, history for CRUD
modules (Identity/Access — ADR-003), date semantics/anchors/geocoding/maps
(M3), costs (M4), realtime (M8), trip rename/delete, styling beyond
functional defaults.

## Retro (reconstructed 2026-08-24 — not written at gate close)

**This note is retroactive.** M2 shipped in July 2026 with none of its nine
exit-gate boxes ticked and no retro appended — the precise drift that
`docs/milestones/README.md`'s gate-close checklist opens by naming ("that is
how M2 stayed unticked"). The `TODO.md` tick was applied; flags 2 and 3 never
followed. Reconciled 2026-08-24 on Mitchell's instruction to close the missed
earlier gates. The boxes above are now ticked, but they were ticked *here*,
weeks late — so this note separates what the repo still proves from what is
inferred.

**Verified from artifacts still in the tree (2026-08-24):**

- **Property tests (box 3)** — `packages/domain/test/diff.property.test.ts`,
  `describe("diffTripStates round-trip (THE M2 invariant)")`, plus
  `history.test.ts` for the undo/redo laws.
- **Golden rebuild (box 4)** — `apps/web/src/server/projections.int.test.ts`
  ("rebuild reproduces them") and `history.int.test.ts` ("replays detail at a
  seq, conflicts recomputed").
- **One pipeline / projection boundary (box 5)** —
  `apps/web/src/server/projections.ts` is still the only projection writer,
  held by the lint wall.
- **Concurrency conflict (box 6)** — `eventStore.int.test.ts` and
  `commands.int.test.ts`.
- **Contracts changelog (box 8)** — the `2026-07-08 — M2 history & time travel
  schemas` entry covers the envelope change (`EventEnvelope` gains required
  `batchId` + `origin`, flagged breaking with the Task 5 backfill) and every
  new M2 schema.

**Assumed, not verified (boxes 1, 2, 7).** The preview/Neon infra check, the
deployed-URL demo, and "all M0 + M1 gates still green" were point-in-time
checks against a July 2026 deployment; nothing in the tree preserves their
result. They are ticked on the reasoning that M2's substance is load-bearing
for M3–M8 — every one of which shipped on top of undo/redo/revert and
persistent conflict dismissal — not because anyone re-ran them.

**What we learned.** The round-trip property test was written as *the* M2
invariant, and it still missed a real correctness bug: `diffTripStates`
silently dropped day **order**, filed as KI-1, mis-triaged as a flake for two
weeks, and not fixed until 2026-07-27/28. The generator explored trip content
but not day permutation, so the invariant was true over a subspace and read as
true everywhere. `diff.property.test.ts` now carries both a
`"diffTripStates day ordering (KI-1 regression)"` block and an explicit
`"the generator explores a real input space, not a degenerate one"` test —
the second being the durable lesson: a property test is only as strong as the
generator, and the generator deserves its own assertion.

**The other lesson is this file.** M2's gate evidence had to be reconstructed
from test names 47 days later because the checklist was never flipped in the
gate-close commit. That is what the one-commit rule in
`docs/milestones/README.md` exists to prevent.
