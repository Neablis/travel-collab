### KI-2026-10-26-t — Tab pressed during a modal's exit animation is undone: focus snaps back to the opener at unmount — RESOLVED

- **Severity:** cosmetic, low reach. Focus is never lost or hidden; it lands on the opener, which
  is where a closed modal sends it anyway. Only a keyboard user who tabs on within the exit
  animation (a few hundred ms) sees their move taken back.
- **Area:** `apps/web/src/lib/useExitPresence.ts` (`useLetGoOfFocusOnClose`, `letGoOfFocus`), and
  the focus return on unmount in three of the overlays that call the hook: `Sheet`'s own
  `onCloseAutoFocus` (`apps/web/src/components/ui/sheet.tsx`), and Radix's trigger return in
  `menu.tsx` and `popover.tsx`. `Dialog` has no `Dialog.Trigger`, so Radix returns nothing there;
  it is affected only through a caller's own `onCloseAutoFocus`.
- **Symptom / What happens:** M54 part 1 moves focus to the opener the moment a modal overlay
  closes, not after its exit (spec §3). If the user then presses Tab while the overlay is still
  animating out, focus moves on as expected, but when the overlay unmounts Radix's focus return
  puts it back on the opener, so the Tab appears not to have happened.
- **Why not fixed here:** raised in part 1's review as an edge, not a gate item. A fix needs each
  caller's `onCloseAutoFocus` to skip the return when focus has already left the opener, which
  touches those three overlays rather than the hook.
- **Fix path / Tripwire:** in `onCloseAutoFocus`, `preventDefault()` when `document.activeElement`
  is neither the body nor inside the closing overlay; pin it with an e2e step that presses Tab
  during the exit and asserts focus is on the next control after the animation ends.
- **Cross-reference:** M54 part 1, PR 594's review; ADR-082 §2.
- **First noted:** 2026-10-26, on PR 594's review.
- **Resolved 2026-10-29 (KI sweep, UI focus) — the overlays' `onCloseAutoFocus` keeps a move made during the exit.**
  `useLetGoOfFocusOnClose` now returns `keepFocusMovedOn(handler)`, which `Menu`, `Popover`,
  `Sheet` and `Dialog` wrap their `onCloseAutoFocus` in. At the unmount, when focus is somewhere
  other than `<body>`, the leaving overlay or where the close put it, the caller's handler still
  runs (the trip header's menu opens what was chosen from it), then focus goes back where the
  person moved it and the event is `preventDefault()`ed, so Radix's own return does not run.
  Done in the hook rather than in each caller, because the palette's own handler (`returnTo`)
  snapped back too.
  - **Reproduction.** New steps in `m54-motion.spec.ts` (`tabStaysThroughTheExit`): close with
    the timeline frozen, Tab, release the timeline, wait for the unmount, assert the control the
    Tab reached still has focus. Before the fix, on the built app: the phone `⋯` menu and the ⌘K
    dialog failed 18/20 and 20/20 at `expect(page.locator("[data-tabbed-to]")).toBeFocused()`
    (`Received: inactive`). The account menu (a popover) passed 20/20 before and after.
  - **Proof.** After: `m54-motion.spec.ts --repeat-each=20 --retries=0`, 201 passed. Unit tests in
    `useExitPresence.test.tsx` for both sides (moved on: kept and prevented; still on the opener:
    the return runs), the first seen red with `movedOn` forced false (`expected false to be true`).
