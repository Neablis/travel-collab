import { describe, expect, it } from "vitest";
import { TripDetail, type ActivityTag, type Location, type TripMember } from "@tc/contracts";
import { placesVisited, spendByCategory, suggestNextCountry, travelledTrips, visitCounts } from "../src";

// M45 D1–D3: the account assistant's aggregates, over a fixture of several
// trips. Every expectation below is exact, so a trip that leaks in moves it:
// Paris is a trip `ME` helps plan but is NOT travelling on (ADR-065), and it
// holds the most expensive meal, the only French stops and the most Paris
// days there are. Counting it would change every answer in this file.

const ME = "me";
const FRIEND = "friend";

let ids = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++ids).padStart(12, "0")}`;

interface StopSpec {
  title: string;
  where?: Partial<Location> | null;
  to?: Partial<Location>;
  tags?: ActivityTag[];
  /** Per person, minor units, in `currency`. */
  cost?: number;
  currency?: string;
}

const place = (city: string, countryCode: string): Partial<Location> => ({ name: city, city, countryCode });

function trip(
  name: string,
  members: TripMember[],
  days: StopSpec[][],
  backlog: StopSpec[] = [],
): TripDetail {
  const activities: Record<string, unknown> = {};
  const add = (spec: StopSpec): string => {
    const activityId = uuid();
    activities[activityId] = {
      activityId,
      title: spec.title,
      timeWindow: null,
      location: spec.where === undefined || spec.where === null ? null : { name: spec.title, ...spec.where },
      notes: null,
      anchors: [],
      kind: spec.to ? "transit" : "planned",
      tags: spec.tags ?? [],
      cost: spec.cost === undefined ? null : { amountMinor: spec.cost, currency: spec.currency ?? "USD" },
      endLocation: spec.to ? { name: spec.title, ...spec.to } : null,
    };
    return activityId;
  };
  return TripDetail.parse({
    tripId: uuid(),
    name,
    status: "active",
    startDate: null,
    currency: "USD",
    budget: null,
    members,
    days: days.map((stops) => ({ dayId: uuid(), activityIds: stops.map(add), date: null, costSubtotal: 0 })),
    backlog: backlog.map(add),
    activities,
    conflicts: [],
    dismissedConflictIds: [],
    createdAt: "2027-01-01T00:00:00.000Z",
    unscheduledCostSubtotal: 0,
    tripCostTotal: 0,
    budgetRemaining: null,
  });
}

const travelling = (userId: string, role: TripMember["role"] = "editor"): TripMember => ({ userId, role, travelling: true });

const KYOTO = trip(
  "Kyoto in spring",
  [travelling(ME, "owner"), travelling(FRIEND)],
  [
    [
      { title: "Kaiseki dinner", where: place("Kyoto", "JP"), tags: ["meal", "ticketed"], cost: 12_000 },
      { title: "Fushimi Inari", where: place("Kyoto", "JP"), tags: ["sight"] },
    ],
    [
      { title: "Ramen", where: place("Kyoto", "JP"), tags: ["meal"], cost: 1_500 },
      { title: "Nara deer park", where: place("Nara", "JP"), tags: ["outdoors"] },
    ],
  ],
  // An idea nobody went to: not a place visited and not money spent.
  [{ title: "Omakase", where: place("Tokyo", "JP"), tags: ["meal"], cost: 40_000 }],
);

const LISBON = trip(
  "Lisbon",
  // No `travelling` at all reads as travelling (travellers spec D2).
  [{ userId: ME, role: "owner" }],
  [
    [
      { title: "Pasteis de nata", where: place("Lisbon", "PT"), tags: ["meal"], cost: 500, currency: "EUR" },
      { title: "Train to Sintra", where: place("Lisbon", "PT"), to: place("Sintra", "PT"), cost: 300, currency: "EUR" },
    ],
    [
      // Typed by hand: a place with no city and no country is unknown, never guessed.
      { title: "That bar", where: { name: "the bar near the hostel" } },
      { title: "Seafood dinner", where: null, tags: ["meal"], cost: 4_000, currency: "EUR" },
    ],
  ],
);

const KYOTO_AGAIN = trip(
  "Kyoto again",
  [travelling(ME, "owner")],
  [[{ title: "Philosopher's Path", where: place("Kyoto", "JP") }]],
);

const PARIS_I_HELPED_PLAN = trip(
  "Paris for Sam",
  [travelling(FRIEND, "owner"), { userId: ME, role: "editor", travelling: false }],
  [
    [{ title: "Le Jules Verne", where: place("Paris", "FR"), tags: ["meal"], cost: 50_000 }],
    [{ title: "Louvre", where: place("Paris", "FR"), tags: ["museum"], cost: 2_200 }],
    [{ title: "Versailles", where: place("Paris", "FR"), tags: ["sight"] }],
    [{ title: "Orsay", where: place("Paris", "FR"), tags: ["museum"] }],
  ],
);

const NOT_MINE = trip("Someone else's", [travelling(FRIEND, "owner")], [[{ title: "Reykjavik", where: place("Reykjavik", "IS") }]]);

const TRIPS = [KYOTO, PARIS_I_HELPED_PLAN, LISBON, NOT_MINE, KYOTO_AGAIN];

describe("travelledTrips", () => {
  it("keeps the trips this person is travelling on, and only those", () => {
    expect(travelledTrips(TRIPS, ME).map((t) => t.name)).toEqual(["Kyoto in spring", "Lisbon", "Kyoto again"]);
  });
});

describe("spendByCategory", () => {
  it("totals each category per currency over the travelled trips' scheduled stops, with its priciest stop", () => {
    expect(spendByCategory(TRIPS, ME)).toEqual({
      tripsCounted: 3,
      categories: [
        {
          category: "meal",
          currency: "EUR",
          totalMinor: 4_500,
          stops: 2,
          mostExpensive: { title: "Seafood dinner", tripName: "Lisbon", perPersonMinor: 4_000, totalMinor: 4_000 },
        },
        {
          category: "untagged",
          currency: "EUR",
          totalMinor: 300,
          stops: 1,
          mostExpensive: { title: "Train to Sintra", tripName: "Lisbon", perPersonMinor: 300, totalMinor: 300 },
        },
        {
          // Two travellers on Kyoto, so the kaiseki is 24,000 for the trip.
          category: "meal",
          currency: "USD",
          totalMinor: 27_000,
          stops: 2,
          mostExpensive: { title: "Kaiseki dinner", tripName: "Kyoto in spring", perPersonMinor: 12_000, totalMinor: 24_000 },
        },
      ],
    });
  });

  it("narrows to one category when asked", () => {
    expect(spendByCategory(TRIPS, ME, { category: "untagged" }).categories.map((c) => c.mostExpensive.title)).toEqual([
      "Train to Sintra",
    ]);
  });
});

describe("placesVisited", () => {
  it("lists the countries and cities of the travelled trips, and counts what it cannot place", () => {
    expect(placesVisited(TRIPS, ME)).toEqual({
      tripsCounted: 3,
      countries: [
        { code: "JP", name: "Japan" },
        { code: "PT", name: "Portugal" },
      ],
      cities: [
        { city: "Kyoto", countryCode: "JP" },
        { city: "Lisbon", countryCode: "PT" },
        { city: "Nara", countryCode: "JP" },
        { city: "Sintra", countryCode: "PT" },
      ],
      unknownStops: 2,
    });
  });
});

describe("visitCounts", () => {
  it("ranks cities by trips, then days, then stops", () => {
    expect(visitCounts(TRIPS, ME, "city")).toEqual({
      tripsCounted: 3,
      by: "city",
      places: [
        { place: "Kyoto", trips: 2, days: 3, stops: 4 },
        { place: "Lisbon", trips: 1, days: 1, stops: 2 },
        { place: "Nara", trips: 1, days: 1, stops: 1 },
        { place: "Sintra", trips: 1, days: 1, stops: 1 },
      ],
      unknownStops: 2,
    });
  });

  it("ranks countries the same way, a leg counted once however many ends it has there", () => {
    expect(visitCounts(TRIPS, ME, "country").places).toEqual([
      { place: "JP", trips: 2, days: 3, stops: 5 },
      { place: "PT", trips: 1, days: 1, stops: 2 },
    ]);
  });
});

describe("suggestNextCountry", () => {
  it("offers every country not yet visited, the regions already visited first", () => {
    const suggestion = suggestNextCountry(TRIPS, ME);
    expect(suggestion.visited).toEqual([
      { code: "JP", name: "Japan", region: "East Asia" },
      { code: "PT", name: "Portugal", region: "Europe" },
    ]);
    // Europe before East Asia: one visited country each, so the list's own order decides.
    expect(suggestion.unvisited.slice(0, 2).map((group) => group.region)).toEqual(["Europe", "East Asia"]);
    const europe = suggestion.unvisited[0]!.countries;
    expect(europe).toContain("France");
    expect(europe).not.toContain("Portugal");
    expect(suggestion.unvisited.flatMap((group) => group.countries)).not.toContain("Japan");
  });

  it("narrows to one region when asked", () => {
    expect(suggestNextCountry(TRIPS, ME, { region: "East Asia" }).unvisited.map((group) => group.region)).toEqual(["East Asia"]);
  });
});
