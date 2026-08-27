import { describe, expect, it } from "vitest";
import { decideTripCommand, evolveTrip, type DecideContext, type TripState } from "../src";
import type { TripCommand } from "@tc/contracts";

const CTX: DecideContext = { actorId: "u1" };
const TRIP = "7d9a1f8e-0000-4000-8000-00000000000a";
const A1 = "7d9a1f8e-0000-4000-8000-0000000000a1";

// A trip with no days and no activities, built the way decide.test.ts does it.
function newTrip(): TripState {
  return evolveTrip(null, {
    type: "TripCreated",
    version: 1,
    payload: { tripId: TRIP, name: "Japan", createdBy: "u1" },
  });
}

// decide + fold, so each test reads as "issue this command, look at the state".
function apply(state: TripState, command: TripCommand): TripState {
  const d = decideTripCommand(state, command, CTX);
  if (!d.ok) throw new Error(`expected ok, got rejection: ${d.rejection.code}`);
  return d.events.reduce(evolveTrip, state);
}

describe("M18 domain: kind & tags on the write path", () => {
  it("AddActivity without a kind lands as planned with no tags", () => {
    const state = apply(newTrip(), { type: "AddActivity", tripId: TRIP, activityId: A1, title: "Den" });
    expect(state.activities[A1]!.kind).toBe("planned");
    expect(state.activities[A1]!.tags).toEqual([]);
  });

  it("AddActivity carries an explicit kind and tags into state", () => {
    const state = apply(newTrip(), {
      type: "AddActivity", tripId: TRIP, activityId: A1, title: "Den", kind: "booked", tags: ["meal"],
    });
    expect(state.activities[A1]!.kind).toBe("booked");
    expect(state.activities[A1]!.tags).toEqual(["meal"]);
  });

  it("UpdateActivity leaves an omitted kind and omitted tags unchanged", () => {
    const before = apply(newTrip(), {
      type: "AddActivity", tripId: TRIP, activityId: A1, title: "Den", kind: "hold", tags: ["meal"],
    });
    const after = apply(before, { type: "UpdateActivity", tripId: TRIP, activityId: A1, title: "Den Kyoto" });
    expect(after.activities[A1]!.kind).toBe("hold");
    expect(after.activities[A1]!.tags).toEqual(["meal"]);
  });

  it("UpdateActivity replaces the whole tag array, like anchors", () => {
    const before = apply(newTrip(), {
      type: "AddActivity", tripId: TRIP, activityId: A1, title: "Den", tags: ["meal", "ticketed"],
    });
    const after = apply(before, { type: "UpdateActivity", tripId: TRIP, activityId: A1, tags: ["outdoors"] });
    expect(after.activities[A1]!.tags).toEqual(["outdoors"]);
  });

  it("changing ONLY the kind is a real change, not a rejected no-op", () => {
    const before = apply(newTrip(), { type: "AddActivity", tripId: TRIP, activityId: A1, title: "Den" });
    const d = decideTripCommand(before, { type: "UpdateActivity", tripId: TRIP, activityId: A1, kind: "booked" }, CTX);
    expect(d.ok).toBe(true); // must NOT be rejected with code "no-op"
    const after = apply(before, { type: "UpdateActivity", tripId: TRIP, activityId: A1, kind: "booked" });
    expect(after.activities[A1]!.kind).toBe("booked");
  });

  it("changing ONLY the tags is a real change, not a rejected no-op", () => {
    const before = apply(newTrip(), { type: "AddActivity", tripId: TRIP, activityId: A1, title: "Den" });
    const d = decideTripCommand(before, { type: "UpdateActivity", tripId: TRIP, activityId: A1, tags: ["meal"] }, CTX);
    expect(d.ok).toBe(true);
  });

  it("setting the kind to the value it already has IS a no-op", () => {
    const before = apply(newTrip(), { type: "AddActivity", tripId: TRIP, activityId: A1, title: "Den", kind: "booked" });
    const d = decideTripCommand(before, { type: "UpdateActivity", tripId: TRIP, activityId: A1, kind: "booked" }, CTX);
    expect(d.ok).toBe(false);
    expect(d.ok === false && d.rejection.code).toBe("no-op");
  });
});
