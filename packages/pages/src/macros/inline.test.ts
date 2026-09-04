import { MACRO_NAMES, getMacro } from "../registry";
import { describe, expect, it } from "vitest";
import type { TripDetail } from "@tc/contracts";
import { tripName, tripDates, costTrip, costDay, resolveDayIndex } from "./inline";

const base: TripDetail = {
  tripId: "11111111-1111-1111-1111-111111111111",
  name: "Japan 2026", startDate: "2026-08-01", currency: "USD", budget: null, status: "active",
  members: [{ userId: "u1", role: "owner" }],
  forkedFrom: null,
  days: [
    { dayId: "d0", activityIds: [], date: "2026-08-01", costSubtotal: 5000 },
    { dayId: "d1", activityIds: [], date: "2026-08-02", costSubtotal: 0 },
  ],
  backlog: [], activities: {}, conflicts: [], dismissedConflictIds: [],
  createdAt: "2026-07-20T00:00:00.000Z",
  unscheduledCostSubtotal: 0, tripCostTotal: 5000, budgetRemaining: null,
};
// The page context carries the trip and nothing else: a day binding is the
// widget's own param now (SPEC §18 / ADR-035 decision 3).
const ctx = { tripId: base.tripId };
const day0 = { dayRef: { kind: "index", index: 0 } as const };

describe("inline resolvers", () => {
  it("trip.name resolves the name", () => {
    const r = tripName.resolve({ trip: base, page: ctx, user: null, globals: null }, {});
    expect(r).toEqual({ status: "ok", value: "Japan 2026" });
  });
  it("trip.dates is empty when no startDate", () => {
    expect(tripDates.resolve({ trip: { ...base, startDate: null }, page: ctx, user: null, globals: null }, {}).status).toBe("empty");
  });
  it("cost.trip formats the total; empty when zero", () => {
    expect(costTrip.resolve({ trip: base, page: ctx, user: null, globals: null }, {})).toEqual({ status: "ok", value: "$50.00" });
    expect(costTrip.resolve({ trip: { ...base, tripCostTotal: 0 }, page: ctx, user: null, globals: null }, {}).status).toBe("empty");
  });
  it("cost.day resolves the day in its OWN params; unbound with no ref; empty when zero", () => {
    expect(costDay.resolve({ trip: base, page: ctx, user: null, globals: null }, day0)).toEqual({ status: "ok", value: "$50.00" });
    expect(costDay.resolve({ trip: base, page: ctx, user: null, globals: null }, {}).status).toBe("unbound");
    expect(costDay.resolve({ trip: base, page: ctx, user: null, globals: null }, { dayRef: { kind: "index", index: 1 } }).status).toBe("empty");
  });
});

// These are the cases `resolveBoundDay` used to own in apps/web's AI context
// module, which read the binding off the PAGE. The binding moved onto the
// widget; the resolution rule did not change, so neither did they.
describe("resolveDayIndex", () => {
  it("resolves a dayId ref by identity and an index ref by position", () => {
    expect(resolveDayIndex(base, { dayRef: { kind: "dayId", dayId: "d1" } })).toBe(1);
    expect(resolveDayIndex(base, { dayRef: { kind: "index", index: 1 } })).toBe(1);
  });

  it("is null when the widget is pointed at nothing", () => {
    expect(resolveDayIndex(base, {})).toBeNull();
  });

  // A day deleted under a bound widget. Silently no binding, never a guessed
  // one: rendering day 1 because day 100 is gone is a confident wrong answer,
  // which is the failure class this whole area exists to remove.
  it("is null for a stale ref rather than the nearest day", () => {
    expect(resolveDayIndex(base, { dayRef: { kind: "index", index: 99 } })).toBeNull();
    expect(resolveDayIndex(base, { dayRef: { kind: "dayId", dayId: "d9" } })).toBeNull();
  });
});

// ADR-037 open question 2: "every resolver must handle an absent trip". Made
// required on PR 134 after Copilot pointed out the ADR says so — deferring it
// meant rewriting every trip resolver when root-account notebooks arrive.
//
// Registry-wide rather than per-widget, so a widget added later is covered the
// day it lands: every trip-reading widget must answer `unbound: "trip"` rather
// than throwing on `trip.name` or guessing an answer.
describe("every widget survives a context with no trip", () => {
  // **Classified by scope, not accepted as a set.** The old assertion allowed
  // `ok | empty | unbound` for every macro, so a trip-reading widget that
  // stopped saying `unbound: "trip"` and started answering `empty` kept this
  // green — and "empty" reads to a person as "this trip has nothing", which is
  // a confident wrong answer where "needs a trip" is the true one (CodeRabbit,
  // PR 139).
  //
  // The split is the registry's OWN naming (`account.*`), not a list of names
  // copied into this file — a copied list is the second registry ADR-037
  // deleted, and it would go stale the first time someone adds a widget.
  it("answers unbound:trip for every trip-reading widget, and resolves the account ones", () => {
    const ctx = { page: { tripId: "11111111-1111-1111-1111-111111111111" }, user: null, globals: null };
    let accountScope = 0;
    let tripScope = 0;
    for (const name of MACRO_NAMES) {
      const def = getMacro(name)!;
      const params = def.inputs.some((i) => i.type === "day") ? { dayRef: { kind: "index", index: 0 } } : {};
      const outcome = def.resolve(ctx, params as never);
      if (name.startsWith("account.")) {
        // Account scope: a notebook with no trip is the case these exist for,
        // so needing one would be the bug.
        expect(outcome.status, `${name} is account-scope and must resolve without a trip`).not.toBe("unbound");
        accountScope += 1;
      } else {
        expect(outcome, `${name} reads the trip and must say it needs one`).toMatchObject({
          status: "unbound",
          needs: "trip",
        });
        tripScope += 1;
      }
    }
    // Witnesses on both sides, so the classification cannot be vacuous: a
    // registry with no account widgets, or none that read the trip, would
    // otherwise pass by asserting nothing.
    expect(accountScope, "no account-scope widget in the registry").toBeGreaterThan(0);
    expect(tripScope, "no trip-reading widget in the registry").toBeGreaterThan(0);
  });
});
