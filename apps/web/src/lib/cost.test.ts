import { describe, expect, it } from "vitest";
import { tripSpend, daySpend, plannedOfBudgetLine } from "./cost";
import { costedTripDetailFixture } from "@tc/factories";

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

describe("plannedOfBudgetLine", () => {
  it("formats planned spend against the budget via formatMoney (KI-2), not a hand-rolled string", () => {
    // costedTripDetailFixture: tripCostTotal 49100 minor, budget 100000 minor, USD.
    const spend = tripSpend(costedTripDetailFixture());
    expect(plannedOfBudgetLine(spend, "USD")).toBe("$491.00 planned of $1,000.00");
  });

  it("reports the honest 'No budget yet' when the trip has none, never a fabricated figure", () => {
    const spend = tripSpend({ ...costedTripDetailFixture(), budget: null });
    expect(plannedOfBudgetLine(spend, "USD")).toBe("No budget yet");
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
