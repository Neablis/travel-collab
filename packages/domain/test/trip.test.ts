import { describe, expect, it } from "vitest";
import { decideCreateTrip, evolveTrip, type TripState } from "../src";

const TRIP_ID = "6e9a2c9e-3f7a-4b6e-9d3f-2b1a5c8d7e6f";
const cmd = { type: "CreateTrip", tripId: TRIP_ID, name: "Rome 2027" , forkedFrom: null} as const;

describe("decideCreateTrip", () => {
  it("emits TripCreated with the actor as createdBy on fresh state", () => {
    const decision = decideCreateTrip(null, cmd, { actorId: "user-1" });
    if (!decision.ok) throw new Error("expected ok");
    expect(decision.events).toEqual([
      {
        type: "TripCreated",
        version: 1,
        payload: { tripId: TRIP_ID, name: "Rome 2027", createdBy: "user-1", forkedFrom: null },
      },
    ]);
  });

  it("rejects when the trip already exists", () => {
    const existing: TripState = {
      tripId: TRIP_ID,
      name: "Rome 2027",
      members: [{ userId: "user-1", role: "owner" }],
      forkedFrom: null,
      startDate: null,
      days: [],
      backlog: [],
      activities: {},
      dismissedConflictIds: [],
      currency: "USD",
      budget: null,
      status: "active",
    };
    const decision = decideCreateTrip(existing, cmd, { actorId: "user-1" });
    expect(decision).toEqual({
      ok: false,
      rejection: {
        code: "trip-already-exists",
        message: "A trip with this id already exists.",
      },
    });
  });
});

describe("evolveTrip", () => {
  it("builds an empty board with the creator as the sole member", () => {
    const state = evolveTrip(null, {
      type: "TripCreated",
      version: 1,
      payload: { tripId: TRIP_ID, name: "Rome 2027", createdBy: "user-1", forkedFrom: null },
    });
    expect(state).toEqual({
      tripId: TRIP_ID,
      name: "Rome 2027",
      members: [{ userId: "user-1", role: "owner" }],
      forkedFrom: null,
      startDate: null,
      days: [],
      backlog: [],
      activities: {},
      dismissedConflictIds: [],
      currency: "USD",
      budget: null,
      status: "active",
    });
  });
});
