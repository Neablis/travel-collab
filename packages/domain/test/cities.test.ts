import { describe, expect, it } from "vitest";
import type { SavedStop, TripDetail } from "@tc/contracts";
import { citiesOfDay, citiesOfStops } from "../src";

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
