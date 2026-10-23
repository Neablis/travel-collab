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
import { clockIn } from "@tc/pages";

/**
 * The trips a live-set prompt may name, beyond the default Japan trip.
 * `today` is that trip dated to start today (M52), so a day-of prompt runs on
 * a trip under way and is offered what only such a trip is.
 */
export const EVAL_TRIPS = ["long-100", "today"] as const;
export type EvalTripName = (typeof EVAL_TRIPS)[number];

/**
 * The start date that makes `today` under way at `at`, on the first Japan day
 * with a stop already begun and one still to come at that hour in Tokyo, where
 * every stop is. The day-of cases need both, so a trip simply started today
 * failed them for the hour of the run: nothing has begun on day 1 before
 * 14:30, and nothing is left after 21:00 (PR 534 review, finding 4).
 *
 * Null when no day has both, from 21:00 to 06:30 JST: the runner leaves the
 * day-of prompts out then (`notRunOnClock`).
 */
export function japanTodayStart(at: number): string | null {
  const { date, time } = clockIn("Asia/Tokyo", at);
  for (let day = 1; day <= JAPAN_TRIP_DAY_COUNT; day++) {
    const starts = JAPAN_STOPS.filter((stop) => stop.day === day).map((stop) => stop.start);
    if (starts.some((start) => start <= time) && starts.some((start) => start > time)) return addDays(date, 1 - day);
  }
  return null;
}

/**
 * The day-of prompts among `prompts` that cannot run at `at`, each with the
 * line the run's summary names it on. Outside the hours `japanTodayStart`
 * covers, a full run leaves them out of its turns and its report rather than
 * refusing the whole set; a run that named one with `EVAL_ONLY` refuses.
 */
export function notRunOnClock(
  prompts: readonly { id: string; trip?: EvalTripName }[],
  at: number,
): { id: string; reason: string }[] {
  if (japanTodayStart(at) !== null) return [];
  const reason = `not run: clock (${clockIn("Asia/Tokyo", at).time} JST)`;
  return prompts.filter((prompt) => prompt.trip === "today").map(({ id }) => ({ id, reason }));
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

/** One account trip as the commands that build it after `CreateTrip`: dated days, then their stops. */
export function accountTripCommands(tripId: string, trip: AccountEvalTrip): TripCommand[] {
  const dayIds = trip.days.map(() => randomUUID());
  return [
    {
      type: "SetTripDates",
      tripId,
      startDate: "2027-05-01",
      endDate: `2027-05-${String(trip.days.length).padStart(2, "0")}`,
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

