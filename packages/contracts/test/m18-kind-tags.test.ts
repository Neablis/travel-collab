import { describe, expect, it } from "vitest";
import { ActivityKind, ActivityTag, TripCommand, TripEvent } from "../src";

const TRIP = "7d9a1f8e-0000-4000-8000-00000000000a";
const A1 = "7d9a1f8e-0000-4000-8000-0000000000a1";

describe("M18 kind & tags contracts", () => {
  it("ActivityKind accepts the five workflow states and rejects anything else", () => {
    for (const k of ["booked", "hold", "idea", "transit", "planned"]) {
      expect(ActivityKind.parse(k)).toBe(k);
    }
    expect(() => ActivityKind.parse("considering")).toThrow();
    expect(() => ActivityKind.parse("Booked")).toThrow();
  });

  it("ActivityTag is the closed four-value vocabulary — considering/travel are kinds, not tags", () => {
    for (const t of ["meal", "lodging", "ticketed", "outdoors"]) {
      expect(ActivityTag.parse(t)).toBe(t);
    }
    expect(() => ActivityTag.parse("considering")).toThrow();
    expect(() => ActivityTag.parse("travel")).toThrow();
    expect(() => ActivityTag.parse("anything-freeform")).toThrow();
  });

  it("AddActivity carries kind and tags, both optional", () => {
    const full = TripCommand.parse({
      type: "AddActivity", tripId: TRIP, activityId: A1, title: "Den",
      kind: "booked", tags: ["meal"],
    });
    if (full.type !== "AddActivity") throw new Error("wrong type");
    expect(full.kind).toBe("booked");
    expect(full.tags).toEqual(["meal"]);

    const bare = TripCommand.parse({ type: "AddActivity", tripId: TRIP, activityId: A1, title: "Den" });
    if (bare.type !== "AddActivity") throw new Error("wrong type");
    expect(bare.kind).toBeUndefined();
    expect(bare.tags).toBeUndefined();
  });

  it("UpdateActivity carries kind and tags; neither is nullable (clear a kind by setting planned, tags by [])", () => {
    const set = TripCommand.parse({
      type: "UpdateActivity", tripId: TRIP, activityId: A1, kind: "planned" as const, tags: [],
    });
    if (set.type !== "UpdateActivity") throw new Error("wrong type");
    expect(set.kind).toBe("planned");
    expect(set.tags).toEqual([]);
    expect(() => TripCommand.parse({ type: "UpdateActivity", tripId: TRIP, activityId: A1, kind: null })).toThrow();
    expect(() => TripCommand.parse({ type: "UpdateActivity", tripId: TRIP, activityId: A1, tags: null })).toThrow();
  });

  it("previously-stored ActivityAdded/Updated events (no kind or tags) still parse, defaulting to planned and []", () => {
    const added = TripEvent.parse({
      type: "ActivityAdded", version: 1,
      payload: { tripId: TRIP, activityId: A1, dayId: null, title: "Den", timeWindow: null, location: null, notes: null, anchors: [], cost: null },
    });
    if (added.type !== "ActivityAdded") throw new Error("wrong type");
    expect(added.payload.kind).toBe("planned");
    expect(added.payload.tags).toEqual([]);

    const updated = TripEvent.parse({
      type: "ActivityUpdated", version: 1,
      payload: { tripId: TRIP, activityId: A1, title: "Den", timeWindow: null, location: null, notes: null, anchors: [], cost: null },
    });
    if (updated.type !== "ActivityUpdated") throw new Error("wrong type");
    expect(updated.payload.kind).toBe("planned");
    expect(updated.payload.tags).toEqual([]);
  });

  it("the events are still version 1 — this is an additive change, not a V2", () => {
    const e = TripEvent.parse({
      type: "ActivityAdded", version: 1,
      payload: { tripId: TRIP, activityId: A1, dayId: null, title: "Den", timeWindow: null, location: null, notes: null, anchors: [], cost: null, kind: "transit", tags: ["lodging"] },
    });
    expect(e.version).toBe(1);
  });
});
