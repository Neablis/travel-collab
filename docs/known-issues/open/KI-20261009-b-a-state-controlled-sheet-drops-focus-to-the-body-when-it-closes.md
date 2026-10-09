### KI-2026-10-09-b — a state-controlled `Sheet` drops keyboard focus to `<body>` when it closes

- **Severity:** accessibility. A keyboard or switch user who closes one of these sheets has to
  tab from the top of the page to get back to where they were.
- **Area:** `apps/web/src/components/ui/sheet.tsx` and its callers that open it from state, with
  no `Dialog.Trigger` and no `onCloseAutoFocus`:
  - `components/trip/editor/ActivityEditorSheet.tsx` (~:212), including after a conflicts-sheet Jump
  - `components/trip/SettingsSheet.tsx` (~:246), opened from the title or the ⋯ menu
  - `components/playbooks/DiscoverScreen.tsx` (~:533)
  - `components/home/NewTripWizard.tsx` (~:148)
  - `components/pages/WidgetInsert.tsx` (~:154)
  - `components/pages/PageScreen.tsx` (~:1553)
- **Symptom:** open one of these sheets, then close it with Escape or the scrim. Radix restores
  focus to the trigger it knows about, and a state-controlled sheet has none, so
  `document.activeElement` is `<body>`. `ui/dialog.tsx`'s own comment describes the same case.
- **Why not fixed here:** found by M39 Part 6, which fixed only its own sheet. `Sheet` gained
  an optional `onCloseAutoFocus` there, and the conflicts chip uses it (PR #368). Each caller
  needs its own answer about where focus belongs once the sheet is gone (the opener, or a
  neighbour when the opener itself went away), and each needs a keyboard test.
- **Fix direction:** pass `onCloseAutoFocus` from each caller and focus the control that opened
  the sheet. The keyboard-driven tests in `ConflictsChip.test.tsx` and `TripHeader.test.tsx`
  show how to test this, because the lint wall bans reading `document.activeElement`.
- **First noted:** 2026-10-09, M39 Part 6's fix for its own sheet.
