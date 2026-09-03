import { describe, expect, it } from "vitest";
import type { TripDetail } from "@tc/contracts";
import { itineraryDay, itineraryTrip, costsTable } from "./block";

const detail: TripDetail = {
  tripId: "11111111-1111-1111-1111-111111111111",
  name: "Japan", startDate: "2026-08-01", currency: "USD", budget: null, status: "active",
  members: [{ userId: "u1", role: "owner" }],
  forkedFrom: null,
  days: [{ dayId: "d0", activityIds: ["a1"], date: "2026-08-01", costSubtotal: 5000 }],
  backlog: [], conflicts: [], dismissedConflictIds: [],
  activities: { a1: { activityId: "a1", title: "Museum", timeWindow: null, location: null, notes: null, anchors: [], kind: "planned" as const, tags: [], cost: { amountMinor: 5000, currency: "USD" } } },
  createdAt: "2026-07-20T00:00:00.000Z", unscheduledCostSubtotal: 0, tripCostTotal: 5000, budgetRemaining: null,
};

// The page carries the trip and nothing else; the day is the widget's own
// param (SPEC §18 / ADR-035 decision 3).
const ctx = { tripId: detail.tripId };

// A second day with its own stop, so "index 1" resolving to day 2 is a claim
// about the ref and not about there being only one day to land on.
const twoDays: TripDetail = {
  ...detail,
  days: [detail.days[0]!, { dayId: "d1", activityIds: ["a2"], date: "2026-08-02", costSubtotal: 0 }],
  activities: {
    ...detail.activities,
    a2: { activityId: "a2", title: "Onsen", timeWindow: null, location: null, notes: null, anchors: [], kind: "planned" as const, tags: [], cost: null },
  },
};

describe("block resolvers", () => {
  it("itinerary.day returns the bound day's activities", () => {
    const r = itineraryDay.resolve(detail, ctx, { dayRef: { kind: "index", index: 0 } });
    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.value.activities[0]!.title).toBe("Museum");
  });
  // The claim §18 exists to make: the day comes off the WIDGET, so this one
  // reads day 2 while the page it sits on is about nothing in particular.
  it("itinerary.day reads the day named in its own params", () => {
    const r = itineraryDay.resolve(twoDays, ctx, { dayRef: { kind: "index", index: 1 } });
    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.value.dayId).toBe("d1");
      expect(r.value.activities.map((a) => a.title)).toEqual(["Onsen"]);
    }
  });
  it("itinerary.day is unbound when its params name no day", () => {
    expect(itineraryDay.resolve(twoDays, ctx, {}).status).toBe("unbound");
  });
  it("itinerary.day is empty for a day with no activities", () => {
    const emptyDay = { ...detail, days: [{ dayId: "d0", activityIds: [], date: "2026-08-01", costSubtotal: 0 }] };
    expect(itineraryDay.resolve(emptyDay, ctx, { dayRef: { kind: "index", index: 0 } }).status).toBe("empty");
  });
  it("itinerary.trip returns all days; empty when there are none", () => {
    expect(itineraryTrip.resolve(detail, ctx, {}).status).toBe("ok");
    expect(itineraryTrip.resolve({ ...detail, days: [] }, ctx, {}).status).toBe("empty");
  });
  it("costs.table lists day + backlog rows with a total; empty when zero", () => {
    const r = costsTable.resolve(detail, ctx, {});
    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.value.total).toBe("$50.00");
    expect(costsTable.resolve({ ...detail, tripCostTotal: 0, days: [{ dayId: "d0", activityIds: [], date: "2026-08-01", costSubtotal: 0 }] }, ctx, {}).status).toBe("empty");
  });
});
