import type { BatchableCommand, TripDetail } from "@tc/contracts";
import { predictBatch } from "@tc/predict";
import { fitIntoDay } from "@/components/trip/fitIntoDay";
import type { ActivityFormValue } from "./ActivityEditor";
import { updateActivityCommand } from "./activityCommands";
import { moveCommands } from "./moveCommands";

/**
 * What saving the editor on an existing stop sends (M41 D3). An unchanged day
 * is the one `UpdateActivity` it always was. A changed day is one batch, so one
 * History entry and one undo: the move first, built by `moveCommands` like
 * every other move, then the update.
 *
 * The time follows the moves the rack and a drag already make:
 * - **To Unscheduled, the time goes.** Parking strips the times
 *   (`unscheduleActivity`).
 * - **From the rack onto a day with no time given, it gets a fitted one**, as
 *   the rack's *Add to day…* did (`assignFromRack`), so the stop leaves the
 *   rack rather than waiting under its new day.
 * - **Otherwise it keeps the form's time**, so a timed stop keeps its hours on
 *   its new day.
 *
 * **`null` when the picked day no longer exists** (another editor removed it
 * while the sheet was open): the caller refuses the save, rather than sending
 * an update that clears the time of a stop that has not moved (CodeRabbit,
 * #392).
 *
 * **An update that changes nothing is left out.** The optimistic queue refuses
 * a whole unit when any command in it is a no-op, so a day picked and nothing
 * else changed would otherwise be dropped in silence.
 */
export function editActivityCommands(
  trip: TripDetail,
  activityId: string,
  value: ActivityFormValue,
): BatchableCommand[] | null {
  const update = updateActivityCommand(trip.tripId, activityId, value);
  const fromDayId = trip.days.find((day) => day.activityIds.includes(activityId))?.dayId ?? null;
  if (value.dayId === fromDayId) return [update];

  const toDay = trip.days.find((day) => day.dayId === value.dayId);
  if (value.dayId !== null && toDay === undefined) return null;
  const moves = moveCommands(trip, [activityId], value.dayId);
  let timeWindow = value.timeWindow;
  if (toDay === undefined) timeWindow = null;
  else if (timeWindow === null && fromDayId === null) {
    timeWindow = fitIntoDay(
      toDay.activityIds
        .map((id) => trip.activities[id]?.timeWindow)
        .filter((w): w is { start: string; end: string } => w !== null && w !== undefined),
    );
  }
  const retimed = { ...update, timeWindow };
  const moved = predictBatch(trip, moves);
  const changes = !moved.ok || predictBatch(moved.detail, [retimed]).ok;
  return changes ? [...moves, retimed] : moves;
}
