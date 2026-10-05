import { describe, expect, it } from "vitest";
import { tripSpend, daySpend, plannedOfBudgetLine, committedLine } from "./cost";
import { costedTripDetailFixture, withCostRollups } from "@tc/factories";

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

// ADR-060: a price is per person, and committed vs estimate is the stop's kind.
// Three members; the Colosseum is pending with one person picked, the Forum is
// pending with nobody picked, the flight is planned. Hand-worked:
//   estimated = 2500 × 1 + 1600 × 3 = 7300   (raw prices would give 4100)
//   total     = 7300 + 45000 × 3   = 142300
function threeTravellers() {
  const base = costedTripDetailFixture();
  const [colosseum, forum, flight] = Object.values(base.activities);
  return withCostRollups({
    ...base,
    members: [
      { userId: "u1", role: "owner" },
      { userId: "u2", role: "editor" },
      { userId: "u3", role: "viewer" },
    ],
    activities: {
      ...base.activities,
      [colosseum!.activityId]: { ...colosseum!, kind: "pending", participants: ["u1"] },
      [forum!.activityId]: { ...forum!, kind: "pending", participants: [] },
      [flight!.activityId]: { ...flight!, kind: "planned", participants: [] },
    },
  });
}

describe("committed vs estimate", () => {
  it("prices the estimate per person and counts only pending stops in it", () => {
    const spend = tripSpend(threeTravellers());
    expect(spend.total).toBe(142_300);
    expect(spend.estimated).toBe(7_300);
  });

  it("reads 'committed · estimated' when part of the total is a guess, and nothing when none is", () => {
    expect(committedLine(tripSpend(threeTravellers()), "USD")).toBe("$1,350.00 committed · $73.00 estimated");
    // The fixture as shipped has no pending stop, so there is nothing to split.
    expect(committedLine(tripSpend(costedTripDetailFixture()), "USD")).toBeNull();
  });

  it("prices a stop nobody picked for the travellers, not every member", () => {
    // u3 joined to advise (travellers spec D1): the Forum is 1600 × 2, and the
    // server's total — recosted for the same two — splits against it.
    const base = threeTravellers();
    const spend = tripSpend(
      withCostRollups({ ...base, members: base.members.map((m) => (m.userId === "u3" ? { ...m, travelling: false } : m)) }),
    );
    expect(spend.estimated).toBe(2_500 + 1_600 * 2);
    expect(committedLine(spend, "USD")).toBe("$900.00 committed · $57.00 estimated");
  });
});
