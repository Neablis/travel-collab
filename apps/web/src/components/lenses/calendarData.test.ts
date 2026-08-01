import { describe, expect, it } from "vitest";
import type { TripDetail } from "@tc/contracts";
import { calendarCells } from "./calendarData";

const DAY = "7d9a1f8e-0000-4000-8000-00000000000d";
const A1 = "7d9a1f8e-0000-4000-8000-0000000000a1";
const detail: TripDetail = {
  tripId: "7d9a1f8e-0000-4000-8000-00000000000a", name: "Rome", startDate: "2026-10-12",
  currency: "USD", budget: null,
  members: [{ userId: "u1", role: "owner" }],
  days: [{ dayId: DAY, activityIds: [A1], date: "2026-10-12", costSubtotal: 0 }], backlog: [],
  unscheduledCostSubtotal: 0, tripCostTotal: 0, budgetRemaining: null,
  activities: { [A1]: { activityId: A1, title: "X", timeWindow: null, location: null, notes: null, anchors: [], cost: null } },
  conflicts: [], dismissedConflictIds: [], createdAt: "2026-07-09T00:00:00.000Z",
  status: "active",
};

describe("calendarCells", () => {
  it("marks the trip day with its ordinal and activities; padding days are not in-trip", () => {
    const cells = calendarCells(detail);
    const tripDay = cells.find((c) => c.date === "2026-10-12")!;
    expect(tripDay.inTrip).toBe(true);
    expect(tripDay.ordinal).toBe(1);
    expect(tripDay.activityIds).toEqual([A1]);
    expect(cells.every((c) => (c.date === "2026-10-12" ? c.inTrip : !c.inTrip || c.ordinal !== undefined))).toBe(true);
  });

  it("undated trip → no cells", () => {
    expect(calendarCells({ ...detail, startDate: null, days: [{ dayId: DAY, activityIds: [A1], date: null, costSubtotal: 0 }] })).toEqual([]);
  });
});
