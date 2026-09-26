import type { TimeFormat, TimeWindow } from "@tc/contracts";
import { toMinutes } from "@/lib/time";

// The geometry of Plan's time river (SPEC §36.9b, M29 part 2), as pure
// functions so every rule the picture depends on can be asserted without a
// browser. The design's own version is `riverRange()` and `buildDays()` in
// `Trip Planner Redesign.dc.html` (~9425–9560); what differs here is written
// down where it differs.

/** SPEC §36.9b: "44 px an hour". */
export const RIVER_PX_PER_HOUR = 44;

/** Shortest block drawn, so a 10-minute stop still has a title line. */
export const RIVER_MIN_BLOCK_PX = 24;

/**
 * Taken off every block's to-scale height, so two back-to-back stops (one ends
 * at 10:00, the next starts at 10:00) read as two blocks and not one.
 */
export const RIVER_BLOCK_GAP_PX = 2;

/** From this height a block shows its time and place as well as its title. */
export const RIVER_ROOMY_PX = 40;

/** From this height a block shows its tags as well. */
export const RIVER_TALL_PX = 70;

/** The axis a trip with no timed stop gets: a waking day, 8:00–22:00. */
export const RIVER_FALLBACK_MINUTES = { t0: 8 * 60, t1: 22 * 60 } as const;

const DAY_MINUTES = 24 * 60;

export type RiverAxis = {
  /** First minute on the axis — a whole hour. */
  t0: number;
  /** Last minute on the axis — a whole hour, at most 24:00. */
  t1: number;
  /** The axis's drawn height. */
  heightPx: number;
};

/**
 * One axis for the whole trip: floor(earliest start) to ceil(latest end), to
 * the hour, so every day column draws 09:00 at the same height.
 *
 * Takes every window on the trip rather than one day's, which is the point —
 * a per-day axis would put Day 1's 09:00 and Day 5's 09:00 at different
 * heights. `null` windows (untimed stops) are skipped; with none left the axis
 * falls back to 8:00–22:00, so an empty trip still draws a day to plan into.
 */
export function riverAxis(windows: Iterable<TimeWindow | null>): RiverAxis {
  let first = Infinity;
  let last = -Infinity;
  for (const window of windows) {
    if (window === null) continue;
    first = Math.min(first, toMinutes(window.start));
    last = Math.max(last, toMinutes(window.end));
  }
  const empty = !(last > first);
  const t0 = empty ? RIVER_FALLBACK_MINUTES.t0 : Math.floor(first / 60) * 60;
  const t1 = empty ? RIVER_FALLBACK_MINUTES.t1 : Math.min(DAY_MINUTES, Math.ceil(last / 60) * 60);
  return { t0, t1, heightPx: minuteToPx({ t0 }, t1) };
}

/** Where a minute of the day sits on the axis, from its top edge. */
export function minuteToPx(axis: Pick<RiverAxis, "t0">, minute: number): number {
  return ((minute - axis.t0) / 60) * RIVER_PX_PER_HOUR;
}

/** Every whole hour on the axis, both ends included. */
export function riverTicks(axis: RiverAxis): { minute: number; topPx: number }[] {
  const ticks: { minute: number; topPx: number }[] = [];
  for (let minute = axis.t0; minute <= axis.t1; minute += 60) {
    ticks.push({ minute, topPx: minuteToPx(axis, minute) });
  }
  return ticks;
}

/**
 * How much a block has room to say. `tall` is a height, not a promise: a block
 * with no tags has nothing to add at that size, and the component decides that.
 */
export type RiverTier = "compact" | "roomy" | "tall";

/** The tier a block of this drawn height falls in — 40px and 70px are SPEC §36.9b's thresholds. */
export function riverTier(heightPx: number): RiverTier {
  if (heightPx >= RIVER_TALL_PX) return "tall";
  if (heightPx >= RIVER_ROOMY_PX) return "roomy";
  return "compact";
}

export type RiverStop = { id: string; window: TimeWindow };

export type RiverPlacement = {
  id: string;
  topPx: number;
  heightPx: number;
  /** Which lane of its cluster the block sits in, from 0. */
  lane: number;
  /** How many lanes its cluster needed — 1 when it overlaps nothing. */
  lanes: number;
  tier: RiverTier;
};

/**
 * Places a day's timed stops on the axis.
 *
 * **Lanes, not halves.** The design draws two half-width lanes and decides
 * them from each stop's neighbours in list order (`prevOv` / `nextOv`), which
 * only ever works for a pair: three stops that overlap put two of them in the
 * same half, on top of each other. Here overlapping blocks are grouped into
 * clusters and packed greedily into as many lanes as the cluster needs, each
 * `1 / lanes` wide — so a pair is the design's two halves and three is thirds.
 *
 * **Overlap is decided on the DRAWN boxes, not the clock.** A 10-minute stop
 * is drawn 24px tall, so a stop that starts when it ends would sit under its
 * bottom edge if lanes only looked at minutes.
 *
 * **Clamped to the axis.** The minimum height can push a stop that ends at the
 * axis's last minute past the bottom; it is lifted to end there instead.
 */
export function layoutRiver(axis: RiverAxis, stops: readonly RiverStop[]): RiverPlacement[] {
  const boxes = stops.map(({ id, window }) => {
    const start = toMinutes(window.start);
    const end = toMinutes(window.end);
    const heightPx = Math.max(RIVER_MIN_BLOCK_PX, minuteToPx({ t0: 0 }, end - start) - RIVER_BLOCK_GAP_PX);
    const unclamped = minuteToPx(axis, start);
    const topPx = Math.max(0, Math.min(unclamped, axis.heightPx - heightPx));
    return { id, start, end, topPx, heightPx };
  });

  // Earliest first; at the same top the longer block takes the left lane, and
  // the id breaks what is left so a day draws the same way every render.
  boxes.sort((a, b) => a.topPx - b.topPx || b.heightPx - a.heightPx || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const placed: RiverPlacement[] = [];
  let cluster: RiverPlacement[] = [];
  let laneEnds: number[] = [];
  let clusterBottom = -Infinity;

  const closeCluster = () => {
    for (const block of cluster) block.lanes = laneEnds.length;
    placed.push(...cluster);
    cluster = [];
    laneEnds = [];
  };

  for (const box of boxes) {
    if (box.topPx >= clusterBottom) closeCluster();
    const bottom = box.topPx + box.heightPx;
    let lane = laneEnds.findIndex((end) => end <= box.topPx);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(bottom);
    } else {
      laneEnds[lane] = bottom;
    }
    clusterBottom = cluster.length === 0 ? bottom : Math.max(clusterBottom, bottom);
    cluster.push({ id: box.id, topPx: box.topPx, heightPx: box.heightPx, lane, lanes: 1, tier: riverTier(box.heightPx) });
  }
  closeCluster();
  return placed;
}

/**
 * A tick's label: "9am" / "12pm" on the 12-hour clock, "09:00" on the 24-hour
 * one. The meridiem loses its space (the design's own `.replace(' ', '')`) so it
 * fits the 32px gutter. 24:00 reads as midnight rather than 23:59 — `toTimeString`
 * clamps, so it is not used here.
 */
export function tickLabel(minute: number, format: TimeFormat): string {
  const hours24 = Math.floor(minute / 60) % 24;
  const mins = minute % 60;
  if (format === "24h") return `${String(hours24).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  const suffix = hours24 < 12 ? "am" : "pm";
  return mins === 0 ? `${hours12}${suffix}` : `${hours12}:${String(mins).padStart(2, "0")}${suffix}`;
}
