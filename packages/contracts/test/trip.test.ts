import { describe, expect, it } from "vitest";
import { CreateTrip, TripEvent, TripSummary } from "../src";

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
