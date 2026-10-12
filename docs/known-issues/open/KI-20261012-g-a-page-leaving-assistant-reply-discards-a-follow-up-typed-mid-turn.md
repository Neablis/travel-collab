### KI-2026-10-12-g — a page-leaving assistant reply discards a follow-up typed in the composer mid-turn

- **Severity:** correctness (minor). Text the person typed is lost without warning. Nothing is
  saved wrongly.
- **Area:** `apps/web/src/components/assistant/AssistantRail.tsx:377` (`const [ask, setAsk] =
  useState("")`, the composer's only copy of its text), and the KI-2026-09-07-c comment at
  `AssistantRail.tsx:956-970` that keeps the composer editable mid-turn. Possibly also
  `apps/web/src/components/trip/TripMetaPill.tsx:132` (`pendingStart`) and
  `apps/web/src/components/trip/SettingsSheet.tsx:253` (the Trip-name `Input`, commit on blur).
  Line numbers are from PR 424's branch (`origin/claude/m45-part2-assistant-runs-commands`,
  head `c21205a`), checked with `git show`.
- **Symptom:** PR 424 (M45 part 2) lets an assistant reply run palette commands, including
  `go:notebook:` and `go:trip:`. There is no `layout.tsx` under `app/(app)/trips/[tripId]/`, so
  such a move unmounts the whole screen, assistant rail included. KI-2026-09-07-c deliberately
  keeps the composer editable while a turn is answering, so a follow-up "simply waits in the
  composer". If the turn's reply moves the page, that waiting text goes with the old rail; the
  destination mounts a new rail with an empty composer.
- **Also possibly lost (unconfirmed):** both of these commit on blur. React does not dispatch
  `onBlur` for an element removed while focused, but that has not been checked in a browser here.
  - The date pill's picked start date (`TripMetaPill.tsx:132`, a non-modal popover that commits
    on Enter, blur or close). Lost only if the person is inside the popover when the reply lands.
  - An unblurred Trip-name edit (`SettingsSheet.tsx:253`, in a modal sheet). Lost only if the
    person opened the sheet after sending the question.
- **Not traced:** the budget chip's popover (`BudgetChip.tsx`, `MoneyInput`), `InviteDialog`'s
  email field, the notebook's `RepeatSettings`, and the keep-a-day dialog (`KeepDayDialog.tsx`,
  a modal with its own save button). The stop editor (`EditorHost`) is already held by PR 424.
- **Fix direction (a product call for Mitchell):**
  - hold a page-leaving command while the composer has text, and say why in the conversation
    (as PR 424 already does for an open stop editor);
  - carry the draft across the navigation into the destination's rail. This needs the rail to
    report or lift its draft.
  - accept the loss and close this entry.
- **First noted:** 2026-10-12, M45 (PR 424 review round 4).
