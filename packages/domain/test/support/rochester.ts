// Lives in the domain tests, not @tc/factories: factories depends on domain, so
// domain cannot import it back (and stays pure).
//
// A Rochester-shaped trip for the containment rule (M44 D4): three days, each
// a meal inside a day-long stop, as apps/web/scripts/db-seed.ts's Rochester
// trip is laid out. Every pair nests, none overlaps partially, so a correct
// `time-overlap` rule raises nothing on it. Commands (not a TripDetail) so a
// domain test can fold them into the TripState the rule actually reads.

import type { TripCommand } from "@tc/contracts";
import { uuid } from "./tripGenerator";

/** Every command after `CreateTrip`: dates (three days), then six timed stops. */
export function rochesterContainmentCommandsFor(tripId: string): TripCommand[] {
  let n = 0;
  const id = () => uuid(4400 + n++);
  const dayIds = [id(), id(), id()];
  const stop = (dayId: string, title: string, start: string, end: string, tags: "meal"[] = []): TripCommand => ({
    type: "AddActivity",
    tripId,
    activityId: id(),
    dayId,
    title,
    timeWindow: { start, end },
    tags,
  });
  return [
    { type: "SetTripDates", tripId, startDate: "2027-06-01", endDate: "2027-06-03", newDayIds: dayIds },
    stop(dayIds[0]!, "The Strong Museum of Play", "09:00", "17:00"),
    stop(dayIds[0]!, "Lunch at the museum cafe", "12:00", "13:30", ["meal"]),
    stop(dayIds[1]!, "Letchworth State Park", "08:00", "18:00"),
    stop(dayIds[1]!, "Picnic lunch", "12:00", "14:00", ["meal"]),
    stop(dayIds[2]!, "Niagara Falls day trip", "08:00", "16:00"),
    stop(dayIds[2]!, "Lunch at the falls", "12:00", "15:00", ["meal"]),
  ];
}
