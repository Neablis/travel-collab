import { describe, expect, it } from "vitest";
import type { TripDetail } from "@tc/contracts";
import { tripOverview } from "./tripOverviewData";

const DAY = "7d9a1f8e-0000-4000-8000-00000000000d";
const A1 = "7d9a1f8e-0000-4000-8000-0000000000a1";
const detail: TripDetail = {
  tripId: "7d9a1f8e-0000-4000-8000-00000000000a", name: "Rome", startDate: "2026-10-12", currency: "USD",
  budget: { amountMinor: 10000, currency: "USD" },
  members: [{ userId: "u1", role: "owner" }],
  days: [{ dayId: DAY, activityIds: [A1], date: "2026-10-12", costSubtotal: 4200 }],
  backlog: [], unscheduledCostSubtotal: 9900, tripCostTotal: 14100, budgetRemaining: -4100,
  activities: { [A1]: { activityId: A1, title: "Colosseum", timeWindow: null, location: null, notes: null, anchors: [], cost: { amountMinor: 4200, currency: "USD" } } },
  conflicts: [], dismissedConflictIds: [], createdAt: "2026-07-10T00:00:00.000Z",
  status: "active",
};

describe("tripOverview", () => {
  it("summarizes the whole trip and flags over-budget", () => {
    const o = tripOverview(detail);
    expect(o.dayCount).toBe(1);
    expect(o.dateRange).toEqual({ from: "2026-10-12", to: "2026-10-12" });
    expect(o.tripCostTotal).toBe(14100);
    expect(o.scheduledTotal).toBe(4200);
    expect(o.unscheduledTotal).toBe(9900);
    expect(o.budgetRemaining).toBe(-4100);
    expect(o.overBudget).toBe(true);
  });
});
