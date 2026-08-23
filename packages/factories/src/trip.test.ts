import { describe, expect, it } from "vitest";
import { scenarios } from "./scenarios";
import { tripDetailFactory } from "./trip";

describe("tripDetailFactory rollups", () => {
  it("computes tripCostTotal from the actual activity costs, not a hand-set default", () => {
    const trip = scenarios.threeDayTrip();
    const summedFromActivities = Object.values(trip.activities).reduce(
      (sum, a) => sum + (a.cost?.amountMinor ?? 0),
      0,
    );
    expect(trip.tripCostTotal).toBe(summedFromActivities);
    expect(trip.tripCostTotal).toBeGreaterThan(0);
  });

  it("recomputes rollups when overrides change the activities after the fact", () => {
    const base = scenarios.threeDayTrip();
    const [firstDay] = base.days;
    const firstActivityId = firstDay!.activityIds[0]!;

    const withPricierActivity = tripDetailFactory.build({
      ...base,
      activities: {
        ...base.activities,
        [firstActivityId]: { ...base.activities[firstActivityId]!, cost: { amountMinor: 999_999, currency: "USD" } },
      },
    });

    expect(withPricierActivity.tripCostTotal).toBeGreaterThan(base.tripCostTotal);
    expect(withPricierActivity.days[0]!.costSubtotal).toBeGreaterThan(base.days[0]!.costSubtotal);
  });

  it("keeps budgetRemaining consistent with budget minus tripCostTotal, including the over-budget case", () => {
    const trip = scenarios.overBudgetTrip();
    expect(trip.budget).not.toBeNull();
    expect(trip.budgetRemaining).toBe(trip.budget!.amountMinor - trip.tripCostTotal);
    expect(trip.budgetRemaining).toBeLessThan(0);
  });

  it("gives every build a distinct, valid tripId derived from its own sequence", () => {
    const a = scenarios.threeDayTrip();
    const b = scenarios.threeDayTrip();
    expect(a.tripId).not.toBe(b.tripId);
    expect(a.days).toHaveLength(b.days.length);
  });
});
