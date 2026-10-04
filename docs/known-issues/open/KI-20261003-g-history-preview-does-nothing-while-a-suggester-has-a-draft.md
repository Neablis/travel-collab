### KI-2026-10-03-g — history preview does nothing, and says nothing, while a suggester has an unsent draft

- **Severity:** cosmetic (a silent control). Nothing is lost or wrong: the
  preview is refused for a real reason, but the reader is not told it.
- **Area:** `apps/web/src/components/trip/context/TripProvider.tsx`
  (`preview.enter`, which returns early on `pending`);
  `apps/web/src/components/board/HistoryPanel.tsx` (the rows that call it).
- **Symptom / What happens:** a suggester with one or more changes in the
  draft tray clicks an entry in History. Nothing happens: no preview, no
  message. `enter` returns at `if (pending) return;`, because a preview cannot
  branch from unconfirmed state, and a suggester's draft is the optimistic
  queue (spec §2.3), so it counts as pending for as long as the draft exists.
  For an editor the same guard lasts one round trip; for a suggester it lasts
  until they send or discard.
- **Why not fixed here:** found while building the suggester role (spec
  2026-10-03, §6) and left for a follow-up, because the honest fix is a
  wording decision, not a code one: either say why ("Send or discard your
  suggestion to look back") or let a suggester preview over a draft that is
  never sent as commands. The second needs `enter` to stop treating a draft as
  unsent work — the same `pending` reading `dispatch`'s history-command branch
  keeps as an undecided product rule (its comment, after KI-090).
- **Cross-reference:** spec `docs/specs/2026-10-03-suggester-role-design.md`
  §2.3, W7, W13; ADR-064; `resolved/KI-090-…` (resolved; it left the silent
  `return` on the history-command path, the same shape, as a product rule).
- **First noted:** 2026-10-03, while building the suggester role; moved here
  from the spec's §6 in that branch's review.
