import type { MapRailTuning } from "./mapRailTuning";

/**
 * One rail day button, measured in the track's own coordinate space (i.e.
 * ignoring how far the rail is currently scrolled).
 */
export type RailItem = { index: number; offsetTop: number; height: number };

export type RailGeometry = {
  /** Ascending by offsetTop. Ties resolve to the earlier entry. */
  items: RailItem[];
  /** The rail's own visible height. */
  viewportHeight: number;
  /** Natural height of all buttons stacked, ignoring any scroll gearing. */
  contentHeight: number;
  /** How far the track is scrolled, in natural (ungeared) pixels. */
  offset: number;
  /** How far through the scroll range we are, 0..1. */
  progress: number;
};

const clamp = (n: number, lo: number, hi: number): number => Math.min(Math.max(n, lo), hi);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/**
 * Scroll travel to manufacture for a geared rail. `dayCount - 1` (not
 * `dayCount`) so the full geared range spans exactly the days there are to
 * reach — day 1 at scrollTop 0, the last day at the range's end — which is
 * what the sweeping focus line relies on to land the boundaries correctly.
 *
 * `scrollPxPerDay` is consequently the travel's *average* cost per day
 * change, not an exact one: with `n` uniformly-spaced items the sweep's `n-1`
 * transitions land at even steps of `1/n` of the range, so each actually
 * costs `(n-1)/n × scrollPxPerDay` — e.g. ~223px at the default 240 for a
 * 14-day trip, not 240 itself. The gap narrows as trips get longer and is
 * imperceptible in practice; call it out here rather than let the name imply
 * more precision than the geometry delivers.
 */
export function gearedTravel(dayCount: number, scrollPxPerDay: number): number {
  return Math.max(0, (dayCount - 1) * scrollPxPerDay);
}

/**
 * Translate the container's raw scrollTop into the natural-space offset the
 * track is rendered at, plus overall progress. When `gearedTravel` is 0 this
 * degenerates to a plain 1:1 scroll.
 */
export function railScrollGeometry(input: {
  scrollTop: number;
  viewportHeight: number;
  contentHeight: number;
  gearedTravel: number;
}): { offset: number; progress: number } {
  const naturalTravel = Math.max(0, input.contentHeight - input.viewportHeight);
  const travel = input.gearedTravel > 0 ? input.gearedTravel : naturalTravel;
  if (travel <= 0) return { offset: 0, progress: 0 };
  const progress = clamp(input.scrollTop / travel, 0, 1);
  return { offset: progress * naturalTravel, progress };
}

/**
 * Which day the rail is currently focusing, or null if there are no days.
 *
 * The focus line sweeps from `focusLineStart` to `focusLineEnd` of the rail's
 * viewport as scrolling progresses, rather than sitting at a fixed position.
 * At the defaults (0 -> 1) the line traverses the entire content, so every day
 * gets an equal share of the scroll range; a fixed line would leave days
 * permanently unreachable (see mapRailTuning.ts and the spec's "Defect 4").
 *
 * The boundary branches are consequently a no-op safety net at the defaults —
 * the sweep already selects the first and last day at the extremes. They earn
 * their keep only if the focus-line knobs get narrowed during tuning.
 */
export function pickFocusedDay(g: RailGeometry, t: MapRailTuning): number | null {
  const first = g.items[0];
  const last = g.items[g.items.length - 1];
  if (first === undefined || last === undefined) return null;

  const maxOffset = Math.max(0, g.contentHeight - g.viewportHeight);
  if (maxOffset > 0) {
    if (g.offset >= maxOffset - t.boundaryEpsilonPx) return last.index;
    if (g.offset <= t.boundaryEpsilonPx) return first.index;
  }

  const focusLine =
    g.offset + g.viewportHeight * lerp(t.focusLineStart, t.focusLineEnd, clamp(g.progress, 0, 1));

  let best: number | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const item of g.items) {
    // A day scrolled off either edge is never a candidate, however near its
    // centre happens to be to the line.
    if (item.offsetTop + item.height <= g.offset) continue;
    if (item.offsetTop >= g.offset + g.viewportHeight) continue;
    const distance = Math.abs(item.offsetTop + item.height / 2 - focusLine);
    // Strictly-less keeps the earlier (lower-index) item on a tie.
    if (distance < bestDistance) {
      bestDistance = distance;
      best = item.index;
    }
  }
  return best ?? first.index;
}
