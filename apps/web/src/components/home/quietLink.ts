/**
 * **SPEC §35.2's quiet link**, laid over a ghost `Button`: no fill, no border,
 * underlined at a 2px offset, `py` 4px. Rare actions — importing a file, an
 * empty trip, starting from a Playbook — are demoted to this rather than drawn
 * as buttons beside the one frequent action.
 *
 * Over `Button` rather than a bare `<button>` because the design-system wall
 * refuses the element outside `components/ui`, and because the base carries
 * §13.1's phone floor, which a hand-rolled one would have to remember. The ink
 * is the caller's: slate for a line that is aside, ink for one inside a row of
 * alternatives.
 *
 * `text-xs` (12px) where the design draws 12.5px: there is no 12.5px token,
 * and a half pixel is not worth a token or an inline-style disable.
 */
export const QUIET_LINK =
  "h-auto px-0 py-1 text-xs font-normal underline underline-offset-2 hover:bg-transparent hover:text-ink";
