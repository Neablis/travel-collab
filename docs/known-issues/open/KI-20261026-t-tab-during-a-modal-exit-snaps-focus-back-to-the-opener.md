### KI-2026-10-26-t — Tab pressed during a modal's exit animation is undone: focus snaps back to the opener at unmount

- **Severity:** cosmetic, low reach. Focus is never lost or hidden; it lands on the opener, which
  is where a closed modal sends it anyway. Only a keyboard user who tabs on within the exit
  animation (a few hundred ms) sees their move taken back.
- **Area:** `apps/web/src/lib/useExitPresence.ts` (`useLetGoOfFocusOnClose`, `letGoOfFocus`), and
  Radix's own focus return on unmount (`onCloseAutoFocus`) in the overlays that call the hook:
  `apps/web/src/components/ui/dialog.tsx`, `sheet.tsx`, `menu.tsx`, `popover.tsx`.
- **Symptom / What happens:** M54 part 1 moves focus to the opener the moment a modal overlay
  closes, not after its exit (spec §3). If the user then presses Tab while the overlay is still
  animating out, focus moves on as expected, but when the overlay unmounts Radix's focus return
  puts it back on the opener, so the Tab appears not to have happened.
- **Why not fixed here:** raised in part 1's review as an edge, not a gate item. A fix needs each
  caller's `onCloseAutoFocus` to skip the return when focus has already left the opener, which
  touches every overlay rather than the hook.
- **Fix path / Tripwire:** in `onCloseAutoFocus`, `preventDefault()` when `document.activeElement`
  is neither the body nor inside the closing overlay; pin it with an e2e step that presses Tab
  during the exit and asserts focus is on the next control after the animation ends.
- **Cross-reference:** M54 part 1, PR 594's review; ADR-082 §2.
- **First noted:** 2026-10-26, on PR 594's review.
