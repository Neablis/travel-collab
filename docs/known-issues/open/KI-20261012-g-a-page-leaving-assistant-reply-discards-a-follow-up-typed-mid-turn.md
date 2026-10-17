### KI-2026-10-12-g — after a page-leaving assistant reply, a commit-on-blur edit may be lost, and an expired session leaves the old user's ask drafts behind

- **Severity:** correctness (minor). At worst, text the person typed is lost without warning.
  Nothing is saved wrongly. The two losses below are unconfirmed.
- **Area:** `apps/web/src/components/trip/TripMetaPill.tsx` (`pendingStart`, which commits on
  Enter, blur or close); `apps/web/src/components/trip/SettingsSheet.tsx` (the Trip-name `Input`,
  which commits on blur); `apps/web/src/lib/askOwnership.ts` (`forgetAskConversationsOf`) and
  `apps/web/src/components/assistant/askThreadStore.ts` (`ask_draft_v1:<userId>:<name>`).
- **Symptom:** since PR 424, an assistant reply can run palette commands, including `go:notebook:`
  and `go:trip:`. There is no `layout.tsx` under `app/(app)/trips/[tripId]/`, so such a move
  unmounts the whole screen. Anything that only commits on blur may then never commit. React
  doesn't dispatch `onBlur` for an element removed while it has focus. Nobody has checked this
  in a browser.
  1. **The date pill's picked start date.** It is lost only if the person is inside the popover
     when the reply lands.
  2. **An unblurred Trip-name edit**, in a modal sheet. It is lost only if the person opened the
     sheet after sending the question.
  3. **Drafts left under the old user.** Ask threads and drafts are stored per signed-in user, and
     both sign-out paths call `forgetAskConversationsOf`. A session expiry, a sign-out in another
     tab or a cleared cookie forgets nothing. What's left stays under the old user's id, and only
     devtools can read it.
- **Not traced:** the budget chip's popover (`BudgetChip.tsx`, `MoneyInput`), `InviteDialog`'s
  email field, the notebook's `RepeatSettings`, and the keep-a-day dialog (`KeepDayDialog.tsx`, a
  modal with its own save button). The stop editor (`EditorHost`) is already held by PR 424.
- **Fixed, the original headline (PR 426, 2026-10-12):** a follow-up typed in the composer
  mid-turn is no longer lost. All four rails persist their unsent draft to `localStorage`
  (`rememberDraftAs` on the board, notebook, page and Home/account rails, through
  `loadAskDraft`, `saveAskDraft` and `clearAskDraft`). That was Mitchell's chosen direction on
  2026-10-12. Checked in the tree on 2026-10-17.
- **Fix direction:** for 1 and 2, confirm in a browser first. If the loss is real, commit on
  unmount, or hold the page-leaving command while a commit-on-blur control has focus. For 3,
  forget on the session-ended path too, or sweep keys whose user id isn't the signed-in one
  whenever a rail mounts.
- **Cross-reference:** KI-2026-09-07-c (keeps the composer editable mid-turn); M45
  (`docs/milestones/M45-the-assistant-beyond-one-trip.md`).
- **First noted:** 2026-10-12, M45 (PR 424 review round 4). Rewritten to its residuals on
  2026-10-17 (the 2026-10-16 audit, §6).
