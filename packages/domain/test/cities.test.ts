import { describe, expect, it } from "vitest";
import type { TripDetail } from "@tc/contracts";
import { citiesOfDay } from "../src";

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
