import { describe, expect, it } from "vitest";
import { detectConflicts, type TripState } from "../src";

const TRIP = "7d9a1f8e-0000-4000-8000-00000000000a";
const A1 = "a1";

function stateWith(budgetMinor: number | null, costMinor: number): TripState {
  return {
    tripId: TRIP, name: "Rome", members: [{ userId: "u1", role: "owner" }],
    startDate: null, days: [{ dayId: "d1", activityIds: [A1] }], backlog: [],
    activities: { [A1]: { title: "Hotel", timeWindow: null, location: null, notes: null, anchors: [], cost: { amountMinor: costMinor, currency: "USD" } } },
    currency: "USD", budget: budgetMinor === null ? null : { amountMinor: budgetMinor, currency: "USD" },
    dismissedConflictIds: [],
    status: "active",
  };
}

describe("over-budget rule", () => {
  it("no conflict with no budget, under budget, or exactly at budget", () => {
    expect(detectConflicts(stateWith(null, 5000))).toHaveLength(0);
    expect(detectConflicts(stateWith(5000, 4999))).toHaveLength(0);
    expect(detectConflicts(stateWith(5000, 5000))).toHaveLength(0);
  });

  it("one warn conflict when over budget, with a stable trip-scoped id", () => {
    const conflicts = detectConflicts(stateWith(5000, 6000));
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.kind).toBe("over-budget");
    expect(conflicts[0]!.severity).toBe("warn");
    expect(conflicts[0]!.id).toBe(`over-budget:${TRIP}`);
    expect(conflicts[0]!.subjects).toEqual([TRIP]);
  });
});
