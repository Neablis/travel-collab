import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { recostDetail, rollupCosts, tripDetailFromState, type TripState } from "../src";
import { witness } from "./support/witness";

const TRIP = "7d9a1f8e-0000-4000-8000-00000000000a";

// N activities, each with an integer minor-unit cost (0 = no cost); onDay[i]
// puts activity i on the single day, else in the backlog. `picked[i]` is how
// many people are in activity i (0 = nobody picked, which means everyone).
function stateOf(costs: number[], onDay: boolean[], picked: number[] = [], members = 1): TripState {
  const activities: TripState["activities"] = {};
  const day = { dayId: "d1", activityIds: [] as string[] };
  const backlog: string[] = [];
  costs.forEach((c, i) => {
    const id = `a${i}`;
    const participants = Array.from({ length: picked[i] ?? 0 }, (_, p) => `u${p + 1}`);
    activities[id] = { title: `A${i}`, timeWindow: null, location: null, notes: null, anchors: [], kind: "planned" as const, tags: [], cost: c === 0 ? null : { amountMinor: c, currency: "USD" } , bookedBy: null, participants, mode: null, endLocation: null, pendingReason: null};
    (onDay[i] ? day.activityIds : backlog).push(id);
  });
  const memberList = Array.from({ length: members }, (_, m) => ({ userId: `u${m + 1}`, role: m === 0 ? ("owner" as const) : ("editor" as const) }));
  return { tripId: TRIP, name: "Rome", members: memberList, forkedFrom: null, startDate: null, days: [day], backlog, activities, currency: "USD", budget: null, dismissedConflictIds: [], status: "active" };
}

describe("rollupCosts", () => {
  it("a costless trip totals 0", () => {
    const w = witness("costless trip totals 0");
    fc.assert(fc.property(fc.nat({ max: 10 }), (n) => {
      const st = stateOf(Array.from({ length: n }, () => 0), Array.from({ length: n }, (_, i) => i % 2 === 0));
      w.tick();
      expect(rollupCosts(st, 1).tripCostTotal).toBe(0);
    }));
    w.atLeast(100); // exactly numRuns; no guard clause
  });

  it("day subtotals + unscheduled equals the trip total, which equals the sum of all costs (partition)", () => {
    const w = witness("cost partition");
    fc.assert(fc.property(fc.array(fc.nat({ max: 100_000 }), { maxLength: 12 }), (costs) => {
      const onDay = costs.map((_, i) => i % 3 !== 0);
      const r = rollupCosts(stateOf(costs, onDay), 1);
      // Ticks only on a trip that actually carries a cost. `costs: []` makes
      // the partition 0 + 0 === 0 — true of any implementation.
      if (costs.some((c) => c > 0)) w.tick();
      expect(r.dayCostSubtotals.reduce((a, b) => a + b, 0) + r.unscheduledCostSubtotal).toBe(r.tripCostTotal);
      expect(r.tripCostTotal).toBe(costs.reduce((a, b) => a + b, 0));
    }));
    w.atLeast(43); // observed 86-92 runs with a real cost
  });

  // ADR-060: a price is per person. The headcount is who is picked, or every
  // member when nobody is. A rollup that summed the raw price would pass the
  // solo-trip partition above and fail here.
  it("each stop counts its price once per person in it, or once per member when nobody is picked", () => {
    const w = witness("per-person rollup");
    const stop = fc.record({ cost: fc.nat({ max: 100_000 }), picked: fc.nat({ max: 4 }) });
    fc.assert(fc.property(fc.array(stop, { maxLength: 10 }), fc.integer({ min: 1, max: 6 }), (stops, members) => {
      const costs = stops.map((s) => s.cost);
      const picked = stops.map((s) => s.picked);
      const r = rollupCosts(stateOf(costs, costs.map((_, i) => i % 2 === 0), picked), members);
      const expected = stops.reduce((sum, s) => sum + s.cost * (s.picked > 0 ? s.picked : members), 0);
      // Ticks only where per-person and per-stop answers can differ: some
      // priced stop is for more than one person.
      if (stops.some((s) => s.cost > 0 && (s.picked > 0 ? s.picked : members) > 1)) w.tick();
      expect(r.tripCostTotal).toBe(expected);
    }));
    w.atLeast(39); // observed 79-91 over 10 runs
  });
});

describe("recostDetail", () => {
  // The read-time overlay and the projection are one definition: recosting a
  // stored detail for N members is exactly what the projection would produce
  // if the log itself held those N members. That is what lets the server add
  // members at read time without a second implementation of the rollup.
  it("equals the projection of the same trip with that many members", () => {
    const w = witness("recost equals projection");
    const stop = fc.record({ cost: fc.nat({ max: 100_000 }), picked: fc.nat({ max: 3 }), onDay: fc.boolean() });
    const budget = fc.option(fc.nat({ max: 5_000_000 }), { nil: null });
    fc.assert(fc.property(fc.array(stop, { maxLength: 8 }), fc.integer({ min: 1, max: 5 }), budget, (stops, members, b) => {
      const costs = stops.map((s) => s.cost);
      const onDay = stops.map((s) => s.onDay);
      const picked = stops.map((s) => s.picked);
      const withBudget = (st: TripState): TripState => ({ ...st, budget: b === null ? null : { amountMinor: b, currency: "USD" } });
      const stored = tripDetailFromState(withBudget(stateOf(costs, onDay, picked, 1)), "2026-10-02T00:00:00.000Z");
      const joined = tripDetailFromState(withBudget(stateOf(costs, onDay, picked, members)), "2026-10-02T00:00:00.000Z");
      const recosted = recostDetail(stored, members);
      if (members > 1 && stops.some((s) => s.cost > 0 && s.picked === 0)) w.tick();
      expect(recosted.days).toEqual(joined.days);
      expect(recosted.unscheduledCostSubtotal).toBe(joined.unscheduledCostSubtotal);
      expect(recosted.tripCostTotal).toBe(joined.tripCostTotal);
      expect(recosted.budgetRemaining).toBe(joined.budgetRemaining);
    }));
    w.atLeast(17); // observed 34-54 over 10 runs
  });

  // The over-budget conflict reads `tripCostTotal`, so it has to move with it.
  // Before this, a join that pushed a trip over budget showed the banner and a
  // negative `budgetRemaining` but no conflict on the board, because conflicts
  // were the log's (one member's) answer and the overlay left them alone.
  it("recomputes the over-budget conflict with the totals, so the banner and the board agree", () => {
    const w = witness("recost moves the over-budget conflict");
    const stop = fc.record({ cost: fc.nat({ max: 100_000 }), picked: fc.nat({ max: 3 }), onDay: fc.boolean() });
    fc.assert(fc.property(fc.array(stop, { maxLength: 8 }), fc.integer({ min: 1, max: 5 }), fc.nat({ max: 600_000 }), (stops, members, b) => {
      const costs = stops.map((s) => s.cost);
      const onDay = stops.map((s) => s.onDay);
      const picked = stops.map((s) => s.picked);
      const withBudget = (st: TripState): TripState => ({ ...st, budget: { amountMinor: b, currency: "USD" } });
      const stored = tripDetailFromState(withBudget(stateOf(costs, onDay, picked, 1)), "2026-10-02T00:00:00.000Z");
      const joined = tripDetailFromState(withBudget(stateOf(costs, onDay, picked, members)), "2026-10-02T00:00:00.000Z");
      const recosted = recostDetail(stored, members);
      // Ticks only where the join changes the answer: the log's one member is
      // within budget and the effective members are not.
      const over = (d: typeof stored) => d.conflicts.some((c) => c.kind === "over-budget");
      if (!over(stored) && over(joined)) w.tick();
      expect(recosted.conflicts).toEqual(joined.conflicts);
      expect(over(recosted)).toBe(recosted.budgetRemaining! < 0);
    }), { numRuns: 400 });
    w.atLeast(9); // observed 18-34 over 10 runs of 400
  });
});
