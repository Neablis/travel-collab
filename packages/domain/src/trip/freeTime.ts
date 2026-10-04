import type { TripDetail } from "@tc/contracts";

// ADR-022 §2: the AI context envelope never carried activity time windows, so
// "where is the most free time?" had no real answer — the model would have
// had to invent one. This is the computation that makes the answer real;
// minute arithmetic belongs here, not in a prompt.

export interface FreeGap {
  dayIndex: number;
  startMinutes: number; // minutes from midnight, 0-1440
  endMinutes: number;
  durationMinutes: number;
}

export interface FindFreeGapsOptions {
  dayIndex?: number; // undefined = every day
  afterMinutes?: number; // default 0
  beforeMinutes?: number; // default 1440
  minMinutes?: number; // default 0; gaps shorter than this are dropped
}

// HH:mm -> minutes past midnight, and the ONLY minutes-since-midnight
// conversion anywhere — reuse it rather than growing a second time parser
// (KI-73).
//
// Exported for the AI read-tool boundary
// (`apps/web/src/server/assistant/tools/read.ts`),
// which is where a user's "after 9pm" becomes the minutes this module speaks.
// It does NOT validate: inside the domain `TimeWindow`'s regex
// (packages/contracts/src/activity.ts) already guarantees the shape, and at
// the tool boundary the tool's own input schema does. A caller with neither
// guarantee must check before calling — this returns NaN on nonsense, and NaN
// arithmetic is silent.
//
// Accepts "24:00" (= 1440) as well, which `TimeWindow` does not: an exclusive
// end-of-day is a real bound for a free-time query even though it is not a
// real start time.
export function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h! * 60 + m!;
}

// Busy blocks for one day, merged. Only a `timeWindow`'d activity occupies
// time: an unscheduled stop is backlog-shaped, not "all day" (the single
// most important rule here — see the task brief). An id listed on the day
// but missing from `detail.activities` (the id/record split makes this
// representable even though the command path shouldn't produce it) is
// treated the same as "no time data": it does not occupy time, rather than
// crashing or being invented as a block.
//
// Overlap merges before gaps are computed — two stops ten minutes apart in
// time are one busy block, not two, which is what keeps a gap from ever
// coming out negative.
function busyIntervalsFor(detail: TripDetail, activityIds: readonly string[]): Array<[number, number]> {
  const raw: Array<[number, number]> = [];
  for (const id of activityIds) {
    const activity = detail.activities[id];
    if (!activity || activity.timeWindow === null) continue;
    raw.push([minutesOf(activity.timeWindow.start), minutesOf(activity.timeWindow.end)]);
  }
  raw.sort((a, b) => a[0] - b[0]);

  const merged: Array<[number, number]> = [];
  for (const block of raw) {
    const last = merged[merged.length - 1];
    // `<=`, not `<`: two blocks that exactly touch (one ends where the next
    // starts) merge too. Deliberately slightly broader than "overlapping" —
    // it costs nothing (a zero-width gap between touching blocks would be
    // dropped by the zero-length rule regardless) and keeps this the only
    // merge branch to reason about.
    if (last && block[0] <= last[1]) {
      // max(), not overwrite: `block` may be entirely CONTAINED in `last`
      // (e.g. a 10:00-11:00 stop inside a 09:00-17:00 one) and end earlier
      // than it. Overwriting the end with `block[1]` would truncate the
      // merged block and silently turn real busy time into a reported gap.
      last[1] = Math.max(last[1], block[1]);
    } else {
      merged.push(block);
    }
  }
  return merged;
}

function makeGap(dayIndex: number, start: number, end: number): FreeGap {
  return { dayIndex, startMinutes: start, endMinutes: end, durationMinutes: end - start };
}

// Gaps for one day within [after, before). Busy blocks are clipped to the
// window rather than dropped whole — an activity that starts inside the
// window and runs past `beforeMinutes` still occupies the part of it that
// falls inside, so the tail of the window isn't wrongly reported as free.
function gapsForDay(
  detail: TripDetail,
  dayIndex: number,
  activityIds: readonly string[],
  after: number,
  before: number,
): FreeGap[] {
  const gaps: FreeGap[] = [];
  let cursor = after;
  for (const [busyStart, busyEnd] of busyIntervalsFor(detail, activityIds)) {
    const start = Math.max(busyStart, after);
    const end = Math.min(busyEnd, before);
    if (start >= end) continue; // block falls entirely outside [after, before)
    if (start > cursor) gaps.push(makeGap(dayIndex, cursor, start));
    cursor = Math.max(cursor, end);
  }
  if (cursor < before) gaps.push(makeGap(dayIndex, cursor, before));
  return gaps;
}

export function findFreeGaps(detail: TripDetail, options: FindFreeGapsOptions = {}): FreeGap[] {
  const after = options.afterMinutes ?? 0;
  const before = options.beforeMinutes ?? 1440;
  const minMinutes = options.minMinutes ?? 0;
  if (after >= before) return [];

  const targetDays =
    options.dayIndex === undefined
      ? detail.days.map((day, dayIndex) => ({ day, dayIndex }))
      : detail.days[options.dayIndex]
        ? [{ day: detail.days[options.dayIndex]!, dayIndex: options.dayIndex }]
        : [];

  return targetDays
    .flatMap(({ day, dayIndex }) => gapsForDay(detail, dayIndex, day.activityIds, after, before))
    .filter((gap) => gap.durationMinutes > 0 && gap.durationMinutes >= minMinutes)
    .sort((a, b) => a.dayIndex - b.dayIndex || a.startMinutes - b.startMinutes);
}

// The hours a "free time" answer is about (M32, Mitchell 2026-10-04: "Hardcode
// 8-22 for now"). Unbounded, the largest gap on almost any day is the one
// between the last stop and breakfast, and an empty day scores 24 hours — a
// true answer nobody asked for. There is no waking-hours preference to read;
// one can replace these constants without changing a caller.
export const DAYTIME_START_MINUTES = 8 * 60;
export const DAYTIME_END_MINUTES = 22 * 60;

/** The three parts a day's free time is reported in, inside `DAYTIME_*`. */
export const DAY_PARTS = [
  { part: "morning", startMinutes: 8 * 60, endMinutes: 12 * 60 },
  { part: "afternoon", startMinutes: 12 * 60, endMinutes: 17 * 60 },
  { part: "evening", startMinutes: 17 * 60, endMinutes: 22 * 60 },
] as const;

export type DayPart = (typeof DAY_PARTS)[number]["part"];

export interface DayFreeSummary {
  dayIndex: number;
  /** The sum of this day's gaps, exactly as `findFreeGaps` lists them for the same options. */
  freeMinutes: number;
  /** Free minutes inside each part of the day. Time outside 08:00-22:00 is in `freeMinutes` only. */
  parts: Record<DayPart, number>;
  /** The day's longest gap; the earliest of equals. Null when the day has none. */
  longestGap: FreeGap | null;
  /**
   * Stops on the day with no time. They occupy no time (see `busyIntervalsFor`),
   * so a day can rank "free" only because nothing on it has been given a time.
   * The count lets an answer say so.
   */
  untimedStops: number;
}

function overlap(start: number, end: number, from: number, to: number): number {
  return Math.max(0, Math.min(end, to) - Math.max(start, from));
}

/**
 * Which day is most free (M32): every searched day, ranked most free first.
 *
 * Built from `findFreeGaps` with the same options rather than beside it, so a
 * day's total is the sum of the gaps the caller also lists, and the ranking
 * and the gap list cannot disagree. A searched day with no gap at all is still
 * a row, with zero: "day 3 is fully booked" is part of the answer.
 *
 * Ties: the longer longest gap first (one open afternoon beats three short
 * breaks), then the earlier day.
 */
export function summarizeFreeDays(detail: TripDetail, options: FindFreeGapsOptions = {}): DayFreeSummary[] {
  const gaps = findFreeGaps(detail, options);
  const dayIndexes =
    options.dayIndex === undefined
      ? detail.days.map((_, dayIndex) => dayIndex)
      : detail.days[options.dayIndex]
        ? [options.dayIndex]
        : [];

  return dayIndexes
    .map((dayIndex): DayFreeSummary => {
      const own = gaps.filter((gap) => gap.dayIndex === dayIndex);
      const parts = Object.fromEntries(
        DAY_PARTS.map(({ part, startMinutes, endMinutes }) => [
          part,
          own.reduce((sum, gap) => sum + overlap(gap.startMinutes, gap.endMinutes, startMinutes, endMinutes), 0),
        ]),
      ) as Record<DayPart, number>;
      const longestGap = own.reduce<FreeGap | null>(
        (best, gap) => (best === null || gap.durationMinutes > best.durationMinutes ? gap : best),
        null,
      );
      const untimedStops = detail.days[dayIndex]!.activityIds.filter(
        (id) => detail.activities[id] !== undefined && detail.activities[id]!.timeWindow === null,
      ).length;
      return {
        dayIndex,
        freeMinutes: own.reduce((sum, gap) => sum + gap.durationMinutes, 0),
        parts,
        longestGap,
        untimedStops,
      };
    })
    .sort(
      (a, b) =>
        b.freeMinutes - a.freeMinutes ||
        (b.longestGap?.durationMinutes ?? 0) - (a.longestGap?.durationMinutes ?? 0) ||
        a.dayIndex - b.dayIndex,
    );
}
