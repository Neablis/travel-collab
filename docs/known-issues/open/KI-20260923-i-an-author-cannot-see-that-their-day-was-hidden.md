### KI-2026-09-23-i — an author whose day an operator hid is never told, and the operator's note to them is shown nowhere they look

- **Severity:** correctness of a promise, product-facing. Nothing is lost; the
  author is left uninformed.
- **Area:** `apps/web/src/components/playbooks/SharedDayScreen.tsx` (the
  author's view of their own day), `SavedDay` in `packages/contracts` (carries
  no `moderatedAt` / `moderationNote`), `server/reports.ts` (`hide-day` writes
  `saved_days.moderation_note`).
- **Symptom:** after an operator hides a day with a note, the author opening
  that day sees it exactly as before — no hidden state, no note. The only text
  nearby is *"Unpublish it first — a day in the library cannot be deleted from
  here."* Their Discover → Yours still lists it. The note appears only in the
  operator's Actioned row. Walked on M12's gate walk, 2026-09-23
  (`w8-07-author-yours.png`, `w8-08-author-direct.png`).
- **Why not fixed here:** `AdminReportAction`'s own doc says the note is "the
  one line the author's copy can show about why it left the library" — so the
  intent is recorded — but nothing in the design draws it, and showing it needs
  the two fields on the author's read (a contract change). M12's gate asks only
  that the author keeps their copy, which they do.
- **Cross-reference:** M12 link 6; `packages/contracts/src/report.ts`
  (`AdminReportAction`).
- **First noted:** 2026-09-23, M12 gate walk.
