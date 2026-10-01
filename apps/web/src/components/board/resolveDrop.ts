import { type BatchableCommand, TimeWindow, type TripDetail } from "@tc/contracts";

export type DropOutcome =
  | { kind: "unschedule"; activityId: string }
  | { kind: "move"; activityId: string; toDayId: string | null; position: number }
  /**
   * A drop on a day's river (M29 part 3): the stop goes to that day AND that
   * time. Either half can be absent — `position: null` when it is already on
   * the day (a MoveActivity that changes nothing still costs an undo step),
   * `timeWindow: null` when it already has that window — but never both, which
   * is a no-op and resolves to `null` instead.
   */
  | { kind: "place"; activityId: string; toDayId: string; position: number | null; timeWindow: TimeWindow | null }
  /**
   * A drop on a day's "Unscheduled" chip (PR #269): the stop goes to that day
   * with NO time. Same halves as `place` — `position: null` when it is already
   * on the day, `clearTime: false` when it already has no window — and never
   * both, which resolves to `null`.
   */
  | { kind: "anyTime"; activityId: string; toDayId: string; position: number | null; clearTime: boolean };

export type PlaceOutcome = Extract<DropOutcome, { kind: "place" }>;
export type AnyTimeOutcome = Extract<DropOutcome, { kind: "anyTime" }>;

function listFor(trip: TripDetail, dayId: string | null): string[] {
  return dayId === null
    ? trip.backlog
    : (trip.days.find((d) => d.dayId === dayId)?.activityIds ?? []);
}

function containerOf(trip: TripDetail, activityId: string): string | null {
  const day = trip.days.find((d) => d.activityIds.includes(activityId));
  return day ? day.dayId : null;
}

/**
 * Pure resolution of a pragmatic-drag-and-drop drop into the mutation it means.
 * `targetData` is `location.current.dropTargets[0].data` — innermost target
 * first. Returns null when the drop is a no-op (no activity, no target).
 *
 * This is separated from the monitor deliberately: pdnd is driven by native
 * HTML5 drag events that jsdom cannot produce (no DataTransfer, no DragEvent),
 * so the routing decision is only checkable if it does not need a drag to run.
 *
 * Both payloads are `Record<string | symbol, unknown>` because that is what
 * pdnd's `source.data` / `dropTarget.data` actually are.
 */
export function resolveDrop(
  trip: TripDetail,
  sourceData: Record<string | symbol, unknown>,
  targetData: Record<string | symbol, unknown> | undefined,
): DropOutcome | null {
  const activityId = sourceData.activityId;
  if (typeof activityId !== "string") return null;
  if (targetData === undefined) return null;

  // The rack check comes first on purpose: a drop on the unscheduled drawer
  // means "take this off the schedule" no matter what else the target carries.
  //
  // **Except for a stop the rack is already showing as its day's.** An untimed
  // stop on a day is drawn in the rack now, under its day (PR #269), and the
  // rack is the only place it can be picked up from — so a drag of one that
  // ends on the rack is a card put back where it was found. Unscheduling it
  // there would strip its day and move it to the front of the drawer: the "put
  // it back and watch it jump" defect the column branch below exists for
  // (Mitchell, PR #55). It keeps its day; a drop on another day's chip or
  // river is how it goes elsewhere.
  //
  // **The rack's "No day" section is the one exception to the exception.**
  // Mitchell, PR #269 (decision 3C): a stop that is "any time on Day 3" needs
  // a way to become "no day at all", and the place to say so is the section
  // that holds day-less stops. A drop there is aimed, not a card let go of
  // where it was found, so it unschedules whatever it carries.
  if (targetData.rack === true) {
    if (targetData.noDay !== true && isAnyTimeOnADay(trip, activityId)) return null;
    return { kind: "unschedule", activityId };
  }

  const toDayId = typeof targetData.dayId === "string" ? targetData.dayId : null;

  // A day's "Unscheduled" chip (Column's header): this day, no time.
  if (toDayId !== null && targetData.anyTime === true) return keepAnyTime(trip, activityId, toDayId);

  // A day's river says WHEN as well as which day (DayRiver's drop target), and
  // it says it the same way whatever was dragged — a block from this day or
  // another, a card off the rack, parked or waiting under its day (Mitchell,
  // 2026-09-26: "When dragging and dropping from anywhere, it should have same
  // functionality"). The window was worked out by the river (`placeWindow`);
  // there is no per-source branch here. `rackDropWindow`'s fitted time is only
  // for a parked stop dropped somewhere that does not name a time.
  const riverWindow = TimeWindow.safeParse(targetData.riverWindow);
  if (toDayId !== null && riverWindow.success) {
    return placeOnRiver(trip, activityId, toDayId, riverWindow.data);
  }

  // Dropped on a day's column, outside its river and its chip.
  //
  // A column drop for a stop already on that day is a no-op — `null`, not its
  // current position, because a MoveActivity that changes nothing still costs
  // a history entry and an undo step. Mitchell on PR #55: "Move back to the
  // ghost location for the original drop location and try to drop into
  // original location. Expected: Stay at current location, dont move.
  // Reality: Moves to end of day." Only a stop arriving from another day or
  // the rack is moved, and it appends.
  //
  // (There used to be a branch above for a drop ON a stop's card — insert
  // before or after it by closest edge. Only the day column's `ActivityCard`
  // was that kind of target, and it went with the "Any time" shelf in PR #269:
  // timed stops are river blocks, whose drops name a time, and untimed ones
  // are rack cards.)
  if (containerOf(trip, activityId) === toDayId) return null;

  return {
    kind: "move",
    activityId,
    toDayId,
    position: listFor(trip, toDayId).filter((id) => id !== activityId).length,
  };
}

/**
 * A `place` outcome as the commands that carry it out, for ONE batch — so one
 * undo puts the stop back on its day and at its time together. Move first:
 * the window is the stop's on the day it lands on.
 */
export function placeCommands(tripId: string, { activityId, toDayId, position, timeWindow }: PlaceOutcome): BatchableCommand[] {
  const commands: BatchableCommand[] = [];
  if (position !== null) commands.push({ type: "MoveActivity", tripId, activityId, toDayId, position });
  if (timeWindow !== null) commands.push({ type: "UpdateActivity", tripId, activityId, timeWindow });
  return commands;
}

/**
 * An `anyTime` outcome as the commands that carry it out, for ONE batch — the
 * same reasoning as `placeCommands`: one gesture, one undo. Move first, so the
 * cleared window is the stop's on the day it lands on.
 */
export function anyTimeCommands(tripId: string, { activityId, toDayId, position, clearTime }: AnyTimeOutcome): BatchableCommand[] {
  const commands: BatchableCommand[] = [];
  if (position !== null) commands.push({ type: "MoveActivity", tripId, activityId, toDayId, position });
  if (clearTime) commands.push({ type: "UpdateActivity", tripId, activityId, timeWindow: null });
  return commands;
}

/** Whether a stop sits on a day with no time — what the rack shows under that day. */
function isAnyTimeOnADay(trip: TripDetail, activityId: string): boolean {
  return containerOf(trip, activityId) !== null && trip.activities[activityId]?.timeWindow == null;
}

/**
 * A drop on a day's "Unscheduled" chip, as the smallest change that gets there.
 *
 * Appended to the day's list: an untimed stop has no clock to be ordered by,
 * and the end is where the old "Any time" shelf put one dropped on its column.
 * On its own day it does not move at all (a MoveActivity that changes nothing
 * still costs an undo step), and an untimed stop dropped on its own day's chip
 * changes nothing and resolves to `null`.
 */
function keepAnyTime(trip: TripDetail, activityId: string, toDayId: string): DropOutcome | null {
  const clearTime = trip.activities[activityId]?.timeWindow != null;
  const sameDay = containerOf(trip, activityId) === toDayId;
  if (sameDay && !clearTime) return null;
  const position = sameDay ? null : listFor(trip, toDayId).filter((id) => id !== activityId).length;
  return { kind: "anyTime", activityId, toDayId, position, clearTime };
}

/**
 * A drop at a time on a day's river, as the smallest change that gets there.
 *
 * The stop goes before the first stop on that day that starts later — the list
 * order is what the phone's card list and every non-river surface read, so it
 * should agree with the clock. That holds on the stop's own day too: re-timed
 * past a later stop, it has to move past it in the list as well, or the phone
 * reads the day out of order. The move is sent only when the index changes (a
 * MoveActivity that changes nothing still costs an undo step), and a drop at
 * the stop's own time moves nothing at all.
 */
function placeOnRiver(trip: TripDetail, activityId: string, toDayId: string, window: TimeWindow): DropOutcome | null {
  const current = trip.activities[activityId]?.timeWindow ?? null;
  const sameTime = current !== null && current.start === window.start && current.end === window.end;
  const sameDay = containerOf(trip, activityId) === toDayId;
  if (sameDay && sameTime) return null;
  const timeWindow = sameTime ? null : window;

  const list = listFor(trip, toDayId);
  const others = list.filter((id) => id !== activityId);
  const later = others.findIndex((id) => {
    const start = trip.activities[id]?.timeWindow?.start;
    return start !== undefined && start > window.start;
  });
  const byClock = later === -1 ? others.length : later;
  // `position` is an index into the list with the stop already taken out
  // (ActivityMoved removes, then inserts), which on its own day is `others`.
  const position = sameDay && list.indexOf(activityId) === byClock ? null : byClock;
  return { kind: "place", activityId, toDayId, position, timeWindow };
}
