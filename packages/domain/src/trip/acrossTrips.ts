import { ActivityTagCategory, stopTotal, travellerIds, type ActivityView, type TripDetail } from "@tc/contracts";
import { COUNTRIES, type Country, type CountryRegion } from "./countryList";

// **The account assistant's aggregates** (M45 D1–D3): what a person has spent,
// where they have been and where they might go next, across every trip they
// travelled on. Computed here rather than by a model reading trip dumps, for
// the reason `freeTime.ts` exists: arithmetic over many trips is the work a
// model gets wrong and a function gets right.
//
// Four rules, shared by every function below:
//
//   1. **Only trips the person is TRAVELLING on count** (D2, ADR-065). A trip
//      they help plan but are not going on is not one they took, so its meals,
//      cities and countries are not theirs. "Travelling" is `travellerIds`,
//      the one reading of the flag, over members the caller has already
//      overlaid with who is travelling (they are access data, not the log's).
//   2. **Only stops on a day count.** The backlog holds ideas nobody went to;
//      counting them would put a city on the map for a dinner that was never
//      eaten.
//   3. **Places come from what the geocoder wrote** (D3): `location.city` and
//      `location.countryCode`, and both ends of a transit leg, as `cities.ts`
//      reads them. A stop with neither is counted as unknown and never guessed
//      from its name.
//   4. **Money is never summed across currencies.** A trip has one currency but
//      a person's trips need not; yen and euros in one total is a wrong number.

/** The trips `userId` is travelling on, in the order given. */
export function travelledTrips(trips: readonly TripDetail[], userId: string): TripDetail[] {
  return trips.filter((trip) => trip.status === "active" && travellerIds(trip.members).includes(userId));
}

/** A spend category: the first of a stop's category tags in contract order (ADR-070), or `untagged`. */
export type SpendCategory = ActivityTagCategory | "untagged";

export interface CategorySpend {
  category: SpendCategory;
  currency: string;
  /** What the costed stops in this category came to, every traveller included. */
  totalMinor: number;
  /** How many costed stops it is made of. */
  stops: number;
  /** The stop with the highest price per person, the answer to "my most expensive meal". */
  mostExpensive: { title: string; tripName: string; perPersonMinor: number; totalMinor: number };
}

/**
 * Spend by category, one row per category and currency, by currency and then
 * largest first. A stop with several tags is counted once, under its first
 * category in contract order — the rule the notebook's spend charts use, so
 * the assistant and the pie cannot file one dinner under two tags. Ticketed
 * is a modifier, never a category. A stop with no cost is not spend.
 */
export function spendByCategory(
  trips: readonly TripDetail[],
  userId: string,
  options: { category?: SpendCategory } = {},
): { tripsCounted: number; categories: CategorySpend[] } {
  const counted = travelledTrips(trips, userId);
  const rows = new Map<string, CategorySpend>();
  for (const trip of counted) {
    const travellers = travellerIds(trip.members).length;
    for (const stop of scheduledStops(trip)) {
      if (stop.cost === null) continue;
      const category = categoryOf(stop);
      if (options.category !== undefined && category !== options.category) continue;
      const totalMinor = stopTotal(stop, travellers);
      const key = `${stop.cost.currency}|${category}`;
      const row = rows.get(key);
      const candidate = { title: stop.title, tripName: trip.name, perPersonMinor: stop.cost.amountMinor, totalMinor };
      if (row === undefined) {
        rows.set(key, { category, currency: stop.cost.currency, totalMinor, stops: 1, mostExpensive: candidate });
        continue;
      }
      row.totalMinor += totalMinor;
      row.stops += 1;
      // Strictly greater, so a tie keeps the first one met, in trip order.
      if (candidate.perPersonMinor > row.mostExpensive.perPersonMinor) row.mostExpensive = candidate;
    }
  }
  const categories = [...rows.values()].sort(
    (a, b) => (a.currency < b.currency ? -1 : a.currency > b.currency ? 1 : b.totalMinor - a.totalMinor),
  );
  return { tripsCounted: counted.length, categories };
}

/** Where the travelled trips went: every country and city, and how many stops could not be placed. */
export function placesVisited(
  trips: readonly TripDetail[],
  userId: string,
): {
  tripsCounted: number;
  countries: { code: string; name: string | null }[];
  cities: { city: string; countryCode: string | null }[];
  unknownStops: number;
} {
  const visits = visitsOf(travelledTrips(trips, userId));
  const countries = new Set<string>();
  const cities = new Map<string, string | null>();
  for (const visit of visits.placed) {
    for (const code of visit.countries) countries.add(code);
    for (const [city, code] of visit.cities) if (cities.get(city) == null) cities.set(city, code);
  }
  return {
    tripsCounted: visits.tripsCounted,
    countries: [...countries].sort().map((code) => ({ code, name: COUNTRY_BY_CODE.get(code)?.name ?? null })),
    cities: [...cities.keys()].sort().map((city) => ({ city, countryCode: cities.get(city) ?? null })),
    unknownStops: visits.unknownStops,
  };
}

export interface VisitCount {
  /** A city's name, or a country's ISO code. */
  place: string;
  /** Travelled trips with a stop there. */
  trips: number;
  /** Days, across those trips, with a stop there. */
  days: number;
  stops: number;
}

/**
 * How often each city or country was visited, most first: by trips, then days,
 * then stops, then name. "Which city have I been to most" is `places[0]`, and a
 * tie on all three is listed as a tie rather than broken by anything that
 * would sound like a reason.
 */
export function visitCounts(
  trips: readonly TripDetail[],
  userId: string,
  by: "city" | "country",
): { tripsCounted: number; by: "city" | "country"; places: VisitCount[]; unknownStops: number } {
  const visits = visitsOf(travelledTrips(trips, userId));
  const tally = new Map<string, { trips: Set<string>; days: Set<string>; stops: number }>();
  for (const visit of visits.placed) {
    const places = by === "city" ? [...visit.cities.keys()] : [...visit.countries];
    for (const place of places) {
      const entry = tally.get(place) ?? { trips: new Set<string>(), days: new Set<string>(), stops: 0 };
      entry.trips.add(visit.tripId);
      entry.days.add(`${visit.tripId}|${visit.dayIndex}`);
      entry.stops += 1;
      tally.set(place, entry);
    }
  }
  const places = [...tally.entries()]
    .map(([place, entry]) => ({ place, trips: entry.trips.size, days: entry.days.size, stops: entry.stops }))
    .sort((a, b) => b.trips - a.trips || b.days - a.days || b.stops - a.stops || (a.place < b.place ? -1 : 1));
  return { tripsCounted: visits.tripsCounted, by, places, unknownStops: visits.unknownStops };
}

/**
 * Every country not yet visited, grouped by region — the regions already
 * visited first (most visited countries first, then the list's own order), so
 * "somewhere near where I have been" is the top of the list. The choice is the
 * model's to make with the person; this only says what is left (D3).
 */
export function suggestNextCountry(
  trips: readonly TripDetail[],
  userId: string,
  options: { region?: CountryRegion } = {},
): { tripsCounted: number; visited: Country[]; unvisited: { region: CountryRegion; countries: string[] }[] } {
  const { tripsCounted, countries } = placesVisited(trips, userId);
  const visitedCodes = new Set(countries.map((country) => country.code));
  // By code, the order `placesVisited` lists them in.
  const visited = COUNTRIES.filter((country) => visitedCodes.has(country.code)).sort((a, b) => (a.code < b.code ? -1 : 1));
  const regions = [...new Set(COUNTRIES.map((country) => country.region))];
  const visitedIn = (region: CountryRegion) => visited.filter((country) => country.region === region).length;
  const unvisited = regions
    .filter((region) => options.region === undefined || region === options.region)
    .map((region, order) => ({ region, order, seen: visitedIn(region) }))
    .sort((a, b) => b.seen - a.seen || a.order - b.order)
    .map(({ region }) => ({
      region,
      countries: COUNTRIES.filter((country) => country.region === region && !visitedCodes.has(country.code)).map(
        (country) => country.name,
      ),
    }))
    .filter((group) => group.countries.length > 0);
  return { tripsCounted, visited, unvisited };
}

const COUNTRY_BY_CODE = new Map(COUNTRIES.map((country) => [country.code, country]));

/** Rule 2: a trip's stops on its days, with the day each is on. Backlog excluded. */
function scheduledStops(trip: TripDetail): (ActivityView & { dayIndex: number })[] {
  return trip.days.flatMap((day, dayIndex) =>
    day.activityIds.flatMap((id) => {
      const stop = trip.activities[id];
      return stop === undefined ? [] : [{ ...stop, dayIndex }];
    }),
  );
}

function categoryOf(stop: ActivityView): SpendCategory {
  return ActivityTagCategory.options.find((tag) => stop.tags.includes(tag)) ?? "untagged";
}

interface StopVisit {
  tripId: string;
  dayIndex: number;
  /** City name → the country code met with it first, when there was one. */
  cities: Map<string, string | null>;
  countries: Set<string>;
}

/** Rule 3 over every scheduled stop: each placed stop's cities and countries, and a count of the rest. */
function visitsOf(trips: readonly TripDetail[]): { tripsCounted: number; placed: StopVisit[]; unknownStops: number } {
  const placed: StopVisit[] = [];
  let unknownStops = 0;
  for (const trip of trips) {
    for (const stop of scheduledStops(trip)) {
      // Origin then destination, and the destination only on a leg — the
      // contract's refinement guards commands, not stored documents.
      const ends = stop.kind === "transit" ? [stop.location, stop.endLocation] : [stop.location];
      const visit: StopVisit = { tripId: trip.tripId, dayIndex: stop.dayIndex, cities: new Map(), countries: new Set() };
      for (const end of ends) {
        if (end === null) continue;
        const code = end.countryCode?.trim().toUpperCase();
        const country = code !== undefined && /^[A-Z]{2}$/.test(code) ? code : null;
        const city = end.city?.trim() || null;
        if (country !== null) visit.countries.add(country);
        if (city !== null && visit.cities.get(city) == null) visit.cities.set(city, country);
      }
      if (visit.cities.size === 0 && visit.countries.size === 0) unknownStops += 1;
      else placed.push(visit);
    }
  }
  return { tripsCounted: trips.length, placed, unknownStops };
}
