import { describe, expect, it } from "vitest";
import { decideTripCommand, detectConflicts, type TripState } from "../src";

const TRIP = "7d9a1f8e-0000-4000-8000-00000000000a";
const A1 = "a1";

function stateWith(budgetMinor: number | null, costMinor: number): TripState {
  return {
    tripId: TRIP, name: "Rome", members: [{ userId: "u1", role: "owner" }], forkedFrom: null,
    startDate: null, days: [{ dayId: "d1", activityIds: [A1] }], backlog: [],
    activities: { [A1]: { title: "Hotel", timeWindow: null, location: null, notes: null, anchors: [], kind: "planned" as const, tags: [], cost: { amountMinor: costMinor, currency: "USD" } , bookedBy: null, participants: [], mode: null, endLocation: null, pendingReason: null} },
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

  // KI-2: the conflict description's money formatting must match the UI's
  // `formatMoney` (apps/web/src/components/lenses/formatMoney.ts, #22) —
  // thousands-grouped, two decimals — so the same amount never renders two
  // different ways depending on which surface displays it. Mirrors
  // apps/web/src/components/lenses/formatMoney.test.ts's grouping case
  // (111110600 minor -> "1,111,106.00 USD") with cost minus budget landing on
  // the same amount.
  it("groups thousands in the description the same way the UI's formatMoney does (#22, KI-2)", () => {
    const budgetMinor = 100;
    const costMinor = 111110700; // costMinor - budgetMinor = 111110600 -> "1,111,106.00"
    const conflicts = detectConflicts(stateWith(budgetMinor, costMinor));
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.description).toBe(
      "Trip total (1,111,107.00 USD) exceeds the budget (1.00 USD) by 1,111,106.00 USD.",
    );
  });
});

// Review finding on PR #289. The reader recosts the over-budget conflict for the
// EFFECTIVE members (`recostDetail`), which the log does not hold; the decider
// used to judge it for the log's members alone. So a conflict the reader showed
// could not be dismissed, and one that was dismissed lapsed on the next
// unrelated command. `ctx.memberCount` is how the server tells the decider the
// count the reader used.
describe("the decider judges over-budget for the reader's member count (ADR-060)", () => {
  const OVER = `over-budget:${TRIP}`;
  // 2,000 per person, nobody picked, budget 5,000: under for the log's one
  // member, over (6,000) once three people are on the trip.
  const perPerson = () => stateWith(5000, 2000);

  it("dismisses an over-budget conflict that exists only for the effective members", () => {
    const command = { type: "DismissConflict", tripId: TRIP, conflictId: OVER } as const;
    expect(decideTripCommand(perPerson(), command, { actorId: "u1", memberCount: 3 })).toEqual({
      ok: true,
      events: [{ type: "ConflictDismissed", version: 1, payload: { tripId: TRIP, conflictId: OVER } }],
    });
    // Absent, the log's members still decide — replay and old callers unchanged.
    expect(decideTripCommand(perPerson(), command, { actorId: "u1" })).toMatchObject({
      ok: false,
      rejection: { code: "conflict-not-found" },
    });
  });

  it("keeps that dismissal through an unrelated command, and lapses it once the effective total is under", () => {
    const dismissed = { ...perPerson(), dismissedConflictIds: [OVER] };
    const rename = { type: "SetTripName", tripId: TRIP, name: "Roma" } as const;

    const stillOver = decideTripCommand(dismissed, rename, { actorId: "u1", memberCount: 3 });
    expect(stillOver.ok && stillOver.events.map((e) => e.type)).toEqual(["TripNameSet"]);

    // Two people: 4,000 against 5,000 — genuinely under, so it lapses (KI-14).
    const nowUnder = decideTripCommand(dismissed, rename, { actorId: "u1", memberCount: 2 });
    expect(nowUnder.ok && nowUnder.events.map((e) => e.type)).toEqual(["TripNameSet", "ConflictUndismissed"]);
  });
});
