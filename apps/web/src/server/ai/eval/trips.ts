// **The trips a live-set prompt can run against** (M33). Every prompt ran on
// the seeded Japan trip until a prompt needed a trip that trip cannot be: 14
// days is under `read_trip`'s overview line (`OVERVIEW_ABOVE_DAYS`), so it can
// say nothing about how the assistant handles a long one. A prompt names its
// trip with `"trip"` in `live-set.json`; one that names none runs on Japan, as
// every prompt before this did, so no earlier prompt's run changed.
import { randomUUID } from "node:crypto";
import type { ActivityTag, Location, TripCommand } from "@tc/contracts";
import { commandsFor } from "@tc/factories";
import { JAPAN_STOPS, JAPAN_TRIP_DAY_COUNT, addDays } from "@tc/fixtures";
import { clockIn, type TripPhase } from "@tc/pages";

/**
 * The trips a live-set prompt may name, beyond the default Japan trip.
 * `today` is that trip dated so the run's pinned instant (`evalInstant`) falls
 * inside one of its days (M52), so a day-of prompt runs on a trip under way and
 * is offered what only such a trip is.
 */
export const EVAL_TRIPS = ["long-100", "today"] as const;
export type EvalTripName = (typeof EVAL_TRIPS)[number];

/**
 * The instant a live-set run's server sees as now: 12:30 in Tokyo on the
 * run's own date there, whatever the hour it was started. Day 2 of the Japan
 * trip has lunch under way then and a stop to come at 14:00, which every
 * day-of case needs; reading the real clock left those cases out for nine and
 * a half hours a day (M52 part 12). Only the hour is pinned: the date stays
 * the run's, so model rates and the other trips' phases are what they are on
 * the day it runs.
 */
export function evalInstant(realNow: number): number {
  return Date.parse(`${clockIn("Asia/Tokyo", realNow).date}T12:30:00+09:00`);
}

/**
 * How far after the run a planning trip starts: half a year, so it is in
 * planning (more than `SOON_DAYS` out) on whatever day the run happens.
 */
export const PLANNING_LEAD_DAYS = 180;

/**
 * The start date of every eval trip a case needs in planning — the Japan trip
 * of every prompt not on `today`, `long-100`, the account trips: months after
 * the run's own date in Tokyo. These were a fixed 2027-04-01, which made them
 * "soon" from 2027-03-29 and under way from 2027-04-01, and the cases written
 * for a trip months out would have run on one under way (KI-2026-10-24-n).
 */
export function planningStart(at: number): string {
  return addDays(clockIn("Asia/Tokyo", at).date, PLANNING_LEAD_DAYS);
}

/**
 * The phase a prompt's trip must be in as its turn starts: under way for
 * `today`, planning for every other. The runner refuses a seeded trip in any
 * other, so a date that drifts fails the run loudly instead of quietly
 * grading a case on a trip it was not written for.
 */
export function phaseFor(trip: EvalTripName | undefined): TripPhase {
  return trip === "today" ? "underway" : "planning";
}

/**
 * The start date that makes `today` under way at `at`, on the first Japan day
 * with a stop already begun and one still to come at that hour in Tokyo, where
 * every stop is. The day-of cases need both, so a trip simply started today
 * failed them for the hour of the run: nothing has begun on day 1 before
 * 14:30, and nothing is left after 21:00 (PR 534 review, finding 4).
 *
 * Throws when no day has both, from 21:00 to 06:30 JST, which `evalInstant`
 * never is.
 */
export function japanTodayStart(at: number): string {
  const { date, time } = clockIn("Asia/Tokyo", at);
  for (let day = 1; day <= JAPAN_TRIP_DAY_COUNT; day++) {
    const starts = JAPAN_STOPS.filter((stop) => stop.day === day).map((stop) => stop.start);
    if (starts.some((start) => start <= time) && starts.some((start) => start > time)) return addDays(date, 1 - day);
  }
  throw new Error(`No Japan day has a stop begun and one to come at ${time} JST, so the day-of cases cannot run then.`);
}

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
export function longTripCommands(tripId: string, startDate: string): TripCommand[] {
  const legOfDay = LEGS.flatMap((leg) => Array.from({ length: leg.days }, () => leg));
  const stopsPerDay = 2;
  return commandsFor("threeDayTrip", tripId, {
    dayCount: legOfDay.length,
    activitiesPerDay: stopsPerDay,
    startDate,
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

// **The account assistant's trips** (M45): several trips one person has, for
// the four questions asked across them. One of them they are NOT travelling on
// (ADR-065), and it is built to change every answer if it were counted — the
// priciest meal, a third country, and the city with the most days. Every price
// is in USD, the trips' default currency, so "most expensive" is one ranking.

interface AccountStop {
  title: string;
  city: string;
  countryCode: string;
  lat: number;
  lng: number;
  tags?: ActivityTag[];
  /** Per person, in cents. */
  cost?: number;
}

/** One trip of the account fixture: its days' stops, and whether the asker is going. */
export interface AccountEvalTrip {
  name: string;
  travelling: boolean;
  days: readonly (readonly AccountStop[])[];
}

const KYOTO = { city: "Kyoto", countryCode: "JP", lat: 35.0116, lng: 135.7681 };
const NARA = { city: "Nara", countryCode: "JP", lat: 34.6851, lng: 135.8048 };
const LISBON = { city: "Lisbon", countryCode: "PT", lat: 38.7223, lng: -9.1393 };
const SINTRA = { city: "Sintra", countryCode: "PT", lat: 38.8029, lng: -9.3817 };
const PORTO = { city: "Porto", countryCode: "PT", lat: 41.1579, lng: -8.6291 };
const BARCELONA = { city: "Barcelona", countryCode: "ES", lat: 41.3874, lng: 2.1686 };

export const ACCOUNT_TRIPS: readonly AccountEvalTrip[] = [
  {
    name: "Kyoto in spring",
    travelling: true,
    days: [
      [
        { title: "Fushimi Inari", ...KYOTO, tags: ["sight"] },
        { title: "Kaiseki dinner", ...KYOTO, tags: ["meal"], cost: 18_000 },
      ],
      [{ title: "Nishiki market lunch", ...KYOTO, tags: ["meal"], cost: 2_500 }],
      [
        { title: "Philosopher's Path", ...KYOTO, tags: ["outdoors"] },
        { title: "Nara deer park", ...NARA, tags: ["outdoors"] },
      ],
    ],
  },
  {
    name: "Lisbon long weekend",
    travelling: true,
    days: [
      [{ title: "Pasteis de nata", ...LISBON, tags: ["meal"], cost: 400 }],
      [{ title: "Pena Palace", ...SINTRA, tags: ["sight"], cost: 1_500 }],
      [{ title: "Seafood dinner", ...LISBON, tags: ["meal"], cost: 6_500 }],
    ],
  },
  {
    name: "Porto weekend",
    travelling: true,
    days: [[{ title: "Port tasting", ...PORTO, tags: ["drinks"], cost: 2_000 }]],
  },
  {
    // Theirs to open — they planned it — but they are not going.
    name: "Barcelona for Sam",
    travelling: false,
    days: [
      [{ title: "Tasting menu at Disfrutar", ...BARCELONA, tags: ["meal"], cost: 30_000 }],
      [{ title: "Sagrada Familia", ...BARCELONA, tags: ["sight"], cost: 3_300 }],
      [{ title: "Park Guell", ...BARCELONA, tags: ["outdoors"] }],
      [{ title: "La Boqueria", ...BARCELONA, tags: ["shopping"] }],
    ],
  },
];

/** One account trip as the commands that build it after `CreateTrip`: days from `startDate`, then their stops. */
export function accountTripCommands(tripId: string, trip: AccountEvalTrip, startDate: string): TripCommand[] {
  const dayIds = trip.days.map(() => randomUUID());
  return [
    {
      type: "SetTripDates",
      tripId,
      startDate,
      endDate: addDays(startDate, trip.days.length - 1),
      newDayIds: dayIds,
    },
    ...trip.days.flatMap((stops, day) =>
      stops.map(
        (stop): TripCommand => ({
          type: "AddActivity",
          tripId,
          activityId: randomUUID(),
          dayId: dayIds[day]!,
          title: stop.title,
          location: { name: stop.title, city: stop.city, countryCode: stop.countryCode, lat: stop.lat, lng: stop.lng },
          ...(stop.tags === undefined ? {} : { tags: stop.tags }),
          ...(stop.cost === undefined ? {} : { cost: { amountMinor: stop.cost, currency: "USD" } }),
        }),
      ),
    ),
  ];
}

