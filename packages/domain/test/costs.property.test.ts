import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { rollupCosts, type TripState } from "../src";
import { witness } from "./support/witness";

const TRIP = "7d9a1f8e-0000-4000-8000-00000000000a";

// N activities, each with an integer minor-unit cost (0 = no cost); onDay[i]
// puts activity i on the single day, else in the backlog.
function stateOf(costs: number[], onDay: boolean[]): TripState {
  const activities: TripState["activities"] = {};
  const day = { dayId: "d1", activityIds: [] as string[] };
  const backlog: string[] = [];
  costs.forEach((c, i) => {
    const id = `a${i}`;
    activities[id] = { title: `A${i}`, timeWindow: null, location: null, notes: null, anchors: [], kind: "planned" as const, tags: [], cost: c === 0 ? null : { amountMinor: c, currency: "USD" } };
    (onDay[i] ? day.activityIds : backlog).push(id);
  });
  return { tripId: TRIP, name: "Rome", members: [{ userId: "u1", role: "owner" }], forkedFrom: null, startDate: null, days: [day], backlog, activities, currency: "USD", budget: null, dismissedConflictIds: [], status: "active" };
}

describe("rollupCosts", () => {
  it("a costless trip totals 0", () => {
    const w = witness("costless trip totals 0");
    fc.assert(fc.property(fc.nat({ max: 10 }), (n) => {
      const st = stateOf(Array.from({ length: n }, () => 0), Array.from({ length: n }, (_, i) => i % 2 === 0));
      w.tick();
      expect(rollupCosts(st).tripCostTotal).toBe(0);
    }));
    w.atLeast(100); // exactly numRuns; no guard clause
  });

  it("day subtotals + unscheduled equals the trip total, which equals the sum of all costs (partition)", () => {
    const w = witness("cost partition");
    fc.assert(fc.property(fc.array(fc.nat({ max: 100_000 }), { maxLength: 12 }), (costs) => {
      const onDay = costs.map((_, i) => i % 3 !== 0);
      const r = rollupCosts(stateOf(costs, onDay));
      // Ticks only on a trip that actually carries a cost. `costs: []` makes
      // the partition 0 + 0 === 0 — true of any implementation.
      if (costs.some((c) => c > 0)) w.tick();
      expect(r.dayCostSubtotals.reduce((a, b) => a + b, 0) + r.unscheduledCostSubtotal).toBe(r.tripCostTotal);
      expect(r.tripCostTotal).toBe(costs.reduce((a, b) => a + b, 0));
    }));
    w.atLeast(43); // observed 86-92 runs with a real cost
  });
});
