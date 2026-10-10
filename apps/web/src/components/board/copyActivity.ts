import type { AddActivity, TimeWindow, TripDetail } from "@tc/contracts";
import { addActivityCommand } from "./activityCommands";
import type { ActivityFormValue } from "./ActivityEditor";

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
