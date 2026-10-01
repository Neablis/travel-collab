### KI-2026-10-01-a — `PageScreen.test.tsx` "closes the settings panel when the selection leaves" fails with `Unable to find role="group" and name "Trip days"` — RESOLVED

- **Severity:** reliability (a unit test that fails most full-file runs and passes alone;
  no product behaviour is wrong).
- **Area:** `apps/web/src/components/pages/PageScreen.test.tsx` (`insertFromRail`);
  `PageScreen`'s rail insert (`chain().focus().insertContent(…)`);
  `apps/web/src/components/ui/popover.tsx` (Radix Popover).
- **Symptom / What happens:** on `main` at `96757d2f` the test failed at the same line
  every time it failed — the `findByRole("group", { name: "Trip days" })` after clicking
  the widget's dates button — which reads as a deterministic defect (CLAUDE.md rule 2).
  It is not deterministic: measured 2026-10-01 on Node 24, the full file failed 10 of 14
  runs and the test run alone (`-t`) passed 7 of 7. Same place, but not every time.
- **Cause:** the rail's insert runs `chain().focus()`, and tiptap's `focus` defers
  `view.focus()` to a `requestAnimationFrame`. The test clicked the dates button inside
  that frame, so the popover was open when the editor took focus; Radix's dismissable
  layer reads that as focus leaving the popover and calls `onOpenChange(false)`. Logged
  in a failing run: trigger click and `onOpenChange(true)` at 3680ms,
  `onOpenChange(false)` from `useFocusOutside` → `onDismiss` at 3687ms, before the click
  had even resolved. In a passing run the frame had already fired before the click.
- **Not the cause, checked:** the two "Design handoff" commits (`28cd79e2`, `0383eb49`)
  change nothing under `apps/web/src/components`; and the date — the fixture's days are
  fixed 2027 dates, and passes and failures alternate inside the same minute.
- **Not established:** what made it frequent now. The race is as old as the test; which
  change shifted the timing was not bisected.
- **Product impact:** none found. It needs a second click within one animation frame of
  the insert, which `userEvent` does and a person does not.
- **A second test had the same race, hidden behind the first.** Once the first stopped
  failing, "comes back from a widget's settings with the kind filter still on" failed 4 of
  24 full-file runs at its `waitFor(… widget-settings … toBeNull())`: it inserts, then
  presses Escape and clicks into the prose inside the same frame, and the panel stays
  open. It had failed 0 of the 38 runs before that. The same wait fixes it; why the late
  focus keeps the panel open there was not traced further.
- **Proof:** the fix is test-side — `insertFromRail` clicks the rail button and then
  waits for the editor's own `focus` event (a listener attached before the
  click, not a read of `document.activeElement`) before the test goes on; the six rail inserts that
  are followed straight away by a popover or a click away use it. Red: the unmodified
  test, 10 of 14 full-file runs, with the dismiss trace above. Green: 20 of 20 full-file
  runs with the helper in place.
- **Check subset:** `pnpm exec vitest run -c vitest.unit.config.ts
  src/components/pages/PageScreen.test.tsx` x20 on Node 24; `eslint` on the file; `tsc
  --noEmit` on the web app; `check-ki-filenames`.
- **First noted:** 2026-10-01, reported against `main` as a deterministic failure.
