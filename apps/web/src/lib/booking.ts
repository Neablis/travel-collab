import type { ActivityKind } from "@tc/contracts";

/**
 * Whether a stop still has to be booked.
 *
 * "Neither `booked` nor `transit`" is SPEC §12's own rule for the calendar's
 * "N to book" flag (`calendarCityCards.ts`, which defers computing it until
 * M18's stop kinds are on real trips).
 *
 * It lives in `src/lib` — reachable from UI and from `src/server` both — rather
 * than beside either caller, because BOTH sides of the assistant need it and
 * they must not disagree: `suggestedQuestions.ts` decides whether to OFFER
 * "what still needs booking?", and `readTools.ts` decides what the answer can
 * SAY. Two copies of the predicate is how that chip became a dead end on the
 * simulated path (final branch review, 2026-08-29, finding 1) — the chip was
 * offered from a rule the answering half did not share.
 */
export function needsBooking(kind: ActivityKind): boolean {
  return kind !== "booked" && kind !== "transit";
}
