import { describe, expect, it } from "vitest";
import type { TripDetail } from "@tc/contracts";
import { tripDetailFixture } from "@tc/factories";
import { itineraryDay, itineraryTrip, costsTable } from "./block";

// From the factory, overriding only what these cases are about (AGENTS.md:
// "data comes from `@tc/factories`, never a hand-built rollup").
const detail: TripDetail = tripDetailFixture({
  name: "Japan",
  startDate: "2026-08-01",
  days: [{ dayId: "d0", activityIds: ["a1"], date: "2026-08-01", costSubtotal: 5000 }],
  activities: {
    a1: {
      activityId: "a1", title: "Museum", timeWindow: null, location: null, notes: null,
      anchors: [], kind: "planned" as const, tags: [], cost: { amountMinor: 5000, currency: "USD" },
    },
  },
  tripCostTotal: 5000,
});

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
    const r = itineraryDay.resolve({ trip: detail, page: ctx, user: null, globals: null }, { dayRef: { kind: "index", index: 0 } });
    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.value.activities[0]!.title).toBe("Museum");
  });
  // The claim §18 exists to make: the day comes off the WIDGET, so this one
  // reads day 2 while the page it sits on is about nothing in particular.
  it("itinerary.day reads the day named in its own params", () => {
    const r = itineraryDay.resolve({ trip: twoDays, page: ctx, user: null, globals: null }, { dayRef: { kind: "index", index: 1 } });
    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.value.dayId).toBe("d1");
      expect(r.value.activities.map((a) => a.title)).toEqual(["Onsen"]);
    }
  });
  it("itinerary.day is unbound when its params name no day", () => {
    expect(itineraryDay.resolve({ trip: twoDays, page: ctx, user: null, globals: null }, {}).status).toBe("unbound");
  });
  it("itinerary.day is empty for a day with no activities", () => {
    const emptyDay = { ...detail, days: [{ dayId: "d0", activityIds: [], date: "2026-08-01", costSubtotal: 0 }] };
    expect(itineraryDay.resolve({ trip: emptyDay, page: ctx, user: null, globals: null }, { dayRef: { kind: "index", index: 0 } }).status).toBe("empty");
  });
  // **Every day, identified.** Asserting only `status: "ok"` passes for a
  // resolver that returns one day out of two, or none of them — which is the
  // failure "returns all days" is the claim about (CodeRabbit, PR 139).
  it("itinerary.trip returns EVERY day, in order; empty when there are none", () => {
    const r = itineraryTrip.resolve({ trip: twoDays, page: ctx, user: null, globals: null }, {});
    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.value.days.map((d) => d.dayId)).toEqual(["d0", "d1"]);
      // ...and each day carries its OWN stops, not the first day's twice.
      expect(r.value.days.map((d) => d.activities.map((a) => a.title))).toEqual([["Museum"], ["Onsen"]]);
    }
    expect(itineraryTrip.resolve({ trip: { ...detail, days: [] }, page: ctx, user: null, globals: null }, {}).status).toBe("empty");
  });
  // **The ROWS, not just the total.** A resolver that dropped the backlog row
  // entirely still produced the right total here, because the total comes off
  // `tripCostTotal` — so the old assertion could not tell "lists day + backlog
  // rows" from "lists neither" (CodeRabbit, PR 139). The backlog cost is
  // nonzero for the same reason: a zero row is one a resolver may legitimately
  // omit, so it proves nothing about one that should be there.
  it("costs.table lists a row per day AND the backlog, with the total; empty when zero", () => {
    const withBacklog: TripDetail = { ...detail, unscheduledCostSubtotal: 2000, tripCostTotal: 7000 };
    const r = costsTable.resolve({ trip: withBacklog, page: ctx, user: null, globals: null }, {});
    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.value.rows.map((row) => row.amount)).toContain("$50.00");
      expect(r.value.rows.map((row) => row.amount)).toContain("$20.00");
      expect(r.value.rows).toHaveLength(2);
      expect(r.value.total).toBe("$70.00");
    }
    expect(costsTable.resolve({ trip: { ...detail, tripCostTotal: 0, days: [{ dayId: "d0", activityIds: [], date: "2026-08-01", costSubtotal: 0 }] }, page: ctx, user: null, globals: null }, {}).status).toBe("empty");
  });
});
