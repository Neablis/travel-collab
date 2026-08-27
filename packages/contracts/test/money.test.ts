import { describe, expect, it } from "vitest";
import { Money, TripCommand, TripEvent, TripDetail } from "../src";

const TRIP = "7d9a1f8e-0000-4000-8000-00000000000a";
const A1 = "7d9a1f8e-0000-4000-8000-0000000000a1";
const DAY = "7d9a1f8e-0000-4000-8000-00000000000d";

describe("M4 money contracts", () => {
  it("parses Money and rejects floats / bad currency codes", () => {
    expect(Money.parse({ amountMinor: 4200, currency: "USD" }).amountMinor).toBe(4200);
    expect(() => Money.parse({ amountMinor: 42.5, currency: "USD" })).toThrow();
    expect(() => Money.parse({ amountMinor: -1, currency: "USD" })).toThrow();
    expect(() => Money.parse({ amountMinor: 100, currency: "usd" })).toThrow();
  });

  it("AddActivity/UpdateActivity carry a cost; UpdateActivity can clear it with null", () => {
    const add = TripCommand.parse({ type: "AddActivity", tripId: TRIP, activityId: A1, title: "Museum", cost: { amountMinor: 4200, currency: "USD" } });
    expect(add.type).toBe("AddActivity");
    const clear = TripCommand.parse({ type: "UpdateActivity", tripId: TRIP, activityId: A1, cost: null });
    expect(clear.type).toBe("UpdateActivity");
  });

  it("SetTripCurrency and SetTripBudget parse (budget nullable to clear)", () => {
    expect(TripCommand.parse({ type: "SetTripCurrency", tripId: TRIP, currency: "EUR" }).type).toBe("SetTripCurrency");
    expect(TripCommand.parse({ type: "SetTripBudget", tripId: TRIP, budget: { amountMinor: 250000, currency: "EUR" } }).type).toBe("SetTripBudget");
    expect(TripCommand.parse({ type: "SetTripBudget", tripId: TRIP, budget: null }).type).toBe("SetTripBudget");
  });

  it("TripCurrencySet/TripBudgetSet events parse", () => {
    expect(TripEvent.parse({ type: "TripCurrencySet", version: 1, payload: { tripId: TRIP, currency: "EUR" } }).type).toBe("TripCurrencySet");
    expect(TripEvent.parse({ type: "TripBudgetSet", version: 1, payload: { tripId: TRIP, budget: null } }).type).toBe("TripBudgetSet");
  });

  it("previously-stored ActivityAdded/Updated events (no cost field) still parse, defaulting to null", () => {
    const added = TripEvent.parse({ type: "ActivityAdded", version: 1, payload: { tripId: TRIP, activityId: A1, dayId: null, title: "Museum", timeWindow: null, location: null, notes: null, anchors: [] } });
    if (added.type !== "ActivityAdded") throw new Error("wrong type");
    expect(added.payload.cost).toBeNull();
    const updated = TripEvent.parse({ type: "ActivityUpdated", version: 1, payload: { tripId: TRIP, activityId: A1, title: "Museum", timeWindow: null, location: null, notes: null, anchors: [] } });
    if (updated.type !== "ActivityUpdated") throw new Error("wrong type");
    expect(updated.payload.cost).toBeNull();
  });

  it("TripDetail carries currency, budget, per-day + trip rollups", () => {
    const detail = {
      tripId: TRIP, name: "Rome", startDate: "2026-10-12", currency: "USD", budget: null, status: "active",
      members: [{ userId: "u1", role: "owner" }],
      days: [{ dayId: DAY, activityIds: [A1], date: "2026-10-12", costSubtotal: 4200 }],
      backlog: [], unscheduledCostSubtotal: 0, tripCostTotal: 4200, budgetRemaining: null,
      conflicts: [], dismissedConflictIds: [], createdAt: "2026-07-10T00:00:00.000Z",
      activities: { [A1]: { activityId: A1, title: "Museum", timeWindow: null, location: null, notes: null, anchors: [], kind: "planned", tags: [], cost: { amountMinor: 4200, currency: "USD" } } },
    };
    expect(TripDetail.parse(detail).tripCostTotal).toBe(4200);
  });
});
