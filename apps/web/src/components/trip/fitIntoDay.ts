import { DAY_END_MIN, toMinutes, toTimeString } from "@/lib/time";

export type Slot = { start: string; end: string };

// The day the rack is allowed to place into ends at DAY_END_MIN (lib/time.ts):
// 23:59 is the last renderable wall-clock minute, so it is also the last
// minute a placed window may end on.
// A day with nothing on it starts the search here rather than at midnight —
// nobody wants a suggested stop at 00:00.
const DEFAULT_START_MIN = 9 * 60;
// The same 09:00, as a wall-clock string, for callers that need to ask for
// "the start of the day" explicitly rather than relying on the empty-day
// fallback below — rackDropWindow does, for a stop dropped above everything.
export const DEFAULT_DAY_START = toTimeString(DEFAULT_START_MIN);
const TARGET_MIN = 60; // a fresh stop wants a full hour
const AIR_MIN = 30; // breathing room between a placed stop and its neighbours
const FLOOR_MIN = 15; // never suggest a window shorter than this
// Above this the gap is roomy enough that shrinking is pointless — the stop
// keeps its full hour and the air is just leading padding.
const COMFORT_GAP_MIN = 8 * 60;

type Gap = { start: number; end: number; afterWindow: boolean };

// Merge overlapping/touching windows, then invert them into the day's free
// gaps. `afterWindow` records whether a gap opens where a booked window closed
// — that is where the leading 30 minutes of air is owed. The first gap of a
// day that starts free (and the whole of an empty day) owes nothing.
function freeGaps(existing: Slot[]): Gap[] {
  const windows = existing
    .map((slot) => ({ start: toMinutes(slot.start), end: toMinutes(slot.end) }))
    .filter((w) => w.end > w.start)
    .sort((a, b) => a.start - b.start);

  const merged: { start: number; end: number }[] = [];
  for (const w of windows) {
    const last = merged[merged.length - 1];
    if (last && w.start <= last.end) last.end = Math.max(last.end, w.end);
    else merged.push({ ...w });
  }

  const gaps: Gap[] = [];
  let cursor = 0;
  for (const w of merged) {
    if (w.start > cursor) gaps.push({ start: cursor, end: w.start, afterWindow: cursor !== 0 });
    cursor = Math.max(cursor, w.end);
  }
  if (cursor < DAY_END_MIN) gaps.push({ start: cursor, end: DAY_END_MIN, afterWindow: cursor !== 0 });
  return gaps;
}

/**
 * Pick a window for a stop being dropped onto a day from the unscheduled rack.
 *
 * `existing` is the day's already-scheduled windows in any order (sorted here).
 * The search starts at `preferredStart` when given, else at the end of the
 * day's last window, else at 09:00 on an empty day, and takes the first free
 * gap from there that can hold a stop.
 *
 * Inside that gap the stop wants 60 minutes with 30 minutes of air on each
 * side, so it needs a 120-minute gap to keep its full hour; a gap of 8h or more
 * is comfortable by definition. A tighter gap keeps whatever is left after the
 * air, down to a 15-minute floor, and the air itself is squeezed evenly rather
 * than pushing the window past the gap's end. The result is never inverted or
 * zero-length.
 */
export function fitIntoDay(existing: Slot[], preferredStart?: string): Slot {
  const gaps = freeGaps(existing);
  const lastEnd = existing.reduce(
    (max, slot) => (toMinutes(slot.end) > toMinutes(slot.start) ? Math.max(max, toMinutes(slot.end)) : max),
    -1,
  );
  const cursor = preferredStart !== undefined ? toMinutes(preferredStart) : lastEnd >= 0 ? lastEnd : DEFAULT_START_MIN;

  // First gap at or after the cursor that can still hold a floor-length stop,
  // then (day already full past the cursor) the earliest such gap anywhere.
  const fits = (gap: Gap) => gap.end - Math.max(gap.start, cursor) >= FLOOR_MIN;
  const afterCursor = gaps.find(fits);
  const chosen = afterCursor ?? gaps.find((gap) => gap.end - gap.start >= FLOOR_MIN);

  if (!chosen) {
    // Nothing free anywhere: fall back to a floor-length window pinned inside
    // the day so callers still get a real, editable time rather than nothing.
    const start = Math.max(0, Math.min(cursor, DAY_END_MIN - FLOOR_MIN));
    return { start: toTimeString(start), end: toTimeString(start + FLOOR_MIN) };
  }

  // The fallback gap can start before the cursor (that's why it didn't fit
  // `fits`, which requires FLOOR_MIN free *after* the cursor) — clamping to
  // `cursor` there would place the window's start inside whatever booking
  // sits between the gap and the cursor. Only clamp to the cursor when the
  // chosen gap is the one that already satisfied it.
  const from = afterCursor ? Math.max(chosen.start, cursor) : chosen.start;
  const usable = chosen.end - from;
  const duration =
    usable >= COMFORT_GAP_MIN ? TARGET_MIN : Math.min(TARGET_MIN, Math.max(FLOOR_MIN, usable - 2 * AIR_MIN));
  // Air is only owed where the stop butts up against the window before it —
  // a preferred start, or the start of an untouched day, is taken at face
  // value. Half of whatever the gap has spare caps it, so the trailing side
  // keeps its share and the window can never overrun the gap.
  const leftover = Math.max(0, usable - duration);
  const air = from === chosen.start && chosen.afterWindow ? Math.min(AIR_MIN, Math.floor(leftover / 2)) : 0;
  const start = from + air;
  return { start: toTimeString(start), end: toTimeString(start + duration) };
}
