import { describe, expect, it } from "vitest";
import { withCostRollups } from "./rollups";
import { tripDetailFixture, costedTripDetailFixture } from "./legacy";

describe("withCostRollups", () => {
  it("corrects the fixture lie this helper was written for", () => {
    // `MacroView.test.tsx` as it stood on PR #141: a trip total of 12345 with
    // no activity behind it. `cost.trip` read the field and never noticed; the
    // ADR-039 `cost` primitive sums the selected stops, and the fixture broke
    // the moment a widget did the arithmetic the field was claiming.
    const lying = tripDetailFixture({
      activities: {},
      days: [{ dayId: "d0", activityIds: [], date: "2027-06-01", costSubtotal: 0 }],
      backlog: [],
      tripCostTotal: 12345,
      unscheduledCostSubtotal: 500,
    });
    expect(lying.tripCostTotal).toBe(12345);

    const honest = withCostRollups(lying);
    expect(honest.tripCostTotal).toBe(0);
    expect(honest.unscheduledCostSubtotal).toBe(0);
  });

  it("sums scheduled and unscheduled stops, and attributes each day its own", () => {
    const detail = withCostRollups(
      tripDetailFixture({
        activities: {
          a1: { ...stop, activityId: "a1", cost: { amountMinor: 1000, currency: "USD" } },
          a2: { ...stop, activityId: "a2", cost: { amountMinor: 250, currency: "USD" } },
          u1: { ...stop, activityId: "u1", cost: { amountMinor: 500, currency: "USD" } },
        },
        days: [
          { dayId: "d0", activityIds: ["a1"], date: "2027-06-01", costSubtotal: 999 },
          { dayId: "d1", activityIds: ["a2"], date: "2027-06-02", costSubtotal: 999 },
        ],
        backlog: ["u1"],
        tripCostTotal: 999,
        unscheduledCostSubtotal: 999,
      }),
    );

    expect(detail.days.map((d) => d.costSubtotal)).toEqual([1000, 250]);
    expect(detail.unscheduledCostSubtotal).toBe(500);
    // The backlog is in the trip's total — the distinction that made the
    // second PR 141 fixture bug invisible until a widget summed stops.
    expect(detail.tripCostTotal).toBe(1750);
  });

  it("treats a stop with no cost as zero rather than dropping the day", () => {
    const detail = withCostRollups(
      tripDetailFixture({
        activities: { a1: { ...stop, activityId: "a1", cost: null } },
        days: [{ dayId: "d0", activityIds: ["a1"], date: null, costSubtotal: 4200 }],
        backlog: [],
      }),
    );
    expect(detail.days[0]!.costSubtotal).toBe(0);
    expect(detail.tripCostTotal).toBe(0);
  });

  it("recomputes budgetRemaining, because a stale one is the same lie", () => {
    const detail = withCostRollups(
      tripDetailFixture({
        budget: { amountMinor: 10000, currency: "USD" },
        budgetRemaining: 9999,
        activities: { a1: { ...stop, activityId: "a1", cost: { amountMinor: 2500, currency: "USD" } } },
        days: [{ dayId: "d0", activityIds: ["a1"], date: null, costSubtotal: 0 }],
        backlog: [],
      }),
    );
    expect(detail.budgetRemaining).toBe(7500);
  });

  it("leaves budgetRemaining alone when no budget is set", () => {
    // `null` means "no budget", which is a different fact from "nothing left" —
    // inventing a number here would be this helper committing the offence it
    // exists to prevent.
    const detail = withCostRollups(tripDetailFixture({ budget: null, budgetRemaining: null }));
    expect(detail.budgetRemaining).toBeNull();
  });

  it("is a no-op on a fixture that was already honest", () => {
    // `costedTripDetailFixture` derives its own totals, so passing it through
    // must change nothing. This is what pins the two against each other: if the
    // helper and that fixture ever disagree, one of them is wrong.
    const already = costedTripDetailFixture();
    expect(withCostRollups(already)).toEqual(already);
  });
});

const stop = {
  activityId: "placeholder",
  title: "A stop",
  timeWindow: null,
  location: null,
  notes: null,
  anchors: [],
  kind: "planned" as const,
  tags: [],
  cost: null,
};
