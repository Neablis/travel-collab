// A dated trip with zoned days, for the widgets that read the trip against the
// clock (`trip.now`, `stop.directions`, `trip.flights`): `now.test.ts`'s shape,
// with full globals so a context can carry them.
import type { ActivityView, TripDetail, TripGlobals, TripGlobalsDay } from "@tc/contracts";
import { activityFactory, tripDetailFixture, uuidFrom } from "@tc/factories";
import { noonIn } from "../clock";
import type { WidgetContext } from "../registry-types";

export const MINUTE = 60_000;

export type DaySpec = { date: string | null; zone: string | null; city?: string; stops: Partial<ActivityView>[] };

/** Stop `s` of day `d`, both counted from 0, as `dayTrip` ids it. */
export const stopId = (d: number, s: number) => uuidFrom(d + 1, s + 1);

/** A trip of `days`, dated and zoned as given, with globals whose days carry each zone and city. */
export function dayTrip(days: DaySpec[]): { trip: TripDetail; globals: TripGlobals } {
  const activities: Record<string, ActivityView> = {};
  const tripDays = days.map((day, d) => {
    const activityIds = day.stops.map((stop, s) => {
      const activityId = stopId(d, s);
      activities[activityId] = activityFactory.build({ location: null, timeWindow: null, kind: "planned", mode: null, ...stop, activityId });
      return activityId;
    });
    return { dayId: uuidFrom(d + 1), activityIds, date: day.date, costSubtotal: 0 };
  });
  const globalsDays = days.map(
    (day, index): TripGlobalsDay => ({
      index,
      date: day.date,
      cities: day.city === undefined ? [] : [day.city],
      activityCount: day.stops.length,
      costSubtotal: 0,
      place: day.zone === null ? null : { lat: 0, lng: 0, city: day.city ?? null },
      timeZone: day.zone,
    }),
  );
  return {
    trip: tripDetailFixture({ startDate: days[0]?.date ?? null, days: tripDays, activities, backlog: [] }),
    globals: { days: globalsDays, cities: [], tags: [], description: null, homeTimeZone: null },
  };
}

/** The instant a wall clock in `zone` reads `time` on `date` (June: no zone used changes clocks). */
export function wallAt(zone: string, date: string, time: string): number {
  const [h, m] = time.split(":").map(Number);
  return noonIn(zone, date) + ((h! - 12) * 60 + m!) * MINUTE;
}

/** A context for `trip` read at `at` on a device in `deviceZone`; `at: null` is a context with no reader's clock. */
export function clockContext(
  { trip, globals }: { trip: TripDetail; globals: TripGlobals },
  at: number | null,
  deviceZone = "Europe/Lisbon",
): WidgetContext {
  return {
    trip, globals, page: { tripId: trip.tripId }, today: null,
    user: { displayName: null, homeAirport: null, distanceUnit: "km", timeFormat: "24h", avatar: null, color: null, publicDisplayName: false },
    now: at === null ? null : { at, deviceZone },
  };
}
