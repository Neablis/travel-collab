import { describe, expect, it } from "vitest";
import { diffTripStates, tripStatesEqual, type TripState } from "../src";

const TRIP = "7d9a1f8e-0000-4000-8000-00000000000a";
const A1 = "7d9a1f8e-0000-4000-8000-0000000000a1";
const DAY = "7d9a1f8e-0000-4000-8000-00000000000d";

const stateWith = (area: string | undefined): TripState => ({
  tripId: TRIP,
  name: "Japan",
  members: [{ userId: "u1", role: "owner" }],
  startDate: null,
  days: [{ dayId: DAY, activityIds: [A1] }],
  backlog: [],
  activities: {
    [A1]: {
      title: "Dinner at Gonpachi",
      timeWindow: null,
      // Same name/lat/lng/city in both states — `area` is the ONLY difference,
      // so nothing but an area-aware comparison can tell them apart.
      location: {
        name: "Gonpachi Nishiazabu, Nishi-Azabu, Tokyo, Japan",
        city: "Tokyo",
        lat: 35.6564,
        lng: 139.7238,
        ...(area === undefined ? {} : { area }),
      },
      notes: null,
      anchors: [],
      kind: "planned" as const,
      tags: [],
      cost: null,
    },
  },
  dismissedConflictIds: [],
  currency: "USD",
  budget: null,
  status: "active" as const,
});

// equality.ts compares Location field by field, so a contract field it forgets
// is a field diff() treats as unchanged — an edit that revert/undo silently
// keeps at its old value, with no failure anywhere to say so. That is the
// hand-enumeration trap KI-35's contract change had to walk past.
describe("KI-35 — `area` is part of activity equality", () => {
  it("two states differing only by location.area are not equal", () => {
    expect(tripStatesEqual(stateWith("Nishi-Azabu"), stateWith("Ebisu"))).toBe(false);
    expect(tripStatesEqual(stateWith(undefined), stateWith("Nishi-Azabu"))).toBe(false);
    expect(tripStatesEqual(stateWith("Nishi-Azabu"), stateWith("Nishi-Azabu"))).toBe(true);
  });

  it("diff emits an update for an area-only change, and replaying it lands on the target", () => {
    const current = stateWith("Nishi-Azabu");
    const target = stateWith("Ebisu");
    const events = diffTripStates(current, target);
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("ActivityUpdated");
    if (events[0]!.type !== "ActivityUpdated") throw new Error("wrong type");
    expect(events[0]!.payload.location?.area).toBe("Ebisu");
  });

  it("clearing an area is a change too", () => {
    const events = diffTripStates(stateWith("Nishi-Azabu"), stateWith(undefined));
    expect(events.map((e) => e.type)).toEqual(["ActivityUpdated"]);
  });
});
