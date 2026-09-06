/**
 * Which day is the one you are looking at — the arithmetic behind
 * *"scrolling down the timeline or Left/Right in the days column should change
 * the selected day in the header bar"* (Mitchell, 2026-09-01).
 *
 * Pure, and taking plain spans rather than elements or rects, for two reasons:
 * it is the only interesting part of a scroll spy and it is otherwise
 * untestable without a layout engine, and the SAME rule then serves both axes —
 * the timeline scrolls vertically inside the window, the day columns scroll
 * horizontally inside their own box, and "closest to the reading line" is one
 * question asked twice rather than two implementations that drift.
 *
 * The design does this with `getBoundingClientRect` per node on every frame
 * (`dc.html:3634-3657`, `_central`); the callers here do the same measuring and
 * hand the numbers to this.
 */

/** One candidate: where a day's section starts along the scroll axis, and how long it is. */
export type DaySpan = { start: number; size: number };

/**
 * The reading line, as a fraction of the viewport's extent along that axis.
 *
 * **0.38 vertically, 0.5 horizontally**, and both come from the design
 * (`dc.html:3644`): `br.top + br.height * 0.38` for the timeline,
 * `br.left + br.width / 2` for the columns. The asymmetry is right rather than
 * an oversight — a vertical reader's attention sits above the middle of the
 * window (a day header that has just scrolled into the upper third is the day
 * they are reading), while a horizontal strip of equal-width columns has no
 * such bias and the true centre is the honest answer.
 */
export const READING_LINE = { vertical: 0.38, horizontal: 0.5 } as const;

/**
 * Identifies the day span nearest the reading line or the visible scroll edge.
 *
 * @param viewport - The scroll viewport position and size
 * @param spans - The day spans to evaluate
 * @param readingLine - The reading line position as a fraction of the viewport
 * @param edges - Indicates whether the viewport is at the start or end of the spans
 * @returns The selected span index, or `null` when no spans are provided
 */
export function centralDayIndex(
  viewport: { start: number; size: number },
  spans: readonly DaySpan[],
  readingLine: number = READING_LINE.vertical,
  edges?: { atStart?: boolean; atEnd?: boolean },
): number | null {
  if (spans.length === 0) return null;
  // The ends, before the arithmetic, because the arithmetic cannot reach them.
  //
  // A scrollport is wider than one day, so the first and last spans can never
  // bring their own centre to the reading line — scrolled hard to one end, the
  // first day sits at the edge while some later day owns the centre. Nearest-
  // to-the-line therefore never answers 0 or `length - 1`, and those two days
  // are unselectable by scrolling however far you go.
  //
  // Mitchell, on the 2026-09-06 preview, of a fourteen-day trip: *"Its
  // impossible to scroll right all the way to day 14, because it stops at day
  // 13. Same with day 1."* Both ends, symmetrically, which is the signature of
  // this rather than of a clipped container.
  //
  // `edges` is what the caller measured — it alone knows whether its box is
  // scrolled to an end — and being at an end is a stronger statement about
  // what you are looking at than a distance is. `atStart` wins a both-true tie
  // (a trip short enough not to scroll), matching the earlier-index tiebreak
  // below.
  if (edges?.atStart === true) return 0;
  if (edges?.atEnd === true) return spans.length - 1;
  const line = viewport.start + viewport.size * readingLine;
  let best: number | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const [index, span] of spans.entries()) {
    const distance = Math.abs(span.start + span.size / 2 - line);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  }
  return best;
}

/**
 * Step a selection one day left/right, clamped at both ends.
 *
 * Clamped rather than wrapping: arrowing off the last day back to the first
 * would be a jump the length of the trip, and the day columns' own scroll does
 * not wrap either. `null` (nothing selected) enters at the first day going
 * forward and at the first day going back too — from nowhere, the beginning is
 * the only place with an answer.
 */
export function stepDay(current: number | null, delta: number, dayCount: number): number | null {
  if (dayCount <= 0) return null;
  if (current === null) return 0;
  const next = current + delta;
  if (next < 0) return 0;
  if (next > dayCount - 1) return dayCount - 1;
  return next;
}
