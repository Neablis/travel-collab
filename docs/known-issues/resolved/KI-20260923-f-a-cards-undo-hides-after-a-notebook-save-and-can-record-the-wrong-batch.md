### KI-2026-09-23-f — an accepted card's Undo disappears after a notebook save, and can record a batch it did not write — RESOLVED

- **Severity:** correctness, narrow. The first defect removes an Undo that would
  have worked. The second, in a small window, points the card's Undo at another
  person's change.
- **Area:** `apps/web/src/components/assistant/ProposalCard.tsx`
  (`proposalUndoFor`, the `history.entries[0]` head check),
  `apps/web/src/components/board/TripBoardScreen.tsx:638` (the batch recorded
  from `result.value.history.entries[0]` after apply),
  `packages/domain/src/trip/history.ts` (`deriveUndoRedo`, which skips page-only
  batches), `packages/contracts/src/history.ts` (`HistoryEntry.pageId`).

- **1. A notebook save hides Undo.** `proposalUndoFor` offers Undo only while
  the card's batch is `history.entries[0]`. A notebook autosave is a page-only
  batch, and it goes to the head of `entries`. The server's `deriveUndoRedo`
  **skips** page-only batches, though, so `UndoLastChange { undoesBatchId }`
  would still undo the card's batch and would not be refused. So one keystroke
  in a notebook (800ms debounce) flips the card to *changed since → History*,
  for an undo that was still available.
  **Fix:** take the head as the first entry that has no `pageId` (the contract
  already marks page-only batches), not `entries[0]`. That matches the server's
  undo target exactly. Pin it with a `ProposalCard.test.tsx` case that has a
  page-only entry on top.

- **2. The recorded batch can belong to someone else.** After apply, the card
  records `history.entries[0].batchId` from the history the apply call returns.
  If a collaborator's write lands between the commit and that read, the card
  records **their** batch. Its Undo then names their batch, the server's
  `undo-target-changed` check passes, and their change is undone under a button
  on the assistant's card. That is the exact thing M27 D17 exists to prevent.
  **Fix:** have the apply path return the `batchId` it committed and record
  that, not whichever batch is newest.

- **How it was found:** the implementer's report on the M27 Undo fix
  (2026-09-23) named both. That fix closed the larger hole (an unnamed undo
  taking back whatever was on top) and deliberately stopped there.
- **Cross-reference:** M27 D17 (`docs/milestones/M27-simplify-pass.md`),
  `KI-2026-09-22-c` (why page batches are not undoable; **read it before
  touching undo**).
- **First noted:** 2026-09-23.
- **Resolved:** 2026-09-24.
  - **Defect 1: fixed.** `proposalUndoFor` now takes the head as the first
    entry with no `pageId`, which is the batch the server's `deriveUndoRedo`
    would undo. New `ProposalCard.test.tsx` case *"stays available when only
    a notebook save has landed on top"*. On the old code it failed with
    `expected 'changed' to be 'available'`, and after the fix it passes
    (18/18). `pnpm --filter web typecheck` and eslint on both files are
    clean.
  - **Defect 2: not reproducible. It does not exist, so nothing was changed.**
    The apply's history is never read after the commit.
    `executeTripCommandBatch` (`apps/web/src/server/commands.ts`) reads the
    stream, appends at `expectedSeq: history.length`, and `projectAndHistory`
    then builds the returned history in memory from
    `[...history, ...appended.envelopes]`, inside the same transaction.
    Suppose another write commits between that read and the append. Then the
    append collides on the `events_stream_seq` unique index and the batch is
    refused as `concurrency-conflict`. A write that lands after the commit
    cannot change a history that was already built. So `entries[0]` in the
    apply response is always the batch this apply committed.
    `commitProposal` passes `batch.history` through unchanged, and
    `applyAssistantProposal` only parses it. Returning an explicit `batchId`
    is still possible without a contract change (`ProposalCommitResult` and
    `PlanOutcome` are both apps/web types), but it would be hardening, not a
    fix.
