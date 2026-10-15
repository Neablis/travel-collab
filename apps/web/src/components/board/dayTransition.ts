/**
 * How long the phone's day-change slide runs. Quick enough to never annoy on
 * a gesture people repeat (a day step is not a page turn), slow enough to
 * read as a slide rather than a flicker: the standard "fast but perceptible"
 * band is 150-200ms. Well under the 300ms swipe cap, so the two thresholds
 * never conceptually overlap.
 */
export const DAY_CHANGE_TRANSITION_MS = 180;

/** A day-change slide that should animate: which day slides out, which in. */
export type DayChangeTransition = { from: number; to: number };

/**
 * Whether a focused-day change should animate as a slide, and between which
 * days. Pure so the rule is table-testable; the Board owns the animation.
 *
 * Only real day indices animate: a null on either side (mount, deselect), a
 * no-op change, an index outside the trip (ghost suggestion days, a day just
 * removed), a non-one-day board, and reduced-motion all fall back to the
 * instant swap. Direction is the caller's: `to > from` slides left.
 */
export function dayChangeTransition(
  prev: number | null,
  next: number | null,
  opts: { oneDay: boolean; dayCount: number; reducedMotion: boolean },
): DayChangeTransition | null {
  if (!opts.oneDay || opts.reducedMotion) return null;
  if (prev === null || next === null || prev === next) return null;
  if (prev < 0 || next < 0 || prev >= opts.dayCount || next >= opts.dayCount) return null;
  return { from: prev, to: next };
}
