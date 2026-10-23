// `resolveDateScope` (ADR-080 §4): a page's `dateScope` turned into the one
// scope every widget on it is handed. The trip's days have no zone, so every
// clock below runs on the device's, UTC.
import { describe, expect, it } from "vitest";
import type { DateScope } from "@tc/contracts";
import { followsDateScope, resolveDateScope } from "./dateScope";
import { getMacro } from "./registry";
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
