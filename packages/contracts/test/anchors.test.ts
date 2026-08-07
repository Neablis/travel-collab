import { describe, expect, it } from "vitest";
import {
  Anchor,
  Location,
  TripCommand,
  TripEvent,
  TripDetail,
} from "../src";

const TRIP = "7d9a1f8e-0000-4000-8000-00000000000a";
const A1 = "7d9a1f8e-0000-4000-8000-0000000000a1";
const DAY = "7d9a1f8e-0000-4000-8000-00000000000d";

describe("M3 anchor + place/time contracts", () => {
  it("parses every anchor kind and rejects a backwards dateRange", () => {
    expect(Anchor.parse({ kind: "dayOfWeek", days: ["mon", "tue"] }).kind).toBe("dayOfWeek");
    expect(Anchor.parse({ kind: "dateRange", from: "2026-10-31", to: "2026-10-31" }).kind).toBe("dateRange");
    expect(Anchor.parse({ kind: "timeOfDay", window: { start: "08:00", end: "13:00" } }).kind).toBe("timeOfDay");
    expect(Anchor.parse({ kind: "publicHoliday", country: "FR" }).kind).toBe("publicHoliday");
    expect(() => Anchor.parse({ kind: "dateRange", from: "2026-10-31", to: "2026-10-01" })).toThrow();
    expect(() => Anchor.parse({ kind: "publicHoliday", country: "fra" })).toThrow();
  });

  it("Location accepts an optional uppercase countryCode", () => {
    expect(Location.parse({ name: "Rome", lat: 41.9, lng: 12.5, countryCode: "IT" }).countryCode).toBe("IT");
    expect(Location.parse({ name: "Rome" }).countryCode).toBeUndefined();
  });

  it("AddActivity/UpdateActivity carry anchors", () => {
    const add = TripCommand.parse({
      type: "AddActivity", tripId: TRIP, activityId: A1, title: "Market",
      anchors: [{ kind: "timeOfDay", window: { start: "08:00", end: "13:00" } }],
    });
    expect(add.type).toBe("AddActivity");
    const upd = TripCommand.parse({ type: "UpdateActivity", tripId: TRIP, activityId: A1, anchors: [] });
    expect(upd.type).toBe("UpdateActivity");
  });

  it("previously-stored ActivityAdded/Updated events (no anchors field) still parse, defaulting to []", () => {
    const added = TripEvent.parse({
      type: "ActivityAdded", version: 1,
      payload: { tripId: TRIP, activityId: A1, dayId: null, title: "Market", timeWindow: null, location: null, notes: null },
    });
    if (added.type !== "ActivityAdded") throw new Error("wrong type");
    expect(added.payload.anchors).toEqual([]);
    const updated = TripEvent.parse({
      type: "ActivityUpdated", version: 1,
      payload: { tripId: TRIP, activityId: A1, title: "Market", timeWindow: null, location: null, notes: null },
    });
    if (updated.type !== "ActivityUpdated") throw new Error("wrong type");
    expect(updated.payload.anchors).toEqual([]);
  });

  it("TripDetail day carries a nullable derived date and activity carries anchors", () => {
    const detail = {
      tripId: TRIP, name: "Rome", startDate: "2026-10-12", currency: "USD", budget: null, status: "active",
      members: [{ userId: "u1", role: "owner" }],
      days: [{ dayId: DAY, activityIds: [A1], date: "2026-10-12", costSubtotal: 0 }],
      backlog: [], conflicts: [], dismissedConflictIds: [], createdAt: "2026-07-09T00:00:00.000Z",
      unscheduledCostSubtotal: 0, tripCostTotal: 0, budgetRemaining: null,
      activities: { [A1]: { activityId: A1, title: "Market", timeWindow: null, location: null, notes: null, anchors: [], cost: null } },
    };
    expect(TripDetail.parse(detail).days[0]!.date).toBe("2026-10-12");
  });
});
