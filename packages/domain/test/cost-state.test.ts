import { describe, expect, it } from "vitest";
import type { Money } from "@tc/contracts";
import { decideTripCommand, evolveTrip, tripDetailFromState, type TripState } from "../src";

const TRIP = "7d9a1f8e-0000-4000-8000-00000000000a";
const A1 = "7d9a1f8e-0000-4000-8000-0000000000a1";
const CTX = { actorId: "u1" };
const COST: Money = { amountMinor: 4200, currency: "USD" };

function baseState(): TripState {
  return {
    tripId: TRIP, name: "Rome", members: [{ userId: "u1", role: "owner" }], forkedFrom: null,
    startDate: null, days: [], backlog: [], activities: {},
    currency: "USD", budget: null, dismissedConflictIds: [],
    status: "active",
  };
}

function addWithCost(cost: Money): TripState {
  const d = decideTripCommand(baseState(), { type: "AddActivity", tripId: TRIP, activityId: A1, title: "Museum", cost }, CTX);
  if (!d.ok) throw new Error(d.rejection.code);
  return evolveTrip(baseState(), d.events[0]!);
}

describe("activity cost in domain state", () => {
  it("AddActivity carries cost into state; the detail exposes it", () => {
    const state = addWithCost(COST);
    expect(state.activities[A1]!.cost).toEqual(COST);
    expect(tripDetailFromState(state, "2026-07-10T00:00:00.000Z").activities[A1]!.cost).toEqual(COST);
  });

  it("UpdateActivity with omitted cost leaves it unchanged; explicit null clears", () => {
    let state = addWithCost(COST);
    const omit = decideTripCommand(state, { type: "UpdateActivity", tripId: TRIP, activityId: A1, title: "Renamed" }, CTX);
    if (!omit.ok) throw new Error(omit.rejection.code);
    state = evolveTrip(state, omit.events[0]!);
    expect(state.activities[A1]!.cost).toEqual(COST);
    const clear = decideTripCommand(state, { type: "UpdateActivity", tripId: TRIP, activityId: A1, cost: null }, CTX);
    if (!clear.ok) throw new Error(clear.rejection.code);
    expect(evolveTrip(state, clear.events[0]!).activities[A1]!.cost).toBeNull();
  });

  it("re-setting the identical cost is a no-op", () => {
    const state = addWithCost(COST);
    const decision = decideTripCommand(state, { type: "UpdateActivity", tripId: TRIP, activityId: A1, cost: { amountMinor: 4200, currency: "USD" } }, CTX);
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.rejection.code).toBe("no-op");
  });
});
