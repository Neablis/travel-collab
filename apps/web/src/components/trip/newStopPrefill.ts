import type { TripDetail } from "@tc/contracts";
import type { ActivityPrefill } from "@/components/trip/context/EditorHost";
import { fitIntoDay } from "@/components/trip/fitIntoDay";

/**
 * The editor's prefill for a new stop on `dayId`, or parked when there is no
 * day: what a paste onto a day and the palette's *New stop* both open
 * (M41 D8, D9, ADR-068).
 *
 * **On a day, the stop gets a time**, fitted after the day's last stop as the
 * rack's *Add to day…* fitted one. An untimed stop is drawn in the rack and not
 * on its day, so a stop made "on Day 2" without one would seem to land
 * nowhere. A day that no longer exists parks it.
 */
export function newStopPrefill(
  trip: Pick<TripDetail, "days" | "activities">,
  dayId: string | undefined,
  rest: Omit<ActivityPrefill, "dayId" | "timeWindow"> = {},
): ActivityPrefill {
  const day = dayId === undefined ? undefined : trip.days.find((d) => d.dayId === dayId);
  if (day === undefined) return rest;
  const windows = day.activityIds.flatMap((id) => {
    const window = trip.activities[id]?.timeWindow;
    return window ? [window] : [];
  });
  return { ...rest, dayId: day.dayId, timeWindow: fitIntoDay(windows) };
}
