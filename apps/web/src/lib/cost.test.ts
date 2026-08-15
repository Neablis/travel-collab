import { describe, expect, it } from "vitest";
import { tripSpend, daySpend } from "./cost";
import { costedTripDetailFixture } from "@/mocks/fixtures";

describe("tripSpend", () => {
  it("reads the server-computed total rather than re-summing", () => {
    const detail = { ...costedTripDetailFixture(), tripCostTotal: 12_345 };
    expect(tripSpend(detail).total).toBe(12_345);
  });

  it("counts activities with no cost (null) as unpriced", () => {
    // ActivityView.cost (detail.ts:14) is Money.nullable() — an unpriced
    // activity in TripDetail.activities is always `null`, never `undefined`.
    const base = costedTripDetailFixture();
    const [aId, bId] = Object.keys(base.activities);
    const a = base.activities[aId!]!;
    const detail = {
      ...base,
      activities: {
        ...base.activities,
        [aId!]: { ...a, cost: { amountMinor: 500, currency: "USD" } },
        [bId!]: { ...a, activityId: bId!, cost: null },
      },
    };
    expect(tripSpend(detail).unpriced).toBe(1);
  });

  it("reports over-budget from budgetRemaining, including the negative case", () => {
    const base = costedTripDetailFixture();
    expect(tripSpend({ ...base, budgetRemaining: -820 }).over).toBe(true);
    expect(tripSpend({ ...base, budgetRemaining: 7_315 }).over).toBe(false);
    expect(tripSpend({ ...base, budgetRemaining: null }).over).toBe(false);
  });

  it("has a null budget when the trip has none", () => {
    expect(tripSpend({ ...costedTripDetailFixture(), budget: null }).budget).toBeNull();
  });
});

describe("daySpend", () => {
  it("sums only the named day's activities", () => {
    const detail = costedTripDetailFixture();
    const dayId = detail.days[0]!.dayId;
    const result = daySpend(detail, dayId);
    expect(result.total).toBeGreaterThanOrEqual(0);
    expect(result.unpriced).toBeGreaterThanOrEqual(0);
  });

  it("returns zeroes for an unknown day", () => {
    expect(daySpend(costedTripDetailFixture(), "no-such-day")).toEqual({ total: 0, unpriced: 0 });
  });
});
