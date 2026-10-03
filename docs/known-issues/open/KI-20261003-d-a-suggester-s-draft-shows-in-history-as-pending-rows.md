### KI-2026-10-03-d — a suggester's unsent draft shows in History as pending rows, like edits that are saving

- **Severity:** cosmetic (misleading rows). Nothing is written: the rows are
  the optimistic queue's own, and they go when the draft is sent or discarded.
- **Area:** `apps/web/src/components/trip/context/optimistic.ts`
  (`activeHistory`, which prepends a `pending: true` row per queued unit);
  `apps/web/src/components/board/HistoryPanel.tsx` (which draws them).
- **Symptom / What happens:** a suggester makes two edits. The tray reads
  "2 changes not sent", and History lists the same two edits at the top as
  pending rows — the rows an editor sees for a change on its way to the
  server. For a suggester they are not on their way anywhere: History is the
  trip's record, and these will only reach it if a reviewer accepts them.
- **Why not fixed here:** found while building the suggester role (spec
  2026-10-03, §6) and left for a follow-up. The likely fix is that
  `activeHistory` (or the panel) leaves pending rows out in suggest mode, since
  the tray already counts the draft (W38); it is a display choice that wants a
  decision rather than a quiet change to a shared helper.
- **Cross-reference:** spec `docs/specs/2026-10-03-suggester-role-design.md`
  §2.3, W38; ADR-063; KI-2026-10-03-b (the other place a draft reads as
  pending work).
- **First noted:** 2026-10-03, while building the suggester role; moved here
  from the spec's §6 in that branch's review.
