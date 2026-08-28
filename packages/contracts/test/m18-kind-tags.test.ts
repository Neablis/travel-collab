import { describe, expect, it } from "vitest";
import { ActivityKind, ActivityTag, TripCommand, TripDetail, TripEvent } from "../src";

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

// The board 500ed on the #71 preview for a trip nobody had touched since M18:
// GET /api/trips/:id → ZodError, `kind` Required. Not a missing migration —
// `trip_details.doc` is stored jsonb that `getTripDetail` returns RAW and the
// route parses, and a document written before M18 carries neither `kind` nor
// `tags`. Those rows are only rewritten when their trip next changes, so the
// contract has to read them as they are.
//
// The document below is the EXACT pre-M18 activity shape, taken from
// `packages/contracts/src/detail.ts` as it stands on `main` before #63:
// activityId, title, timeWindow, location, notes, anchors, cost — and nothing
// else. Adding a field to this fixture defeats the point of it.
describe("a projection document written before M18 still reads", () => {
  const TRIP = "6e9a2c9e-3f7a-4b6e-9d3f-2b1a5c8d7e6f";
  const DAY = "11111111-1111-4111-8111-111111111111";
  const ACT = "22222222-2222-4222-8222-222222222222";

  const legacyDoc = {
    tripId: TRIP,
    name: "Rome 2027",
    startDate: "2027-05-01",
    currency: "USD",
    budget: null,
    status: "active",
    members: [{ userId: "dev-alice", role: "owner" }],
    days: [{ dayId: DAY, activityIds: [ACT], date: "2027-05-01", costSubtotal: 0 }],
    backlog: [],
    activities: {
      [ACT]: {
        activityId: ACT,
        title: "Colosseum",
        timeWindow: { start: "09:00", end: "11:00" },
        location: { name: "Rome", lat: 41.9, lng: 12.5 },
        notes: null,
        anchors: [],
        cost: null,
      },
    },
    conflicts: [],
    dismissedConflictIds: [],
    createdAt: "2026-07-08T12:00:00.000Z",
    unscheduledCostSubtotal: 0,
    tripCostTotal: 0,
    budgetRemaining: null,
  };

  it("parses, rather than 500ing the board", () => {
    expect(() => TripDetail.parse(legacyDoc)).not.toThrow();
  });

  it("reads the absent fields as the zero values the rest of the stack uses", () => {
    const detail = TripDetail.parse(legacyDoc);
    // "planned" and [] are what `AddActivity` documents as "omitted =", what
    // both event payloads already `.default()` to, and what `state.ts` calls
    // the zero value. The read model now agrees with all three.
    expect(detail.activities[ACT]!.kind).toBe("planned");
    expect(detail.activities[ACT]!.tags).toEqual([]);
  });

  it("still does not invent a kind that was explicitly stored", () => {
    const stored = {
      ...legacyDoc,
      activities: { [ACT]: { ...legacyDoc.activities[ACT], kind: "booked", tags: ["meal"] } },
    };
    const detail = TripDetail.parse(stored);
    expect(detail.activities[ACT]!.kind).toBe("booked");
    expect(detail.activities[ACT]!.tags).toEqual(["meal"]);
  });
});
