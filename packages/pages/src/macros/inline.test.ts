import { describe, expect, it } from "vitest";
import type { TripDetail } from "@tc/contracts";
import { tripName, tripDates, costTrip, costDay } from "./inline";

const base: TripDetail = {
  tripId: "11111111-1111-1111-1111-111111111111",
  name: "Japan 2026", startDate: "2026-08-01", currency: "USD", budget: null, status: "active",
  members: [{ userId: "u1", role: "owner" }],
  days: [
    { dayId: "d0", activityIds: [], date: "2026-08-01", costSubtotal: 5000 },
    { dayId: "d1", activityIds: [], date: "2026-08-02", costSubtotal: 0 },
  ],
  backlog: [], activities: {}, conflicts: [], dismissedConflictIds: [],
  createdAt: "2026-07-20T00:00:00.000Z",
  unscheduledCostSubtotal: 0, tripCostTotal: 5000, budgetRemaining: null,
};
const tripCtx = { tripId: base.tripId };
const dayCtx = { tripId: base.tripId, dayRef: { kind: "index", index: 0 } as const };

describe("inline resolvers", () => {
  it("trip.name resolves the name", () => {
    const r = tripName.resolve(base, tripCtx, {});
    expect(r).toEqual({ status: "ok", value: "Japan 2026" });
  });
  it("trip.dates is empty when no startDate", () => {
    expect(tripDates.resolve({ ...base, startDate: null }, tripCtx, {}).status).toBe("empty");
  });
  it("cost.trip formats the total; empty when zero", () => {
    expect(costTrip.resolve(base, tripCtx, {})).toEqual({ status: "ok", value: "$50.00" });
    expect(costTrip.resolve({ ...base, tripCostTotal: 0 }, tripCtx, {}).status).toBe("empty");
  });
  it("cost.day resolves the bound day; unbound with no day; empty when zero", () => {
    expect(costDay.resolve(base, dayCtx, {})).toEqual({ status: "ok", value: "$50.00" });
    expect(costDay.resolve(base, tripCtx, {}).status).toBe("unbound");
    const day1 = { tripId: base.tripId, dayRef: { kind: "index", index: 1 } as const };
    expect(costDay.resolve(base, day1, {}).status).toBe("empty");
  });
});
