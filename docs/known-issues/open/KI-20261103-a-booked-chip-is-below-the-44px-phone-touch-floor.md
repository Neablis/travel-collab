### KI-2026-11-03-a — The Booked chip is below SPEC §13.1's 44px phone touch floor

- **Severity:** cosmetic (accessibility: a phone tap target about 16 to 20px high, against the 44px floor).
- **Area:** `apps/web/src/components/board/BookingChip.tsx` (the chip's button, `min-h-0` since 5dc2bd1); `apps/web/e2e/m44-booking.spec.ts` (the 390px case, line 118).
- **Symptom / What happens:** on a phone the Booked chip is a copy-the-code button about 16 to 20px tall, below SPEC §13.1's 44px touch floor. M44's pre-walk found that the floor made the chip grow over the card's edit target, so 5dc2bd1 dropped it. The exception was accepted by Mitchell's merge of the stack (PR 684, `4f75af0`).
- **Why not fixed here:** a chip that keeps 44px without covering the card's edit target needs a different shape, not a class. Suggested fix: on phones make the chip a non-interactive label, and put a full-size Copy code button in the editor's Booking section (editor+ only, as the chip is).
- **Test gap to know about:** the 390px e2e in `apps/web/e2e/m44-booking.spec.ts` clicks beside the chip (`chipBox.x - 4`), so that click cannot detect the chip covering the edit target. Only its bounds assertions (lines 114 and 115, the chip stays inside the card) guard it.
- **Cross-reference:** SPEC §13.1, M44, PR 684, 5dc2bd1.
- **First noted:** 2026-11-03, M44 close.
