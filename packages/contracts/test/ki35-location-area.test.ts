import { describe, expect, it } from "vitest";
import { Location, TripCommand, TripDetail, TripEvent } from "../src";

const TRIP = "7d9a1f8e-0000-4000-8000-00000000000a";
const A1 = "7d9a1f8e-0000-4000-8000-0000000000a1";
const DAY = "7d9a1f8e-0000-4000-8000-00000000000d";

// A trip_details.doc exactly as the projection wrote it BEFORE Location grew
// `area` — no `area` key anywhere. `getTripDetail` returns this column as raw
// jsonb with no parse of its own, and the read route runs TripDetail.parse on
// it, so this document is what a trip nobody has touched since the change
// still has to survive. M18 shipped a required field into this same shape and
// 500'd every pre-M18 board (fix commit 8abbaa3); this test is the tripwire
// for repeating that.
const PRE_AREA_DOC = {
  tripId: TRIP,
  name: "Japan",
  status: "active",
  startDate: "2027-04-01",
  currency: "USD",
  budget: null,
  members: [{ userId: "u1", role: "owner" }],
  days: [{ dayId: DAY, activityIds: [A1], date: "2027-04-01", costSubtotal: 0 }],
  backlog: [],
  activities: {
    [A1]: {
      activityId: A1,
      title: "Dinner at Gonpachi",
      timeWindow: { start: "19:00", end: "20:30" },
      // The whole point: a location written before `area` existed.
      location: { name: "Gonpachi Nishiazabu, Nishi-Azabu, Tokyo, Japan", city: "Tokyo", lat: 35.6564, lng: 139.7238 },
      notes: null,
      anchors: [],
      kind: "hold",
      tags: [],
      cost: null,
    },
  },
  conflicts: [],
  dismissedConflictIds: [],
  createdAt: "2026-08-01T00:00:00.000Z",
  unscheduledCostSubtotal: 0,
  tripCostTotal: 0,
  budgetRemaining: null,
};

describe("KI-35 — Location.area", () => {
  it("is carried, and is bounded like city (non-empty, <= 200)", () => {
    expect(Location.parse({ name: "Gonpachi Nishiazabu", city: "Tokyo", area: "Nishi-Azabu" }).area).toBe("Nishi-Azabu");
    expect(Location.parse({ name: "Gonpachi Nishiazabu" }).area).toBeUndefined();
    expect(() => Location.parse({ name: "x", area: "" })).toThrow();
    expect(() => Location.parse({ name: "x", area: "a".repeat(201) })).toThrow();
  });

  it("area stands alone — a location may carry an area with no city (an unscheduled seed idea)", () => {
    const parsed = Location.parse({ name: "Kiyomizu-dera, Higashiyama, Japan", area: "Higashiyama" });
    expect(parsed.area).toBe("Higashiyama");
    expect(parsed.city).toBeUndefined();
  });

  it("survives the command and event shapes it has to round-trip through", () => {
    const add = TripCommand.parse({
      type: "AddActivity", tripId: TRIP, activityId: A1, title: "Den",
      location: { name: "Den, Jingūmae, Tokyo, Japan", city: "Tokyo", area: "Jingūmae" },
    });
    if (add.type !== "AddActivity") throw new Error("wrong type");
    expect(add.location?.area).toBe("Jingūmae");

    const added = TripEvent.parse({
      type: "ActivityAdded", version: 1,
      payload: {
        tripId: TRIP, activityId: A1, dayId: null, title: "Den",
        timeWindow: null, notes: null, anchors: [], kind: "planned", tags: [], cost: null,
        location: { name: "Den, Jingūmae, Tokyo, Japan", city: "Tokyo", area: "Jingūmae" },
      },
    });
    if (added.type !== "ActivityAdded") throw new Error("wrong type");
    expect(added.payload.location?.area).toBe("Jingūmae");
  });

  // The additive-against-a-live-database guarantee, stated as a test rather
  // than a comment: a stored projection with NO `area` key must still parse.
  it("a projection document written before `area` existed still parses", () => {
    const parsed = TripDetail.parse(PRE_AREA_DOC);
    expect(parsed.activities[A1]!.location?.area).toBeUndefined();
    expect(parsed.activities[A1]!.location?.city).toBe("Tokyo");
  });
});
