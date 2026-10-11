import { type AddActivity, type BatchableCommand, TimeWindow, type TripDetail } from "@tc/contracts";
import { addActivityCommand } from "./activityCommands";
import type { ActivityFormValue } from "./ActivityEditor";
import { rackDropWindow } from "./rackDropWindow";

/**
 * Where an Option/Alt-drop puts a stop's copy (M41 D7): the day (`null` for
 * the rack), the time (`undefined` keeps the stop's own, `null` gives none),
 * and the index in the day's list when appending would put it out of clock
 * order (`null`: append).
 */
export type CopyDestination = {
  activityId: string;
  dayId: string | null;
  timeWindow?: TimeWindow | null;
  position: number | null;
};

/**
 * A drop with Option/Alt held, as where its copy lands — `resolveDrop`'s
 * reading of the same target, **without its "nothing changes" short-circuits**
 * (PR 396 review). Those exist because a move to where a stop already is would
 * cost an undo for nothing; a copy there is a real second stop. So a copy
 * dropped at its stop's own time on its own day, on its own column, or an
 * untimed stop's copy on the rack where it is shown, all land.
 *
 * - **The rack**: parked, with no time — except an untimed stop shown under its
 *   day there, whose copy joins it under that day (the section it was dropped
 *   on), unless the drop was on the rack's "No day" section.
 * - **A day's "Unscheduled" chip**: that day, no time, appended.
 * - **A day's river**: that day at the river's time, before the first stop
 *   there that starts later, so the list agrees with the clock as a moved
 *   stop's does (`resolveDrop`'s `placeOnRiver`).
 * - **The rest of a column**: that day, appended, keeping the stop's time — or,
 *   for a parked stop with none, the fitted one a move there gets
 *   (`rackDropWindow`).
 */
export function resolveCopy(
  trip: TripDetail,
  sourceData: Record<string | symbol, unknown>,
  targetData: Record<string | symbol, unknown> | undefined,
): CopyDestination | null {
  const activityId = sourceData.activityId;
  if (typeof activityId !== "string" || targetData === undefined) return null;
  const activity = trip.activities[activityId];
  if (activity === undefined) return null;

  if (targetData.rack === true) {
    const ownDay = trip.days.find((d) => d.activityIds.includes(activityId))?.dayId ?? null;
    const shownUnderItsDay = targetData.noDay !== true && ownDay !== null && activity.timeWindow == null;
    return { activityId, dayId: shownUnderItsDay ? ownDay : null, timeWindow: null, position: null };
  }

  const dayId = typeof targetData.dayId === "string" ? targetData.dayId : null;
  if (dayId === null) return null;
  const list = trip.days.find((d) => d.dayId === dayId)?.activityIds ?? [];

  if (targetData.anyTime === true) return { activityId, dayId, timeWindow: null, position: null };

  const riverWindow = TimeWindow.safeParse(targetData.riverWindow);
  if (riverWindow.success) {
    const later = list.findIndex((id) => {
      const start = trip.activities[id]?.timeWindow?.start;
      return start !== undefined && start > riverWindow.data.start;
    });
    return { activityId, dayId, timeWindow: riverWindow.data, position: later === -1 ? null : later };
  }

  return { activityId, dayId, timeWindow: rackDropWindow(trip, activityId, dayId, list.length) ?? undefined, position: null };
}

/**
 * A copy as the commands that make it, for ONE batch — one History entry, one
 * undo. `AddActivity` appends to the day's list, so a copy that belongs
 * earlier by the clock is moved there in the same batch (PR 396 review).
 */
export function copyCommands(trip: TripDetail, to: CopyDestination, newActivityId: string): BatchableCommand[] {
  const add = copyActivityCommand(trip, to.activityId, newActivityId, to);
  if (add === null) return [];
  if (to.position === null) return [add];
  return [add, { type: "MoveActivity", tripId: trip.tripId, activityId: newActivityId, toDayId: to.dayId, position: to.position }];
}

/**
 * A copy of a stop, as the `AddActivity` an Option/Alt-drag drops (M41 D7).
 * Every field the stop has, through `addActivityCommand` (the one place a form
 * value becomes a command, so a field added to a stop cannot be dropped from
 * its copy), on the day it was dropped on (`null` for the rack) and at the
 * time the drop named, or its own when the drop named none.
 */
export function copyActivityCommand(
  trip: Pick<TripDetail, "tripId" | "activities">,
  activityId: string,
  newActivityId: string,
  to: { dayId: string | null; timeWindow?: TimeWindow | null },
): AddActivity | null {
  const activity = trip.activities[activityId];
  if (activity === undefined) return null;
  const { activityId: _id, ...fields } = activity;
  void _id;
  const value: ActivityFormValue = {
    ...fields,
    dayId: to.dayId,
    timeWindow: to.timeWindow === undefined ? activity.timeWindow : to.timeWindow,
  };
  return addActivityCommand(trip.tripId, newActivityId, value);
}
