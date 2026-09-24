### KI-2026-09-24-h — a page-only batch touching two or more pages still hides an accepted card's Undo

- **Severity:** correctness, narrow — the residue of KI-2026-09-23-f's first half.
- **Milestone:** **M9, carried (assigned 2026-09-24, KI pass)** — the assistant
  card is M9's surface. Not a gate box.
- **Area:** `apps/web/src/components/assistant/ProposalCard.tsx`
  (`proposalUndoFor`: the head is the first entry with no `pageId`),
  `apps/web/src/server/history` / `buildHistoryEntries` (sets `pageId` only for
  a page-only batch touching EXACTLY one page), `packages/contracts/src/history.ts`
  (`HistoryEntry` — no "has trip events" flag).
- **Symptom / What happens:** KI-2026-09-23-f made the card skip page-only
  entries when finding the head, keyed on `pageId`. A page-only batch that
  touches several pages carries no `pageId`, so it still counts as the head and
  the card shows "changed since → History" although the server's
  `UndoLastChange` (whose `deriveUndoRedo` skips any batch without trip events)
  would still undo the card's batch. Concrete path, from the PR #218 review:
  the first notebook save on a trip with two or more legacy page rows, where
  `missingGenesis` backfills a `PageCreated` for each in the same batch.
- **Why not fixed here:** closing it exactly needs the history entry to say
  whether a batch has trip events (a `HistoryEntry` contract field), which is a
  separate, serialized contracts change.
- **Cross-reference:** `resolved/KI-20260923-f-…` (which named this limit),
  KI-2026-09-22-c.
- **First noted:** 2026-09-24, review of PR #218.
