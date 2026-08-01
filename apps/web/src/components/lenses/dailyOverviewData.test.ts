import { describe, expect, it } from "vitest";
import type { TripDetail } from "@tc/contracts";
import { dailyRows } from "./dailyOverviewData";

const DAY = "7d9a1f8e-0000-4000-8000-00000000000d";
const A1 = "7d9a1f8e-0000-4000-8000-0000000000a1";
const detail: TripDetail = {
  tripId: "7d9a1f8e-0000-4000-8000-00000000000a", name: "Rome", startDate: "2026-10-12", currency: "USD", budget: null,
  members: [{ userId: "u1", role: "owner" }],
  days: [{ dayId: DAY, activityIds: [A1], date: "2026-10-12", costSubtotal: 4200 }],
  backlog: [], unscheduledCostSubtotal: 0, tripCostTotal: 4200, budgetRemaining: null,
  activities: { [A1]: { activityId: A1, title: "Colosseum", timeWindow: null, location: null, notes: null, anchors: [], cost: { amountMinor: 4200, currency: "USD" } } },
  conflicts: [{ id: "anchor-violation:" + A1 + ":x", kind: "anchor-violation", severity: "warn", subjects: [A1], description: "x", resolutions: [] }],
  dismissedConflictIds: [], createdAt: "2026-07-10T00:00:00.000Z",
  status: "active",
};

describe("dailyRows", () => {
  it("summarizes each day: count, subtotal, and conflicts touching that day", () => {
    const [row] = dailyRows(detail);
    expect(row!.ordinal).toBe(1);
    expect(row!.date).toBe("2026-10-12");
    expect(row!.activityCount).toBe(1);
    expect(row!.costSubtotal).toBe(4200);
    expect(row!.conflictCount).toBe(1);
  });
});
