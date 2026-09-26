import { extractClosestEdge } from "@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge";
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
  | { kind: "place"; activityId: string; toDayId: string; position: number | null; timeWindow: TimeWindow | null };

export type PlaceOutcome = Extract<DropOutcome, { kind: "place" }>;

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
 * The plan's draft signature typed both payloads `Record<string, unknown>`;
 * they are `Record<string | symbol, unknown>` here because that is what pdnd's
 * `source.data` / `dropTarget.data` actually are, and what `attachClosestEdge`
 * / `extractClosestEdge` require — the closest-edge value lives under a private
 * `Symbol` key, which a string-only index signature cannot carry.
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
  if (targetData.rack === true) return { kind: "unschedule", activityId };

  const toDayId = typeof targetData.dayId === "string" ? targetData.dayId : null;

  // A day's river says WHEN as well as which day (DayRiver's drop target). Not
  // for a stop coming off the rack: that keeps the rack's own semantics — its
  // time if it has one, a fitted one if not (rackDropWindow) — which is also
  // why the river refuses to be a target for one, so it falls to the column.
  // Checked here as well, so the rule does not rest on the river alone.
  const riverWindow = TimeWindow.safeParse(targetData.riverWindow);
  if (toDayId !== null && riverWindow.success && !trip.backlog.includes(activityId)) {
    return placeOnRiver(trip, activityId, toDayId, riverWindow.data);
  }

  if (typeof targetData.cardActivityId === "string") {
    // Dropped on a card: insert before/after it depending on the edge.
    const list = listFor(trip, toDayId);
    const index = list.indexOf(targetData.cardActivityId);
    let position = extractClosestEdge(targetData) === "bottom" ? index + 1 : index;
    // Moving down within the same list: account for the dragged card's removal.
    const from = containerOf(trip, activityId);
    const sourceIndex = list.indexOf(activityId);
    if (from === toDayId && sourceIndex !== -1 && sourceIndex < position) {
      position -= 1;
    }
    return { kind: "move", activityId, toDayId, position };
  }

  // Dropped on a column rather than a card.
  //
  // A card is not a drop target for itself (`canDrop` in ActivityCard rejects
  // its own source), so releasing over a stop's OWN original position finds no
  // card underneath and lands here. Appending in that case moved the stop to
  // the end of its day — the drag equivalent of putting something back where
  // you found it and watching it jump elsewhere. Reported by Mitchell on PR
  // #55: "Move back to the ghost location for the original drop location and
  // try to drop into original location. Expected: Stay at current location,
  // dont move. Reality: Moves to end of day."
  //
  // So a column drop for a stop already on that day is a no-op — `null`, not
  // its current position, because a MoveActivity that changes nothing still
  // costs a history entry and an undo step.
  //
  // This does not cost the deliberate "send it to the end" gesture: dropping
  // below the last card hits that card's bottom edge and resolves through the
  // card branch above with `position: list.length`. The column branch is only
  // reached from the gaps between and around cards, and only matters for a
  // stop arriving from another day or the rack — which still appends, as
  // before.
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
