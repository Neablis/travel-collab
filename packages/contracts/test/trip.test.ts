import { describe, expect, it } from "vitest";
import {
  BatchableCommand,
  CreateTrip,
  DeleteTrip,
  RestoreTrip,
  SetTripDates,
  SetTripName,
  TripCommand,
  TripEvent,
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
