### KI-2026-09-23-f — an accepted card's Undo disappears after a notebook save, and can record a batch it did not write

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
