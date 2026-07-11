import { describe, expect, it } from "vitest";
import type { TripDetail } from "@tc/contracts";
import { itineraryDays, itineraryUnscheduled } from "./itineraryData";

const DAY = "7d9a1f8e-0000-4000-8000-00000000000d";
const A1 = "7d9a1f8e-0000-4000-8000-0000000000a1";
const A2 = "7d9a1f8e-0000-4000-8000-0000000000a2";
const detail: TripDetail = {
  tripId: "7d9a1f8e-0000-4000-8000-00000000000a", name: "Rome", startDate: "2026-10-12", currency: "USD", budget: null,
  members: [{ userId: "u1", role: "owner" }],
  days: [{ dayId: DAY, activityIds: [A1], date: "2026-10-12", costSubtotal: 4200 }],
  backlog: [A2], unscheduledCostSubtotal: 9900, tripCostTotal: 14100, budgetRemaining: null,
  activities: {
    [A1]: { activityId: A1, title: "Colosseum", timeWindow: { start: "09:00", end: "11:00" }, location: { name: "Colosseum" }, notes: null, anchors: [], cost: { amountMinor: 4200, currency: "USD" } },
    [A2]: { activityId: A2, title: "Travel insurance", timeWindow: null, location: null, notes: null, anchors: [], cost: { amountMinor: 9900, currency: "USD" } },
  },
  conflicts: [], dismissedConflictIds: [], createdAt: "2026-07-10T00:00:00.000Z",
};

describe("itineraryData", () => {
  it("lists each day's activities in order with cost and subtotal", () => {
    const [day] = itineraryDays(detail);
    expect(day!.ordinal).toBe(1);
    expect(day!.date).toBe("2026-10-12");
    expect(day!.costSubtotal).toBe(4200);
    expect(day!.activities).toEqual([{ activityId: A1, title: "Colosseum", start: "09:00", end: "11:00", place: "Colosseum", costMinor: 4200 }]);
  });
  it("lists unscheduled (trip-level) costs separately", () => {
    expect(itineraryUnscheduled(detail)).toEqual([{ activityId: A2, title: "Travel insurance", start: null, end: null, place: null, costMinor: 9900 }]);
  });
});
