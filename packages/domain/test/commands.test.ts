import { describe, expect, it } from "vitest";
import type { TripCommand, TripEvent } from "@tc/contracts";
import { decideTripCommand, evolveTrip, type Decision, type TripState } from "../src";

const TRIP = "6e9a2c9e-3f7a-4b6e-9d3f-2b1a5c8d7e6f";
const DAY = "7f8b3d0f-4a8b-4c7f-8e4a-3c2b6d9e8f70";
const ACT = "9a0c4e1f-5b9c-4d8f-9f5b-4d3c7e0f9a81";

function fold(events: TripEvent[]): TripState {
  let state: TripState | null = null;
  for (const event of events) state = evolveTrip(state, event);
  if (state === null) throw new Error("no events");
  return state;
}

function run(state: TripState | null, command: TripCommand): Decision {
  return decideTripCommand(state, command, { actorId: "user-1" });
}

const base = fold([
  { type: "TripCreated", version: 1, payload: { tripId: TRIP, name: "Rome 2027", createdBy: "user-1" } },
  { type: "DayAdded", version: 1, payload: { tripId: TRIP, dayId: DAY } },
]);

const withActivity = evolveTrip(base, {
  type: "ActivityAdded",
  version: 1,
  payload: { tripId: TRIP, activityId: ACT, dayId: null, title: "Colosseum", timeWindow: null, location: null, notes: null, anchors: [], cost: null },
});

describe("decideTripCommand", () => {
  it("rejects any non-create command on a missing trip", () => {
    const decision = run(null, { type: "AddDay", tripId: TRIP, dayId: DAY });
    expect(decision).toMatchObject({ ok: false, rejection: { code: "trip-not-found" } });
  });

  it("dispatches CreateTrip to the M0 handler", () => {
    const decision = run(null, { type: "CreateTrip", tripId: TRIP, name: "Rome 2027" });
    expect(decision.ok).toBe(true);
  });

  it("adds a day, rejecting duplicates", () => {
    const ok = run(base, { type: "AddDay", tripId: TRIP, dayId: ACT });
    if (!ok.ok) throw new Error("expected ok");
    expect(ok.events).toEqual([{ type: "DayAdded", version: 1, payload: { tripId: TRIP, dayId: ACT } }]);
    const dup = run(base, { type: "AddDay", tripId: TRIP, dayId: DAY });
    expect(dup).toMatchObject({ ok: false, rejection: { code: "day-already-exists" } });
  });

  it("removes a day, rejecting unknown ids", () => {
    const ok = run(base, { type: "RemoveDay", tripId: TRIP, dayId: DAY });
    if (!ok.ok) throw new Error("expected ok");
    expect(ok.events).toEqual([{ type: "DayRemoved", version: 1, payload: { tripId: TRIP, dayId: DAY } }]);
    const missing = run(base, { type: "RemoveDay", tripId: TRIP, dayId: ACT });
    expect(missing).toMatchObject({ ok: false, rejection: { code: "day-not-found" } });
  });

  it("sets and clears the start date", () => {
    const set = run(base, { type: "SetTripStartDate", tripId: TRIP, startDate: "2027-05-01" });
    if (!set.ok) throw new Error("expected ok");
    expect(set.events).toEqual([
      { type: "TripStartDateSet", version: 1, payload: { tripId: TRIP, startDate: "2027-05-01" } },
    ]);
  });

  it("normalizes omitted AddActivity fields to explicit nulls in the event", () => {
    const decision = run(base, { type: "AddActivity", tripId: TRIP, activityId: ACT, title: "Colosseum" });
    if (!decision.ok) throw new Error("expected ok");
    expect(decision.events).toEqual([
      {
        type: "ActivityAdded",
        version: 1,
        payload: { tripId: TRIP, activityId: ACT, dayId: null, title: "Colosseum", timeWindow: null, location: null, notes: null, anchors: [], cost: null },
      },
    ]);
  });

  it("rejects AddActivity onto an unknown day or with a duplicate id", () => {
    const badDay = run(base, { type: "AddActivity", tripId: TRIP, activityId: ACT, title: "x", dayId: ACT });
    expect(badDay).toMatchObject({ ok: false, rejection: { code: "day-not-found" } });
    const dup = run(withActivity, { type: "AddActivity", tripId: TRIP, activityId: ACT, title: "x" });
    expect(dup).toMatchObject({ ok: false, rejection: { code: "activity-already-exists" } });
  });

  it("UpdateActivity merges: omitted keeps, null clears, and snapshots the result", () => {
    const timed = evolveTrip(withActivity, {
      type: "ActivityUpdated",
      version: 1,
      payload: { tripId: TRIP, activityId: ACT, title: "Colosseum", timeWindow: { start: "09:00", end: "11:00" }, location: null, notes: null, anchors: [], cost: null },
    });
    const decision = run(timed, { type: "UpdateActivity", tripId: TRIP, activityId: ACT, notes: "book ahead" });
    if (!decision.ok) throw new Error("expected ok");
    expect(decision.events).toEqual([
      {
        type: "ActivityUpdated",
        version: 1,
        payload: {
          tripId: TRIP,
          activityId: ACT,
          title: "Colosseum",
          timeWindow: { start: "09:00", end: "11:00" }, // kept (omitted)
          location: null,
          notes: "book ahead",
          anchors: [], // kept (omitted)
          cost: null, // kept (omitted)
        },
      },
    ]);
    const cleared = run(timed, { type: "UpdateActivity", tripId: TRIP, activityId: ACT, timeWindow: null });
    if (!cleared.ok) throw new Error("expected ok");
    expect(cleared.events[0]).toMatchObject({ payload: { timeWindow: null } });
  });

  it("MoveActivity validates the activity and the target day", () => {
    const ok = run(withActivity, { type: "MoveActivity", tripId: TRIP, activityId: ACT, toDayId: DAY, position: 0 });
    if (!ok.ok) throw new Error("expected ok");
    expect(ok.events).toEqual([
      { type: "ActivityMoved", version: 1, payload: { tripId: TRIP, activityId: ACT, toDayId: DAY, position: 0 } },
    ]);
    const badActivity = run(base, { type: "MoveActivity", tripId: TRIP, activityId: ACT, toDayId: null, position: 0 });
    expect(badActivity).toMatchObject({ ok: false, rejection: { code: "activity-not-found" } });
    const badDay = run(withActivity, { type: "MoveActivity", tripId: TRIP, activityId: ACT, toDayId: ACT, position: 0 });
    expect(badDay).toMatchObject({ ok: false, rejection: { code: "day-not-found" } });
  });

  it("RemoveActivity validates the activity", () => {
    const ok = run(withActivity, { type: "RemoveActivity", tripId: TRIP, activityId: ACT });
    expect(ok.ok).toBe(true);
    const missing = run(base, { type: "RemoveActivity", tripId: TRIP, activityId: ACT });
    expect(missing).toMatchObject({ ok: false, rejection: { code: "activity-not-found" } });
  });
});
