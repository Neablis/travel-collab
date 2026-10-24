// `resolveDateScope` (ADR-080 §4): a page's `dateScope` turned into the one
// scope every widget on it is handed. The trip's days have no zone, so every
// clock below runs on the device's, UTC.
import { describe, expect, it } from "vitest";
import type { DateScope } from "@tc/contracts";
import { followsDateScope, nearestTripDay, resolveDateScope, supersededParams, withoutSuperseded } from "./dateScope";
import { getMacro, inputsFor } from "./registry";
import { selectionTrip } from "./test-support/selectionTrip";

const at = (iso: string) => ({ at: Date.parse(iso), deviceZone: "UTC" });

describe("resolveDateScope", () => {
  const { trip, globals } = selectionTrip();
  const page = (dateScope?: DateScope) => ({ tripId: trip.tripId, ...(dateScope === undefined ? {} : { dateScope }) });
  const midTrip = at("2027-06-02T12:00:00Z");

  it("scopes nothing on a page left at all days, which is every page written before it", () => {
    expect(resolveDateScope(page(), trip, globals, midTrip)).toBeUndefined();
    expect(resolveDateScope(page("all"), trip, globals, midTrip)).toBeUndefined();
  });

  it("is today's day while the trip is under way", () => {
    expect(resolveDateScope(page("today"), trip, globals, at("2027-06-01T08:00:00Z"))).toEqual({ kind: "day", index: 0 });
    expect(resolveDateScope(page("today"), trip, globals, midTrip)).toEqual({ kind: "day", index: 1 });
  });

  // Mitchell, 2026-10-22: nothing is substituted for today off the trip's dates.
  it("is no day before the trip and after it, never its first or last", () => {
    expect(resolveDateScope(page("today"), trip, globals, at("2027-05-31T12:00:00Z"))).toEqual({ kind: "no-day" });
    expect(resolveDateScope(page("today"), trip, globals, at("2027-06-03T12:00:00Z"))).toEqual({ kind: "no-day" });
  });

  it("scopes nothing until the reader's clock is known, or with no trip", () => {
    expect(resolveDateScope(page("today"), trip, globals, null)).toBeUndefined();
    expect(resolveDateScope(page("today"), undefined, globals, midTrip)).toBeUndefined();
  });
});

describe("followsDateScope — which widgets the page scopes", () => {
  it("is a widget that selects days and left its day and dates unbound", () => {
    expect(followsDateScope(getMacro("day.detail"), {})).toBe(true);
    expect(followsDateScope(getMacro("cost"), { kind: "pending" })).toBe(true);
    expect(followsDateScope(getMacro("day.detail"), { day: { kind: "index", index: 0 } })).toBe(false);
    expect(followsDateScope(getMacro("day.detail"), { dates: { from: "2027-06-01", through: "2027-06-02" } })).toBe(false);
  });

  it("is never a widget with no days to narrow", () => {
    expect(followsDateScope(getMacro("trip.strip"), {})).toBe(false);
    expect(followsDateScope(getMacro("attribute"), { field: "trip.countdown" })).toBe(false);
    expect(followsDateScope(getMacro("not.a.widget"), {})).toBe(false);
  });
});

// Mitchell, 2026-10-24: off the trip's dates a Today page still has today's
// weather and light, at the place of the trip day nearest today. One rule, no
// before or after: today clamped into the trip's dates.
describe("nearestTripDay — whose place stands in for today", () => {
  const days = (...dates: (string | null)[]) => dates.map((date) => ({ date }));
  const trip = days("2027-06-01", "2027-06-02", "2027-06-03");

  it("is day 1 before the trip, today's day during it, and the last day after it", () => {
    expect(nearestTripDay(trip, "2027-05-20")).toBe(0);
    expect(nearestTripDay(trip, "2027-06-02")).toBe(1);
    expect(nearestTripDay(trip, "2027-07-04")).toBe(2);
  });

  it("is the one day of a one-day trip on either side of it", () => {
    expect(nearestTripDay(days("2027-06-01"), "2027-01-01")).toBe(0);
    expect(nearestTripDay(days("2027-06-01"), "2028-01-01")).toBe(0);
  });

  it("skips undated days, and is null for a trip with no dates", () => {
    expect(nearestTripDay(days(null, "2027-06-01", null), "2027-07-01")).toBe(1);
    expect(nearestTripDay(days(null, null), "2027-07-01")).toBeNull();
  });
});

// Mitchell, 2026-10-24: *"when we have a dynamic today lock to the notebook,
// selecting a date in the widget doesn't make sense, so remove that setting
// from widgets when that field is set."* One table of notebook settings and
// what each takes over; the settings panel and the render both read it.
describe("supersededParams — a notebook setting takes over a widget's own", () => {
  it("is the day and the dates of a widget that selects days, on a page scoped to today", () => {
    expect(supersededParams({ dateScope: "today" }, getMacro("day.weather"))).toEqual(["day", "dates"]);
    expect(supersededParams({ dateScope: "today" }, getMacro("day.sun"))).toEqual(["day", "dates"]);
  });

  it("is nothing on a page at all days, or for a widget with no days to choose", () => {
    expect(supersededParams({}, getMacro("day.weather"))).toEqual([]);
    expect(supersededParams({ dateScope: "all" }, getMacro("day.weather"))).toEqual([]);
    expect(supersededParams({ dateScope: "today" }, getMacro("trip.strip"))).toEqual([]);
  });

  it("drops the controls from the inputs a widget offers, and the stored values from its params", () => {
    const names = (page?: { dateScope?: "today" | "all" }) => inputsFor("day.weather", {}, page).map((i) => i.name);
    expect(names()).toContain("day");
    expect(names({ dateScope: "today" })).not.toContain("day");
    expect(names({ dateScope: "today" })).not.toContain("dates");
    expect(names({ dateScope: "today" })).toContain("city");
    const stored = { day: { kind: "index", index: 0 }, city: "Rome" };
    expect(withoutSuperseded({ dateScope: "today" }, getMacro("day.weather"), stored)).toEqual({ city: "Rome" });
    expect(withoutSuperseded({}, getMacro("day.weather"), stored)).toBe(stored);
  });
});
