import { describe, expect, it } from "vitest";
import {
  BatchableCommand,
  CreateTrip,
  DeleteTrip,
  RestoreTrip,
  SetTripDates,
  SetTripName,
  TripCommand,
  TripCreatedV1,
  TripDetail,
  TripEvent,
  TripLineage,
  TripMember,
  TripRole,
  TripSummary,
} from "../src";

describe("trip contracts", () => {
  it("parses a valid CreateTrip command", () => {
    const cmd = CreateTrip.parse({
      type: "CreateTrip",
      tripId: "6e9a2c9e-3f7a-4b6e-9d3f-2b1a5c8d7e6f",
      name: "Rome 2027",
    });
    expect(cmd.name).toBe("Rome 2027");
  });

  it("rejects an empty trip name", () => {
    expect(() =>
      CreateTrip.parse({
        type: "CreateTrip",
        tripId: "6e9a2c9e-3f7a-4b6e-9d3f-2b1a5c8d7e6f",
        name: "",
      }),
    ).toThrow();
  });

  it("parses TripCreated v1 and requires createdBy", () => {
    const ok = TripEvent.parse({
      type: "TripCreated",
      version: 1,
      payload: {
        tripId: "6e9a2c9e-3f7a-4b6e-9d3f-2b1a5c8d7e6f",
        name: "Rome 2027",
        createdBy: "user-1",
      },
    });
    if (ok.type !== "TripCreated") throw new Error("expected TripCreated");
    expect(ok.payload.createdBy).toBe("user-1");
    expect(() =>
      TripEvent.parse({
        type: "TripCreated",
        version: 1,
        payload: { tripId: "6e9a2c9e-3f7a-4b6e-9d3f-2b1a5c8d7e6f", name: "x" },
      }),
    ).toThrow();
  });

  it("accepts the three roles and nothing else", () => {
    expect(TripRole.options).toEqual(["viewer", "editor", "owner"]);
    expect(TripMember.safeParse({ userId: "u1", role: "editor" }).success).toBe(true);
    expect(TripMember.safeParse({ userId: "u1", role: "viewer" }).success).toBe(true);
    expect(TripMember.safeParse({ userId: "u1", role: "admin" }).success).toBe(false);
  });

  // Every `members` value already persisted in the trip_summaries /
  // trip_details jsonb was written under `z.literal("owner")`. Widening to an
  // enum that contains it has to stay backwards compatible or the projection
  // rebuild stops parsing eight milestones of rows.
  it("still parses a member persisted before roles existed", () => {
    expect(TripMember.parse({ userId: "dev-alice", role: "owner" })).toEqual({
      userId: "dev-alice",
      role: "owner",
    });
  });

  it("requires at least one member on TripSummary", () => {
    expect(() =>
      TripSummary.parse({
        tripId: "6e9a2c9e-3f7a-4b6e-9d3f-2b1a5c8d7e6f",
        name: "Rome 2027",
        members: [],
        createdAt: new Date().toISOString(),
      }),
    ).toThrow();
  });
});

describe("lifecycle commands", () => {
  const tripId = "11111111-1111-4111-8111-111111111111";
  const dayId = "22222222-2222-4222-8222-222222222222";

  it("accepts SetTripName within name bounds", () => {
    expect(SetTripName.safeParse({ type: "SetTripName", tripId, name: "Japan" }).success).toBe(true);
    expect(SetTripName.safeParse({ type: "SetTripName", tripId, name: "" }).success).toBe(false);
  });

  it("accepts SetTripDates with ISO dates and new day ids", () => {
    const ok = SetTripDates.safeParse({
      type: "SetTripDates",
      tripId,
      startDate: "2026-07-07",
      endDate: "2026-07-13",
      newDayIds: [dayId],
    });
    expect(ok.success).toBe(true);
  });

  it("rejects a non-ISO date", () => {
    expect(
      SetTripDates.safeParse({
        type: "SetTripDates",
        tripId,
        startDate: "07/07/2026",
        endDate: null,
        newDayIds: [],
      }).success,
    ).toBe(false);
  });

  it("defaults newDayIds to an empty array", () => {
    const parsed = SetTripDates.parse({ type: "SetTripDates", tripId, startDate: null, endDate: null });
    expect(parsed.newDayIds).toEqual([]);
  });

  it("accepts DeleteTrip and RestoreTrip", () => {
    expect(DeleteTrip.safeParse({ type: "DeleteTrip", tripId }).success).toBe(true);
    expect(RestoreTrip.safeParse({ type: "RestoreTrip", tripId }).success).toBe(true);
  });

  it("puts name and dates in BatchableCommand but never delete or restore", () => {
    const types = BatchableCommand.options.map((o) => o.shape.type.value);
    expect(types).toContain("SetTripName");
    expect(types).toContain("SetTripDates");
    expect(types).not.toContain("DeleteTrip");
    expect(types).not.toContain("RestoreTrip");
  });

  it("puts every lifecycle command in TripCommand and every event in TripEvent", () => {
    const commands = TripCommand.options.map((o) => o.shape.type.value);
    expect(commands).toEqual(expect.arrayContaining(["SetTripName", "SetTripDates", "DeleteTrip", "RestoreTrip"]));
    const events = TripEvent.options.map((o) => o.shape.type.value);
    expect(events).toEqual(expect.arrayContaining(["TripNameSet", "TripDeleted", "TripRestored"]));
  });
});

// M11 link 5 — the lineage pointer the foundation design has always listed as
// part of a Trip ("lineage pointer (`forkedFrom: {tripId, atSeq}`)").
describe("TripLineage", () => {
  const lineage = {
    tripId: "6e9a2c9e-3f7a-4b6e-9d3f-2b1a5c8d7e6f",
    atSeq: 4,
    name: "Kyoto in spring",
  };

  it("round-trips", () => {
    expect(TripLineage.parse(lineage)).toEqual(lineage);
  });

  it("rejects a history point before the first event", () => {
    expect(TripLineage.safeParse({ ...lineage, atSeq: 0 }).success).toBe(false);
  });

  // The name is a SNAPSHOT of what the ancestor was called at fork time, so
  // it has to be present — an empty one would render as "Copied from """.
  it("requires the remembered name", () => {
    expect(TripLineage.safeParse({ ...lineage, name: "" }).success).toBe(false);
  });

  // Both of these are what makes the change additive against a live database:
  // every CreateTrip a client sends and every TripCreated already in `events`
  // omits the key, and a DEFAULT (not `.optional()`) makes them all parse to
  // one shape — explicit null — rather than two.
  it("defaults to null on CreateTrip", () => {
    expect(
      CreateTrip.parse({ type: "CreateTrip", tripId: lineage.tripId, name: "Fresh" }).forkedFrom,
    ).toBeNull();
  });

  it("defaults to null on a TripCreated event written before it existed", () => {
    const legacy = {
      type: "TripCreated",
      version: 1,
      payload: { tripId: lineage.tripId, name: "Old", createdBy: "dev-alice" },
    };
    expect(TripCreatedV1.parse(legacy).payload.forkedFrom).toBeNull();
  });

  it("defaults to null on a TripDetail projected before it existed", () => {
    const stored = {
      tripId: lineage.tripId,
      name: "Old",
      status: "active",
      startDate: null,
      currency: "USD",
      budget: null,
      members: [{ userId: "dev-alice", role: "owner" }],
      days: [],
      backlog: [],
      activities: {},
      conflicts: [],
      dismissedConflictIds: [],
      createdAt: "2026-07-08T12:00:00.000Z",
      unscheduledCostSubtotal: 0,
      tripCostTotal: 0,
      budgetRemaining: null,
    };
    expect(TripDetail.parse(stored).forkedFrom).toBeNull();
  });

  it("carries lineage through when it is there", () => {
    const created = TripCreatedV1.parse({
      type: "TripCreated",
      version: 1,
      payload: {
        tripId: lineage.tripId,
        name: "Copy",
        createdBy: "dev-bob",
        forkedFrom: lineage,
      },
    });
    expect(created.payload.forkedFrom).toEqual(lineage);
  });
});
