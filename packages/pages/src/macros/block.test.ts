import { describe, expect, it } from "vitest";
import type { TripDetail } from "@tc/contracts";
import { itineraryDay, itineraryTrip, costsTable } from "./block";

const detail: TripDetail = {
  tripId: "11111111-1111-1111-1111-111111111111",
  name: "Japan", startDate: "2026-08-01", currency: "USD", budget: null, status: "active",
  members: [{ userId: "u1", role: "owner" }],
  days: [{ dayId: "d0", activityIds: ["a1"], date: "2026-08-01", costSubtotal: 5000 }],
  backlog: [], conflicts: [], dismissedConflictIds: [],
  activities: { a1: { activityId: "a1", title: "Museum", timeWindow: null, location: null, notes: null, anchors: [], kind: "planned" as const, tags: [], cost: { amountMinor: 5000, currency: "USD" } } },
  createdAt: "2026-07-20T00:00:00.000Z", unscheduledCostSubtotal: 0, tripCostTotal: 5000, budgetRemaining: null,
};

describe("block resolvers", () => {
  it("itinerary.day returns the bound day's activities", () => {
    const r = itineraryDay.resolve(detail, { tripId: detail.tripId, dayRef: { kind: "index", index: 0 } }, {});
    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.value.activities[0]!.title).toBe("Museum");
  });
  it("itinerary.day is unbound with no day binding", () => {
    expect(itineraryDay.resolve(detail, { tripId: detail.tripId }, {}).status).toBe("unbound");
  });
  it("itinerary.day is empty for a day with no activities", () => {
    const emptyDay = { ...detail, days: [{ dayId: "d0", activityIds: [], date: "2026-08-01", costSubtotal: 0 }] };
    expect(itineraryDay.resolve(emptyDay, { tripId: detail.tripId, dayRef: { kind: "index", index: 0 } }, {}).status).toBe("empty");
  });
  it("itinerary.trip returns all days; empty when there are none", () => {
    expect(itineraryTrip.resolve(detail, { tripId: detail.tripId }, {}).status).toBe("ok");
    expect(itineraryTrip.resolve({ ...detail, days: [] }, { tripId: detail.tripId }, {}).status).toBe("empty");
  });
  it("costs.table lists day + backlog rows with a total; empty when zero", () => {
    const r = costsTable.resolve(detail, { tripId: detail.tripId }, {});
    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.value.total).toBe("$50.00");
    expect(costsTable.resolve({ ...detail, tripCostTotal: 0, days: [{ dayId: "d0", activityIds: [], date: "2026-08-01", costSubtotal: 0 }] }, { tripId: detail.tripId }, {}).status).toBe("empty");
  });
});
