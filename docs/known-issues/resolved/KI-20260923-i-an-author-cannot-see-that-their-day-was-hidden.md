### KI-2026-09-23-i — an author whose day an operator hid is never told, and the operator's note to them is shown nowhere they look — RESOLVED

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
- **Fix (2026-09-25 overnight sweep):** `GET /api/saved-days/:id` now carries
  `moderation: SavedDayModeration | null` (new contract, `.default(null)` on
  the note) beside `publishedAt` on its envelope, filled from the existing
  `saved_days.moderated_at` / `moderation_note` by `savedDays.moderationOf`
  **only when `isAuthor`**. `SharedDayScreen` shows the author a warning
  banner (`day-hidden`): *"A moderator hid this day from the library. It is
  still yours, but nobody else can find or open it, and publishing it again
  will not bring it back. Their note to you: "…""*. No migration. CHANGELOG
  entry 2026-09-25.
- **Proof:** reproduced first with a new
  `app/api/reports/route.int.test.ts` case (operator hides with a note, author
  reads): `expected undefined to deeply equal { moderatedAt: …, moderationNote:
  "Advertising a tour company, not a day." }`; green after the fix, and red
  again (`expected null to deeply equal …`) with `moderationOf` forced to null.
  The same case asserts a stranger's read is `null` before the hide and after
  the restore, and the private-day 404 while hidden. `SharedDayScreen.test.tsx`
  covers the banner, the no-note wording, and that a non-author never sees it
  (seen red with the `isAuthor` guard removed); `apiClient.test.ts` covers an
  absent field reading as null (seen red); `packages/contracts/test/saved.test.ts`
  round-trips the new schema and pins that `SavedDay` does not carry it. Full
  `pnpm check` run once at the end.
- **Decision (2026-09-25 overnight sweep):** the two fields ride the
  shared-day read's **envelope**, as `publishedAt` does, rather than being added
  to `SavedDay`. `SavedDay` is every reader's copy — `/v1/playbooks` (which
  returns other people's published days), `/v1/library` (frozen, would have
  needed an `.omit`), the shared-day read — so a field on it would have to be
  blanked on every non-author path forever, and would have moved
  `openapi.json`. Rejected also: **a migration** (the columns exist);
  **showing the date** (the note is what the author needs; `moderatedAt` is
  carried so a later line can use it); **marking the day on Discover →
  Yours** (that is `DiscoverDay`, a second contract and a raw-SQL read in
  `playbooks.ts`; the author reaches the banner by opening the day, and the
  entry's promise is "told", not "badged in every list"). Wording chosen on the
  owner's behalf; it names republishing because that is the obvious next move
  and it does not undo a hide.
