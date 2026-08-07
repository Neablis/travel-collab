import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { rollupCosts, type TripState } from "../src";

const TRIP = "7d9a1f8e-0000-4000-8000-00000000000a";

// N activities, each with an integer minor-unit cost (0 = no cost); onDay[i]
// puts activity i on the single day, else in the backlog.
function stateOf(costs: number[], onDay: boolean[]): TripState {
  const activities: TripState["activities"] = {};
  const day = { dayId: "d1", activityIds: [] as string[] };
  const backlog: string[] = [];
  costs.forEach((c, i) => {
    const id = `a${i}`;
    activities[id] = { title: `A${i}`, timeWindow: null, location: null, notes: null, anchors: [], cost: c === 0 ? null : { amountMinor: c, currency: "USD" } };
    (onDay[i] ? day.activityIds : backlog).push(id);
  });
  return { tripId: TRIP, name: "Rome", members: [{ userId: "u1", role: "owner" }], startDate: null, days: [day], backlog, activities, currency: "USD", budget: null, dismissedConflictIds: [], status: "active" };
}

describe("rollupCosts", () => {
  it("a costless trip totals 0", () => {
    fc.assert(fc.property(fc.nat({ max: 10 }), (n) => {
      const st = stateOf(Array.from({ length: n }, () => 0), Array.from({ length: n }, (_, i) => i % 2 === 0));
      expect(rollupCosts(st).tripCostTotal).toBe(0);
    }));
  });

  it("day subtotals + unscheduled equals the trip total, which equals the sum of all costs (partition)", () => {
    fc.assert(fc.property(fc.array(fc.nat({ max: 100_000 }), { maxLength: 12 }), (costs) => {
      const onDay = costs.map((_, i) => i % 3 !== 0);
      const r = rollupCosts(stateOf(costs, onDay));
      expect(r.dayCostSubtotals.reduce((a, b) => a + b, 0) + r.unscheduledCostSubtotal).toBe(r.tripCostTotal);
      expect(r.tripCostTotal).toBe(costs.reduce((a, b) => a + b, 0));
    }));
  });
});
