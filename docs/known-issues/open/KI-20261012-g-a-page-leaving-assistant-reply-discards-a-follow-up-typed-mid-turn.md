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
- **Fix direction (decided, Mitchell 2026-10-12): persist the composer's unsent draft to
  `localStorage`.** Not fixed in PR 424; this entry stays open until it is. Holding the
  page-leaving command and carrying the draft across the navigation were the other options and
  are not being taken. A stored draft also covers a reload, which neither of those did. Sketch,
  from PR 424's branch at `58d4faf` (the lines cited above are unchanged there):
  - **Where it lives.** Next to the thread in `askThreadStore.ts`: `loadAskDraft(name)`,
    `saveAskDraft(name, text)` and `clearAskDraft(name)` under their own versioned prefix
    (`ask_draft_v1:${name}`, built the way `keyFor` builds `ask_thread_v1:${name}`). Every
    read, write and remove goes in its own `try/catch` the way `saveAskThread` and
    `clearAskThread` already do: private mode, a full origin, or no `localStorage` at all must
    cost only the draft's durability, never the composer.
  - **Keyed by the thread's own name**, so each conversation has its own draft. The board
    already persists its thread as ``persistAs: `trip:${tripId}` `` (`TripBoardScreen.tsx:512`);
    its draft uses the same name. `NotebookScreen.tsx:307` and `PageScreen.tsx:879` pass no
    `persistAs` today, so they have no name to share yet. Give each a draft name that cannot
    collide with the board's (for example `notebook:${tripId}` and `page:${pageId}`) without
    turning on transcript persistence for them, which is a separate change.
  - **How the rail gets the name.** `AssistantRail` owns the text (`AssistantRail.tsx:377`) but
    not the thread's name. Pass it in as an optional prop, `rememberDraftAs`, the same way
    `rememberPositionAs` (`:374`) already reaches the rail. Undefined keeps today's behaviour.
  - **Write on change, debounced** (a few hundred ms) from an effect on `ask`. An empty or
    whitespace-only composer removes the key instead of storing `""`. Flush the pending write on
    unmount, since a page-leaving reply is an unmount and it is exactly the case this fixes.
  - **Restore on mount** from an effect, not a lazy `useState` initialiser: the rail is
    server-rendered too, and reading storage during render would make the first client render
    disagree with the server's. The existing `restoreDraft` effect (`:559-561`, a rolled-back
    send) still wins over a stored draft, and the write-on-change effect then stores what it
    restored.
  - **Clear on submit**, at the same point the composer clears: `submitAsk`'s
    `if (accepted !== false) setAsk("")` (`:571`). A refused send (`false`) keeps both. "New
    conversation" (`clearAskThread`) should clear the draft under the same name too.
  - **The account rail (M45 part 4)** uses this same mechanism under its own name rather than
    a second draft store.
  - **Not covered:** the date pill and the Trip-name field above are a separate question. They
    are still unconfirmed and stay listed as they are; persisting the composer does nothing
    for them.
- **First noted:** 2026-10-12, M45 (PR 424 review round 4).

- **Update 2026-10-12 (PR 426):** the composer half is fixed for all four rails. Drafts and
  threads are stored per signed-in user, as `ask_draft_v1:<userId>:<name>`, and both sign-out
  paths forget them. Still open:
  - the date-pill and trip-name losses this entry lists;
  - session expiry, a sign-out in another tab, or a cleared cookie forgets nothing. What is left
    stays under the old user's id, and only devtools can read it.
