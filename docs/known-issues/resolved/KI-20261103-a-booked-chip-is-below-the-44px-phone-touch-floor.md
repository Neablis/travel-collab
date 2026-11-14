### KI-2026-11-03-a — The Booked chip is below SPEC §13.1's 44px phone touch floor — RESOLVED

- **Severity:** cosmetic (accessibility: a phone tap target about 16 to 20px high, against the 44px floor).
- **Area:** `apps/web/src/components/board/BookingChip.tsx` (the chip's button, `min-h-0` since 5dc2bd1); `apps/web/e2e/m44-booking.spec.ts` (the 390px case, line 118).
- **Symptom / What happens:** on a phone the Booked chip is a copy-the-code button about 16 to 20px tall, below SPEC §13.1's 44px touch floor. M44's pre-walk found that the floor made the chip grow over the card's edit target, so 5dc2bd1 dropped it. The exception was accepted by Mitchell's merge of the stack (PR 684, `4f75af0`).
- **Why not fixed here:** a chip that keeps 44px without covering the card's edit target needs a different shape, not a class. Suggested fix: on phones make the chip a non-interactive label, and put a full-size Copy code button in the editor's Booking section (editor+ only, as the chip is).
- **Test gap to know about:** the 390px e2e in `apps/web/e2e/m44-booking.spec.ts` clicks beside the chip (`chipBox.x - 4`), so that click cannot detect the chip covering the edit target. Only its bounds assertions (lines 114 and 115, the chip stays inside the card) guard it.
- **Resolution (2026-11-14):** the suggested fix. `BookingChip.tsx` renders both forms for an editor
  or owner and lets CSS choose, on the same `fine:` line that `Button`'s base uses to release the floor.
  The copy button is `hidden fine:inline-flex` (line 65). Everywhere else the chip is a plain label,
  `fine:hidden` with no `pointer-events-auto` (line 68), so a tap on it falls through to the card's
  edit target. With no JS media query there is no first-paint guess. `ActivityEditor.tsx`'s Booking
  section gets a "Copy code" `Button` with no size override, so the base 44px floor applies. It shows
  while the Confirmation field holds a code, its result is said in a `role="status"` beside it
  (lines 394 to 409, 742), and it sits inside the section's existing `canEditBooking` gate (editor and
  owner). It is offered at every width.
  - **Test gap closed:** the 390px case in `m44-booking.spec.ts` now taps the chip's centre
    (line 121), not beside it. It asserts that no Booked button exists there, that the tap opens the
    editor, that Copy code is at least 44px tall, and that pressing it puts `ZX9QK7` on the clipboard.
    `pnpm --filter web test:e2e:ci-like e2e/m44-booking.spec.ts`: 3 passed. Seen red: with
    `pointer-events-auto` added to the label, the run failed at line 122 (`expect(locator).toBeVisible()
    failed`, the "Edit activity" heading, `element(s) not found`) on both attempts.
  - **Unit:** `ActivityEditor.test.tsx`, *copies the code from a full-size button, and offers none with
    no code*, red before the button existed (`Unable to find an accessible element with the role
    "button" and name "Copy code"`). `RiverBlock.test.tsx`, *renders the phone's plain label beside the
    button for an editor*, red against the old chip (`Unable to find an element by:
    [data-testid="booking-chip-label"]`). Which form shows is CSS, so the e2e holds it: the lint wall
    refuses class assertions in unit tests.
- **Cross-reference:** SPEC §13.1, M44, PR 684, 5dc2bd1.
- **First noted:** 2026-11-03, M44 close.
