// **The trips a live-set prompt can run against** (M33). Every prompt ran on
// the seeded Japan trip until a prompt needed a trip that trip cannot be: 14
// days is under `read_trip`'s overview line (`OVERVIEW_ABOVE_DAYS`), so it can
// say nothing about how the assistant handles a long one. A prompt names its
// trip with `"trip"` in `live-set.json`; one that names none runs on Japan, as
// every prompt before this did, so no earlier prompt's run changed.
import type { Location, TripCommand } from "@tc/contracts";
import { commandsFor } from "@tc/factories";

/** The trips a live-set prompt may name, beyond the default Japan trip. */
export const EVAL_TRIPS = ["long-100"] as const;
export type EvalTripName = (typeof EVAL_TRIPS)[number];

// A hundred days through six stays, Tokyo twice: long enough to be well past
// the overview line, and shaped like a real long trip — a few cities, each for
// weeks — so the overview it gets is the ~330-token one a real trip gets, not
// the capped worst case. The second Tokyo stay is a repeat visit, which the
// overview must report as its own segment.
const LEGS: readonly { city: string; days: number; lat: number; lng: number }[] = [
  { city: "Tokyo", days: 15, lat: 35.6812, lng: 139.7671 },
  { city: "Kyoto", days: 25, lat: 35.0116, lng: 135.7681 },
  { city: "Osaka", days: 15, lat: 34.6937, lng: 135.5023 },
  { city: "Hiroshima", days: 10, lat: 34.3853, lng: 132.4553 },
  { city: "Fukuoka", days: 20, lat: 33.5902, lng: 130.4017 },
  { city: "Tokyo", days: 15, lat: 35.6812, lng: 139.7671 },
];

/** Days in `long-100`. Exported so a test can hold it past the overview line. */
export const LONG_TRIP_DAYS = LEGS.reduce((sum, leg) => sum + leg.days, 0);

/**
 * `long-100` as the commands that build it after `CreateTrip`: two priced,
 * timed stops a day in that day's city, through `commandsFor` — the factory's
 * command twin, so the trip is folded by the real pipeline like any other.
 */
export function longTripCommands(tripId: string): TripCommand[] {
  const legOfDay = LEGS.flatMap((leg) => Array.from({ length: leg.days }, () => leg));
  const stopsPerDay = 2;
  return commandsFor("threeDayTrip", tripId, {
    dayCount: legOfDay.length,
    activitiesPerDay: stopsPerDay,
    startDate: "2027-04-01",
    // `commandsFor` cycles locations across every stop in emission order, so
    // one entry per stop puts each day's two stops in that day's city.
    locations: legOfDay.flatMap((leg): Location[] =>
      Array.from({ length: stopsPerDay }, (_, i) => ({
        name: `${leg.city} ${i === 0 ? "morning" : "afternoon"} visit`,
        city: leg.city,
        lat: leg.lat,
        lng: leg.lng,
        countryCode: "JP",
      })),
    ),
    title: (dayIndex, i) => `${legOfDay[dayIndex]!.city} ${i === 0 ? "morning" : "afternoon"}, day ${dayIndex + 1}`,
  });
}
