### KI-2026-09-22-c — wiring undo to the page aggregate naively would delete every notebook on a revert

- **Severity:** would be DATA LOSS if built without reading this. Nothing is
  broken today: undo, redo and revert do not touch pages at all, and a test
  pins that. This entry exists so the next person to finish the job does not
  finish it the obvious way.
- **Milestone:** **M14, carried (assigned 2026-09-24, KI pass)** — owned by M14 (the notebook/widget builder), not a gate box. Listed in `docs/milestones/M14-rich-layer.md` § *Parked 2026-09-24*.
- **Area:** `packages/domain/src/trip/history.ts` (`decideHistoryCommand`),
  `packages/domain/src/trip/pageState.ts` (`diffPageStates`, `foldPages`),
  `apps/web/src/server/pageCommands.ts` (the lazy genesis).

- **THE TRAP.** `decideHistoryCommand` folds the stream to a target seq and
  diffs the current state against it, emitting the forward events that get
  there (ADR-005: history moves forward to an earlier state, it does not rewind
  the log). `diffPageStates` is built and ready to be the page half of that.
  Plugging it in looks like a two-line change and is not.

  A page's genesis event sits at the seq where it was **backfilled**, not where
  the page was created. `pageCommands.ts` writes `PageCreated` lazily, the first
  time a page is commanded, because every page that existed before 2026-09-22
  is a row that `listPages` seeded straight to the table with no event at all.

  So for a trip whose notebooks predate this work:

  ```
  seq 1..N     the trip's own history, no page events anywhere
  seq N+1      PageCreated (backfilled, written the first time someone edited)
  seq N+2      PageEdited
  ```

  `foldPages(envelopes, K)` for any `K < N+1` returns `{}`. `diffPageStates`
  compares that against the present — which has the page — and correctly, by its
  own rules, emits `PageDeleted` for it. **Reverting a trip to any version older
  than the backfill would delete every notebook on it.** The older the version a
  person reverts to, the more certainly it happens.

- **Why it is not a bug today.** `decideHistoryCommand` diffs the trip aggregate
  only. `apps/web/src/server/pageCommands.int.test.ts` carries
  *"does not delete notebooks when the trip is reverted behind their genesis"*,
  which reverts to seq 1 and asserts the page is still there. That test goes red
  the moment someone wires `diffPageStates` in without solving this, which is
  the whole reason it was written before the wiring rather than after.
  **Since 2026-09-24 (M14 T14)** the same safe state is also pinned for arbitrary
  interleavings by `packages/domain/test/pageHistory.property.test.ts`. Splicing
  `diffPageStates` into the undo decision turns it red with the minimal
  counterexample (add a day, create a notebook, undo → `PageDeleted`). ADR-036
  decision 2 is amended to rest on exactly this.
  The projection rebuild built then does NOT go through the fold's revert logic, so
  it cannot hit this trap. It replays events, and a backfilled genesis on an
  existing row keeps the row's timestamps (`applyPageEvents`).

- **Shape of an answer, none of it costed.** The root problem is that a
  backfilled genesis is not a real create, and undo must be able to tell the
  difference:
  1. **Mark the backfill.** A flag on the event payload, or a distinct type, so
     `diffPageStates` treats a page whose genesis is a backfill as a FLOOR —
     present at every earlier seq, never deleted by a revert. Undoing a genuine
     user `CreatePage` still deletes, which is right.
  2. **Backfill at seq 0**, before the stream's own genesis. Cleanest model,
     hardest write: `events` has a unique `(stream_id, seq)` and existing rows
     already occupy 1..N.
  3. **Exclude pages from revert but not from undo.** Undo targets one batch,
     which for a page edit is well defined; revert targets an arbitrary seq,
     which is where the floor problem bites. Smallest fix, and a real
     asymmetry to explain to a reader.

- **A second, smaller trap in the same area**, worth naming while someone is in
  here: a page whose stored document does not parse as a `PageDoc` is skipped by
  the lazy genesis (ADR-038 decision 4 — a document that cannot be saved
  losslessly must not be saved). Such a page has no genesis, so it is invisible
  to the fold and any page-aware undo would treat it as absent.

- **Found by:** writing the page aggregate, 2026-09-22 — the revert test was
  written to pin the safe state before the unsafe wiring existed.
- **First noted:** 2026-09-22.
