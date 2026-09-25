import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type { SavedStop, TripDetail } from "@tc/contracts";
import { citiesOfDay, citiesOfStops, countriesOfStops, stopsInTimeOrder } from "../src";
import { witness } from "./support/witness";

const TRIP = "1c2d3e4f-0000-4000-8000-000000000002";
const MEMBER = { userId: "u1", role: "owner" as const };

// Minimal ActivityView; only timeWindow and location vary per test. `location`
// takes `{ city? }` rather than a bare string so "has a location but no city"
// (KI-35's shape — `Location.city` is optional in the contract) is
// constructible without fighting the type of a spread `activity()` result.
function activity(
  id: string,
  timeWindow: { start: string; end: string } | null,
  location: { city?: string } | null = null,
) {
  return {
    activityId: id,
    title: id,
    timeWindow,
    location: location === null ? null : { name: id, city: location.city, countryCode: null },
    notes: null,
    anchors: [],
    kind: "planned" as const,
    tags: [],
    cost: null,
    bookedBy: null,
    participants: [],
  };
}

function day(dayId: string, activityIds: string[]) {
  return { dayId, activityIds, date: null, costSubtotal: 0 };
}

function detail(
  days: ReturnType<typeof day>[],
  activities: Record<string, ReturnType<typeof activity>>,
): TripDetail {
  return {
    tripId: TRIP,
    name: "Test Trip",
    status: "active",
    startDate: null,
    currency: "USD",
    budget: null,
    members: [MEMBER],
    forkedFrom: null,
    days,
    backlog: [],
    activities,
    conflicts: [],
    dismissedConflictIds: [],
    createdAt: "2026-08-29T00:00:00.000Z",
    unscheduledCostSubtotal: 0,
    tripCostTotal: 0,
    budgetRemaining: null,
  } as unknown as TripDetail;
}

describe("citiesOfDay", () => {
  it("reports no cities for a day with no located stop", () => {
    const d = detail([day("d1", ["a1"])], { a1: activity("a1", null) });
    expect(citiesOfDay(d, 0)).toEqual([]);
  });

  it("reports no cities, not an error, for a day index past the end", () => {
    const d = detail([day("d1", [])], {});
    expect(citiesOfDay(d, 5)).toEqual([]);
  });

  it("orders a travel day's cities by TIME, not stored order", () => {
    // Stored in Tokyo-then-Osaka order; scheduled the other way around.
    const d = detail([day("d1", ["tokyo", "osaka"])], {
      tokyo: activity("tokyo", { start: "18:00", end: "19:00" }, { city: "Tokyo" }),
      osaka: activity("osaka", { start: "09:00", end: "10:00" }, { city: "Osaka" }),
    });
    expect(citiesOfDay(d, 0)).toEqual(["Osaka", "Tokyo"]);
  });

  it("puts untimed stops' cities after every timed one, in stored order", () => {
    const d = detail([day("d1", ["untimed", "evening", "morning"])], {
      untimed: activity("untimed", null, { city: "Nara" }),
      evening: activity("evening", { start: "18:00", end: "19:00" }, { city: "Tokyo" }),
      morning: activity("morning", { start: "09:00", end: "10:00" }, { city: "Osaka" }),
    });
    expect(citiesOfDay(d, 0)).toEqual(["Osaka", "Tokyo", "Nara"]);
  });

  it("collapses a day trip's start-and-end city to one entry", () => {
    const d = detail([day("d1", ["morning", "excursion", "evening"])], {
      morning: activity("morning", { start: "08:00", end: "09:00" }, { city: "Kyoto" }),
      excursion: activity("excursion", { start: "10:00", end: "16:00" }, { city: "Nara" }),
      evening: activity("evening", { start: "18:00", end: "20:00" }, { city: "Kyoto" }),
    });
    expect(citiesOfDay(d, 0)).toEqual(["Kyoto", "Nara"]);
  });

  it("ignores a stop whose location carries no city (KI-35 shape)", () => {
    const d = detail([day("d1", ["a1", "a2"])], {
      a1: activity("a1", { start: "09:00", end: "10:00" }, {}),
      a2: activity("a2", { start: "11:00", end: "12:00" }, { city: "Kyoto" }),
    });
    expect(citiesOfDay(d, 0)).toEqual(["Kyoto"]);
  });
});

// The same rule, over the stops of a SAVED day (M11b link 1). A saved day is a
// `SavedStop[]` with no ids and no day, so there is nothing to look up — the
// list is the input.
function savedStop(
  title: string,
  timeWindow: { start: string; end: string } | null,
  location: { city?: string } | null = null,
  dayIndex = 0,
): SavedStop {
  return {
    title,
    timeWindow,
    location: location === null ? null : { name: title, city: location.city },
    notes: null,
    anchors: [],
    kind: "planned",
    tags: [],
    cost: null,
    dayIndex,
    mode: null,
    endLocation: null,
  };
}

describe("citiesOfStops", () => {
  it("reports no cities for a day where nothing is located", () => {
    expect(citiesOfStops([savedStop("a", { start: "09:00", end: "10:00" })])).toEqual([]);
  });

  it("reports no cities for no stops at all", () => {
    expect(citiesOfStops([])).toEqual([]);
  });

  // The common case, and the one a length would get wrong if duplicates were
  // not collapsed: a normal day in one city is ONE city, not five.
  it("reports one city when every stop is in the same city", () => {
    const stops = ["09:00", "12:00", "15:00", "19:00"].map((start, i) =>
      savedStop(`s${i}`, { start, end: start }, { city: "Kyoto" }),
    );
    expect(citiesOfStops(stops)).toEqual(["Kyoto"]);
  });

  // Non-adjacent, deliberately: collapsing only neighbours would pass a
  // there-and-back day and fail this one. Kyoto's FIRST occurrence is what
  // fixes its position, so it leads even though its later stop is last.
  it("collapses a repeat that is not adjacent, keeping the first occurrence's place", () => {
    const stops = [
      savedStop("morning", { start: "08:00", end: "09:00" }, { city: "Kyoto" }),
      savedStop("excursion", { start: "11:00", end: "16:00" }, { city: "Nara" }),
      savedStop("evening", { start: "19:00", end: "21:00" }, { city: "Kyoto" }),
    ];
    expect(citiesOfStops(stops)).toEqual(["Kyoto", "Nara"]);
  });

  // KI-35's shape: `Location.city` is `.optional()`, so a manually-entered
  // place or a geocoder result with no city-level component has a location and
  // no city. Never the name/area fallback — that would answer "which city"
  // with something that might not be one.
  it("ignores a stop that has a location but no city", () => {
    const stops = [
      savedStop("unplaced", { start: "09:00", end: "10:00" }, {}),
      savedStop("placed", { start: "11:00", end: "12:00" }, { city: "Osaka" }),
    ];
    expect(citiesOfStops(stops)).toEqual(["Osaka"]);
  });

  it("orders by TIME, not by position in the list", () => {
    const stops = [
      savedStop("late", { start: "18:00", end: "19:00" }, { city: "Tokyo" }),
      savedStop("early", { start: "09:00", end: "10:00" }, { city: "Osaka" }),
    ];
    expect(citiesOfStops(stops)).toEqual(["Osaka", "Tokyo"]);
  });

  it("puts untimed stops' cities after every timed one, in list order", () => {
    const stops = [
      savedStop("untimed", null, { city: "Nara" }),
      savedStop("evening", { start: "18:00", end: "19:00" }, { city: "Tokyo" }),
      savedStop("morning", { start: "09:00", end: "10:00" }, { city: "Osaka" }),
    ];
    expect(citiesOfStops(stops)).toEqual(["Osaka", "Tokyo", "Nara"]);
  });
});

// The claim the shared core exists to make true, asserted rather than trusted.
// A saved day's stored `cities` and the trip readout's are read side by side in
// M11b — a profile counts from the former while Discover matches on it — so a
// second implementation that agreed today would be free to drift tomorrow.
// This is the test that would fail the day someone reintroduces one.
describe("citiesOfDay and citiesOfStops are the same rule", () => {
  it("agree on a day whose every awkward case is present at once", () => {
    const cases: [string, { start: string; end: string } | null, { city?: string } | null][] = [
      ["untimed-nara", null, { city: "Nara" }],
      ["evening-kyoto", { start: "19:00", end: "21:00" }, { city: "Kyoto" }],
      ["located-no-city", { start: "10:00", end: "11:00" }, {}],
      ["unlocated", { start: "12:00", end: "13:00" }, null],
      ["morning-kyoto", { start: "08:00", end: "09:00" }, { city: "Kyoto" }],
      ["midday-osaka", { start: "13:00", end: "14:00" }, { city: "Osaka" }],
    ];

    const activities = Object.fromEntries(
      cases.map(([id, tw, loc]) => [id, activity(id, tw, loc)]),
    );
    const d = detail([day("d1", cases.map(([id]) => id))], activities);

    const fromTrip = citiesOfDay(d, 0);
    const fromSaved = citiesOfStops(cases.map(([id, tw, loc]) => savedStop(id, tw, loc)));

    // The witness: an agreement between two empty lists proves nothing, so the
    // shape is pinned before the equality is asserted.
    expect(fromTrip).toEqual(["Kyoto", "Osaka", "Nara"]);
    expect(fromSaved).toEqual(fromTrip);
  });
});

// The walk alone, which the weather's "first stop in each city" shares with
// `citiesOfDay` rather than copying it (M14 PART 3 review, finding 6).
describe("stopsInTimeOrder", () => {
  it("puts timed stops by start, then untimed ones in stored order — ties keep stored order", () => {
    const stops = [
      activity("untimed-a", null),
      activity("late", { start: "19:00", end: "20:00" }),
      activity("early-1", { start: "08:00", end: "09:00" }),
      activity("untimed-b", null),
      activity("early-2", { start: "08:00", end: "08:30" }),
    ];
    expect(stopsInTimeOrder(stops).map((s) => s.activityId)).toEqual(["early-1", "early-2", "late", "untimed-a", "untimed-b"]);
  });

  it("is the order citiesOfStops reads cities in", () => {
    const stops = [
      activity("untimed-nara", null, { city: "Nara" }),
      activity("evening-kyoto", { start: "19:00", end: "21:00" }, { city: "Kyoto" }),
      activity("midday-osaka", { start: "13:00", end: "14:00" }, { city: "Osaka" }),
    ];
    const cities = stopsInTimeOrder(stops).map((s) => s.location!.city);
    expect(cities).toEqual(["Osaka", "Kyoto", "Nara"]);
    expect(citiesOfStops(stops)).toEqual(cities);
  });
});

// M12 link 7. `countryCode` is typed `string` here rather than the contract's
// `^[A-Z]{2}$` because the backfill hands this rule stored jsonb that no parse
// has run over — the malformed spellings are inputs it really meets.
function countryStop(
  title: string,
  timeWindow: { start: string; end: string } | null,
  countryCode: string | undefined,
  city?: string,
): SavedStop {
  return {
    ...savedStop(title, timeWindow),
    location: { name: title, city, countryCode } as SavedStop["location"],
  };
}

describe("countriesOfStops", () => {
  // The exit gate's "counted once per day however many of that country's
  // cities the day visits" starts here: a Mexico City → Puebla day is ONE
  // country, so `unnest(countries)` has nothing to count twice.
  it("reports one country for a day across several of its cities", () => {
    const stops = [
      countryStop("zocalo", { start: "09:00", end: "10:00" }, "MX", "Mexico City"),
      countryStop("cathedral", { start: "14:00", end: "15:00" }, "MX", "Puebla"),
      countryStop("dinner", { start: "19:00", end: "21:00" }, "MX", "Mexico City"),
    ];
    expect(countriesOfStops(stops)).toEqual(["MX"]);
  });

  it("orders by time and collapses repeats to the first occurrence, as cities do", () => {
    const stops = [
      countryStop("untimed", null, "FR"),
      countryStop("evening", { start: "18:00", end: "19:00" }, "MC"),
      countryStop("morning", { start: "09:00", end: "10:00" }, "FR"),
    ];
    expect(countriesOfStops(stops)).toEqual(["FR", "MC"]);
  });

  it("normalises case and whitespace, so one country is never two", () => {
    const stops = [
      countryStop("a", { start: "09:00", end: "10:00" }, "jp"),
      countryStop("b", { start: "11:00", end: "12:00" }, " Jp "),
      countryStop("c", { start: "13:00", end: "14:00" }, "JP"),
    ];
    expect(countriesOfStops(stops)).toEqual(["JP"]);
    expect(countriesOfStops(stops.slice(0, 2))).toEqual(["JP"]);
  });

  it("drops a code that is not two letters rather than storing it", () => {
    const stops = ["USA", "", "1A", "J"].map((code, i) =>
      countryStop(`s${i}`, { start: "09:00", end: "10:00" }, code),
    );
    expect(countriesOfStops(stops)).toEqual([]);
  });

  // Never inferred: a city with no code is a country nobody knows, and the
  // library carried 1,375 of those on 2026-09-09. Guessing would file days
  // under countries they may not be in.
  it("reports no country for a stop with a city but no countryCode", () => {
    expect(countriesOfStops([countryStop("a", null, undefined, "Kyoto")])).toEqual([]);
  });

  it("is, for any stops, exactly the distinct valid codes they carry", () => {
    const w = witness("countriesOfStops set");
    const code = fc.oneof(fc.constantFrom("JP", "MX", "mx", " fr ", "MC"), fc.string({ maxLength: 4 }));
    const stop = fc.record({
      start: fc.option(fc.constantFrom("08:00", "12:00", "18:00"), { nil: null }),
      code: fc.option(code, { nil: undefined }),
    });
    fc.assert(
      fc.property(fc.array(stop, { maxLength: 8 }), (raw) => {
        const stops = raw.map((s, i) =>
          countryStop(`s${i}`, s.start === null ? null : { start: s.start, end: s.start }, s.code),
        );
        const expected = new Set(
          raw
            .map((s) => s.code?.trim().toUpperCase())
            .filter((c): c is string => c !== undefined && /^[A-Z]{2}$/.test(c)),
        );
        const got = countriesOfStops(stops);
        expect(new Set(got)).toEqual(expected);
        expect(got.length).toBe(expected.size);
        w.tick();
      }),
      { numRuns: 200 },
    );
    // No guard clause, so every run asserts: the floor is `numRuns` exactly.
    w.atLeast(200);
  });
});

// M24 knock-on 2 (Mitchell, 2026-09-25): a transit stop touches BOTH places,
// origin then destination, at the stop's own position in time. A travel day
// is in both cities and both countries, and a saved day's `cities` is what
// Discover matches on — a shinkansen day that only listed where it left from
// would never be found by the city it arrives in.
function leg(
  title: string,
  timeWindow: { start: string; end: string } | null,
  from: { city?: string; countryCode?: string },
  to: { city?: string; countryCode?: string },
): SavedStop {
  return {
    ...savedStop(title, timeWindow),
    kind: "transit",
    mode: "train",
    location: { name: title, ...from },
    endLocation: { name: `${title} (arrival)`, ...to },
  };
}

describe("a transit stop contributes both ends (M24)", () => {
  it("names the destination city of a leg nothing else on the day is in", () => {
    expect(
      citiesOfStops([leg("shinkansen", { start: "09:30", end: "11:45" }, { city: "Osaka" }, { city: "Tokyo" })]),
    ).toEqual(["Osaka", "Tokyo"]);
  });

  // The destination takes the leg's slot in time, not the end of the list: a
  // Kyoto → Osaka train at 10:00 followed by a Nara stop at 13:00 is
  // Kyoto, Osaka, Nara.
  it("puts the destination straight after the origin, in the leg's place in time", () => {
    expect(
      citiesOfStops([
        savedStop("nara", { start: "13:00", end: "15:00" }, { city: "Nara" }),
        leg("train", { start: "10:00", end: "10:40" }, { city: "Kyoto" }, { city: "Osaka" }),
      ]),
    ).toEqual(["Kyoto", "Osaka", "Nara"]);
  });

  it("drops a destination with no city, as it drops an origin with none", () => {
    expect(citiesOfStops([leg("ferry", null, { city: "Tamano" }, {})])).toEqual(["Tamano"]);
  });

  // Same shared helper, same rule: a flight is in two countries.
  it("gives countriesOfStops both of a leg's countries", () => {
    expect(
      countriesOfStops([
        leg("flight", { start: "10:00", end: "22:00" }, { city: "Paris", countryCode: "FR" }, { city: "Tokyo", countryCode: "JP" }),
      ]),
    ).toEqual(["FR", "JP"]);
  });

  // "Checked, not trusted": the kind refinement guards commands and the
  // decider, not stored events or read models, so a non-transit stop carrying
  // an `endLocation` can still reach here. The map ignores its destination
  // (`mapRailData.ts`); a saved day's `cities` — what Discover matches on —
  // must ignore it too, or the two disagree about where the day went.
  it("ignores the endLocation of a stop that is not transit, in cities and countries alike", () => {
    const contradiction: SavedStop = {
      ...leg("dinner", { start: "19:00", end: "21:00" }, { city: "Kyoto", countryCode: "JP" }, { city: "Seoul", countryCode: "KR" }),
      kind: "planned",
      mode: null,
    };
    expect(citiesOfStops([contradiction])).toEqual(["Kyoto"]);
    expect(countriesOfStops([contradiction])).toEqual(["JP"]);
  });
});
