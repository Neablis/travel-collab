import type { TimeWindow } from "@tc/contracts";
import { DAY_END_MIN, toMinutes, toTimeString } from "@/lib/time";
import { durationMinutes, DEFAULT_DURATION_LABEL } from "./activityDuration";
import { RIVER_PX_PER_HOUR, type RiverAxis } from "./riverLayout";

// The arithmetic behind the river's gestures (SPEC §36.9b, M29 part 3): which
// minute a pointer is over, and what a double-click, a sketch, a resize and a
// drop each turn into. Pure, so every clamp can be asserted without a pointer;
// `DayRiver` owns the events and nothing else. The design's own version is
// `riverDown()` / `overCol()` / `riverAdd` in `Trip Planner Redesign.dc.html`
// (~8960–9060, ~9326, ~9555); what differs here is written down where it does.
//
// Every function takes and returns MINUTES of the day. `y` is always measured
// from the river's top edge, in px.

/** The design's `SNAP = 15`: every gesture lands on a quarter hour. */
export const RIVER_SNAP_MINUTES = 15;

/** The shortest stop a sketch or a resize can leave — one snap. */
export const RIVER_MIN_MINUTES = RIVER_SNAP_MINUTES;

/**
 * A sketch shorter than this is a slip, not a stop, and opens nothing — the
 * design's `b - a >= 30`.
 */
export const RIVER_MIN_SKETCH_MINUTES = 30;

/**
 * What a double-click, or an untimed stop dropped on the river, gets: the add
 * sheet's own default ("1 hour"), so the two never disagree.
 */
export const RIVER_NEW_STOP_MINUTES = durationMinutes(DEFAULT_DURATION_LABEL);

/**
 * How far a pointer must travel before a press on empty time is a sketch
 * rather than a click. Below it, a release is a click and the double-click
 * handler keeps it.
 */
export const RIVER_DRAG_THRESHOLD_PX = 4;

/**
 * One past the last minute a window may END on. A gesture can reach midnight
 * (`24:00`), and a stored window cannot say that — `toTimeString` clamps it to
 * 23:59 on the way out (`DAY_END_MIN`).
 */
const MIDNIGHT = DAY_END_MIN + 1;

/** A window in minutes, before it becomes the "HH:MM" pair the contract stores. */
export type MinuteWindow = { start: number; end: number };

const clamp = (value: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, value));

/** To the nearest quarter hour. */
export function snapMinute(minute: number): number {
  return Math.round(minute / RIVER_SNAP_MINUTES) * RIVER_SNAP_MINUTES;
}

/** The unsnapped minute at `y` px down the river — `minuteToPx`'s inverse. */
export function minuteAtPx(axis: Pick<RiverAxis, "t0">, y: number): number {
  return axis.t0 + (y / RIVER_PX_PER_HOUR) * 60;
}

/** Stored form: "HH:MM" both ends, midnight read as 23:59. */
export function toTimeWindow(window: MinuteWindow): TimeWindow {
  return { start: toTimeString(window.start), end: toTimeString(window.end) };
}

/** A stored window in minutes. */
export function fromTimeWindow(window: TimeWindow): MinuteWindow {
  return { start: toMinutes(window.start), end: toMinutes(window.end) };
}

/**
 * **Double-click on empty time**: a stop starting at the quarter hour under the
 * pointer, an hour long, kept on the axis — a double-click in the axis's last
 * half hour starts the hour early enough to end on the axis rather than
 * running off its bottom.
 *
 * The design holds the start at `t1 - 30` and lets the hour run past the axis;
 * here the whole hour stays on it, because a stop that ends below the drawn
 * river is a stop the reader cannot see the end of.
 */
export function doubleClickWindow(axis: RiverAxis, y: number): MinuteWindow {
  const start = clamp(snapMinute(minuteAtPx(axis, y)), axis.t0, axis.t1 - RIVER_NEW_STOP_MINUTES);
  return { start, end: Math.min(MIDNIGHT, start + RIVER_NEW_STOP_MINUTES) };
}

/**
 * **Drag across empty time**: the window between where the press landed and
 * where the pointer is now, each snapped, at least a quarter hour long.
 *
 * Either direction — the design only grows downward, and a stop sketched from
 * its end up to its start is the same stop. It stays on the axis at the top
 * (nothing is drawn above `t0`) and may run below it to midnight, as the
 * design's does.
 */
export function sketchWindow(axis: RiverAxis, anchorY: number, pointerY: number): MinuteWindow {
  const anchor = clamp(snapMinute(minuteAtPx(axis, anchorY)), axis.t0, MIDNIGHT - RIVER_MIN_MINUTES);
  const pointer = clamp(snapMinute(minuteAtPx(axis, pointerY)), axis.t0, MIDNIGHT);
  if (pointer >= anchor) return { start: anchor, end: Math.max(anchor + RIVER_MIN_MINUTES, pointer) };
  return { start: Math.min(pointer, anchor - RIVER_MIN_MINUTES), end: anchor };
}

/** Whether a sketch is long enough to open the add sheet — 30 minutes. */
export function sketchCreates(window: MinuteWindow): boolean {
  return window.end - window.start >= RIVER_MIN_SKETCH_MINUTES;
}

/**
 * **Drag a block's bottom edge**: the new end is the quarter hour under the
 * pointer, never less than a quarter hour after the stop's start and never
 * past midnight.
 *
 * The start is not snapped: a 10:10 stop keeps its 10:10 and only its end
 * moves.
 */
export function resizeEnd(axis: RiverAxis, start: number, pointerY: number): number {
  return clamp(snapMinute(minuteAtPx(axis, pointerY)), start + RIVER_MIN_MINUTES, MIDNIGHT);
}

/**
 * How long a stop is, for placing it somewhere else: its own length, or the
 * add sheet's default hour when it has no time at all.
 */
export function stopMinutes(window: TimeWindow | null): number {
  if (window === null) return RIVER_NEW_STOP_MINUTES;
  return Math.max(RIVER_MIN_MINUTES, toMinutes(window.end) - toMinutes(window.start));
}

/**
 * **Drop a stop on the river**: its start is the quarter hour where its TOP
 * edge lands — the pointer, less where on the block it was picked up
 * (`grabOffsetPx`), so a block held by its middle lands where the outline under
 * the pointer shows it and does not jump down by half its height. A card from
 * the "Any time" shelf has no block to hold, so its offset is 0 and its top
 * goes to the pointer.
 *
 * It keeps its own length and has to fit in the day: no start above the axis,
 * no end past midnight. The design subtracts a flat 15 minutes instead of the
 * grab offset, and clamps the same way.
 */
export function dropWindow(axis: RiverAxis, pointerY: number, grabOffsetPx: number, minutes: number): MinuteWindow {
  const latestStart = Math.max(axis.t0, Math.floor((MIDNIGHT - minutes) / RIVER_SNAP_MINUTES) * RIVER_SNAP_MINUTES);
  const start = clamp(snapMinute(minuteAtPx(axis, pointerY - grabOffsetPx)), axis.t0, latestStart);
  return { start, end: Math.min(MIDNIGHT, start + minutes) };
}
