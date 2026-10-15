// The thresholds below are tuned against the river's own touch contract
// (M29): a press that drifts more than 8px or lifts before 450ms is a swipe
// or a tap, and nothing about it is prevented — so a quick horizontal swipe
// is currently an unclaimed gesture. The classifier only ever claims those.

/**
 * Minimum horizontal travel for a touch sequence to count as a day-step
 * swipe. Well above the river's 8px touch slop and a thumb's resting jitter,
 * well below a deliberate swipe.
 */
export const DAY_SWIPE_MIN_DISTANCE_PX = 24;

/**
 * A swipe must be mostly horizontal: |dx| has to exceed this multiple of
 * |dy|. A ratio of 2 draws roughly a 27-degree cone around the horizontal —
 * vertical scrolls and diagonal drifts stay the browser's.
 */
export const DAY_SWIPE_DIRECTION_RATIO = 2;

/**
 * Maximum duration of a day-step swipe. Below the river's 450ms hold
 * threshold, so a hold-to-lift-a-block (or a hold-to-sketch) can never be
 * misread as a swipe no matter how horizontal the finger then travels.
 */
export const DAY_SWIPE_MAX_DURATION_MS = 300;

/** One endpoint of the touch sequence, as the Board's handlers record it. */
export type SwipePoint = { x: number; y: number; t: number };

/**
 * Which way a completed single-touch sequence steps the focused day: +1 for
 * a leftward swipe (toward the next day), -1 for a rightward swipe (toward
 * the previous day), 0 for not-a-swipe — a tap, a scroll, a hold, or anything
 * diagonal. The sign matches `stepDay`'s delta, so the caller passes it
 * straight through.
 */
export type DaySwipeStep = -1 | 0 | 1;

/**
 * Classify a finished touch sequence as a day-step swipe or not. Pure: the
 * caller owns the touch bookkeeping (single-touch tracking, touchcancel,
 * which element was touched) and hands over just the two endpoints.
 */
export function classifyDaySwipe(start: SwipePoint, end: SwipePoint): DaySwipeStep {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const dt = end.t - start.t;
  // A clock that ran backwards is a broken reading, not a fast finger.
  if (dt < 0 || dt >= DAY_SWIPE_MAX_DURATION_MS) return 0;
  if (Math.abs(dx) < DAY_SWIPE_MIN_DISTANCE_PX) return 0;
  if (Math.abs(dx) <= DAY_SWIPE_DIRECTION_RATIO * Math.abs(dy)) return 0;
  return dx < 0 ? 1 : -1;
}

/**
 * Elements a day swipe must never start on, as a selector. The river's
 * resize grips are the one river control that acts on a quick press with no
 * hold: `pressGrip` fires on pointerdown, and a horizontal-only drag commits
 * as a tap, opening the editor — so a swipe starting on a grip would both
 * open the editor and change the day. Every other river gesture needs the
 * 450ms hold, which the 300ms swipe cap already excludes. Matched on the
 * grips' testids, which e2e tests pin: renaming one breaks loudly instead of
 * silently re-arming the double action.
 */
const SWIPE_EXEMPT_SELECTOR = '[data-testid="river-resize"], [data-testid="river-resize-start"]';

/**
 * Whether a touch starting on `target` must not become a day swipe: it began
 * on a control that consumes the gesture itself. Duck-typed rather than
 * `instanceof HTMLElement` so the module stays loadable outside a DOM.
 */
export function isDaySwipeExempt(target: EventTarget | null): boolean {
  if (target === null || typeof (target as Element).closest !== "function") return false;
  return (target as Element).closest(SWIPE_EXEMPT_SELECTOR) !== null;
}
