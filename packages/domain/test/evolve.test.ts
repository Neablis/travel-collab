import { describe, expect, it } from "vitest";
import type { TripEvent } from "@tc/contracts";
import { evolveTrip, type TripState } from "../src";

const TRIP = "6e9a2c9e-3f7a-4b6e-9d3f-2b1a5c8d7e6f";
const DAY_A = "7f8b3d0f-4a8b-4c7f-8e4a-3c2b6d9e8f70";
const DAY_B = "8a9c4e10-5b9c-4d80-9f5b-4d3c7e0f9a81";
const ACT = "9a0c4e1f-5b9c-4d8f-9f5b-4d3c7e0f9a81";

const created: TripEvent = {
  type: "TripCreated",
  version: 1,
  payload: { tripId: TRIP, name: "Rome 2027", createdBy: "user-1", forkedFrom: null },
};

function fold(events: TripEvent[]): TripState {
  let state: TripState | null = null;
  for (const event of events) state = evolveTrip(state, event);
  if (state === null) throw new Error("no events");
  return state;
}

const addActivity: TripEvent = {
  type: "ActivityAdded",
  version: 1,
  payload: {
    tripId: TRIP,
    activityId: ACT,
    dayId: null,
    title: "Colosseum",
    timeWindow: { start: "09:00", end: "11:00" },
    location: null,
    notes: null,
    anchors: [],
    kind: "planned" as const,
    tags: [],
    cost: null,
  },
};

describe("evolveTrip (M1 events)", () => {
  it("adds days in order and sets/clears the display-only start date", () => {
    const state = fold([
      created,
      { type: "DayAdded", version: 1, payload: { tripId: TRIP, dayId: DAY_A } },
      { type: "DayAdded", version: 1, payload: { tripId: TRIP, dayId: DAY_B } },
      { type: "TripStartDateSet", version: 1, payload: { tripId: TRIP, startDate: "2027-05-01" } },
    ]);
    expect(state.days).toEqual([
      { dayId: DAY_A, activityIds: [] },
      { dayId: DAY_B, activityIds: [] },
    ]);
    expect(state.startDate).toBe("2027-05-01");
    const cleared = evolveTrip(state, {
      type: "TripStartDateSet",
      version: 1,
      payload: { tripId: TRIP, startDate: null },
    });
    expect(cleared.startDate).toBeNull();
  });

  it("adds an activity to the backlog and moves it onto a day at a position", () => {
    const state = fold([
      created,
      { type: "DayAdded", version: 1, payload: { tripId: TRIP, dayId: DAY_A } },
      addActivity,
      { type: "ActivityMoved", version: 1, payload: { tripId: TRIP, activityId: ACT, toDayId: DAY_A, position: 0 } },
    ]);
    expect(state.backlog).toEqual([]);
    expect(state.days).toEqual([{ dayId: DAY_A, activityIds: [ACT] }]);
    expect(state.activities[ACT]).toEqual({
      title: "Colosseum",
      timeWindow: { start: "09:00", end: "11:00" },
      location: null,
      notes: null,
      anchors: [],
      kind: "planned" as const,
      tags: [],
      cost: null,
    });
  });

  it("clamps an out-of-range move position instead of throwing", () => {
    const state = fold([
      created,
      { type: "DayAdded", version: 1, payload: { tripId: TRIP, dayId: DAY_A } },
      addActivity,
      { type: "ActivityMoved", version: 1, payload: { tripId: TRIP, activityId: ACT, toDayId: DAY_A, position: 99 } },
    ]);
    expect(state.days).toEqual([{ dayId: DAY_A, activityIds: [ACT] }]);
  });

  it("replaces the field snapshot on ActivityUpdated", () => {
    const state = fold([
      created,
      addActivity,
      {
        type: "ActivityUpdated",
        version: 1,
        payload: { tripId: TRIP, activityId: ACT, title: "Colosseum tour", timeWindow: null, location: null, notes: "book ahead", anchors: [], kind: "planned" as const, tags: [], cost: null },
      },
    ]);
    expect(state.activities[ACT]).toEqual({
      title: "Colosseum tour",
      timeWindow: null,
      location: null,
      notes: "book ahead",
      anchors: [],
      kind: "planned" as const,
      tags: [],
      cost: null,
    });
  });

  it("returns a removed day's activities to the backlog", () => {
    const state = fold([
      created,
      { type: "DayAdded", version: 1, payload: { tripId: TRIP, dayId: DAY_A } },
      addActivity,
      { type: "ActivityMoved", version: 1, payload: { tripId: TRIP, activityId: ACT, toDayId: DAY_A, position: 0 } },
      { type: "DayRemoved", version: 1, payload: { tripId: TRIP, dayId: DAY_A } },
    ]);
    expect(state.days).toEqual([]);
    expect(state.backlog).toEqual([ACT]);
  });

  it("removes an activity everywhere", () => {
    const state = fold([
      created,
      addActivity,
      { type: "ActivityRemoved", version: 1, payload: { tripId: TRIP, activityId: ACT } },
    ]);
    expect(state.backlog).toEqual([]);
    expect(state.activities).toEqual({});
  });

  it("throws the replay totality guard on an event before TripCreated", () => {
    expect(() =>
      evolveTrip(null, { type: "DayAdded", version: 1, payload: { tripId: TRIP, dayId: DAY_A } }),
    ).toThrow();
  });
});

// B2. `evolveTrip` already refuses to interpret a stream whose first event
// isn't TripCreated ("corrupt stream"). These close the same hole one level
// down: an activity event naming a day that doesn't exist used to be absorbed
// silently, leaving the activity in `state.activities` but in NO list — neither
// a day nor the backlog. Invisible in the UI, unreachable, undeletable.
// `decideTripCommand` rejects these before they can ever be written, so this is
// a replay-integrity guard, not a reachable user path: it must fail loudly
// rather than produce a plausible-looking wrong state.
describe("evolveTrip totality — activity events naming an unknown day", () => {
  const GHOST = "0d0d0d0d-1111-4222-8333-444444444444";
  const OTHER_ACT = "1b1b1b1b-2222-4333-8444-555555555555";

  it("throws when ActivityAdded targets a day that does not exist", () => {
    const state = fold([created, { type: "DayAdded", version: 1, payload: { tripId: TRIP, dayId: DAY_A } }]);

    expect(() =>
      evolveTrip(state, {
        type: "ActivityAdded",
        version: 1,
        payload: {
          tripId: TRIP,
          activityId: OTHER_ACT,
          dayId: GHOST,
          title: "Ghost",
          timeWindow: null,
          location: null,
          notes: null,
          anchors: [],
          kind: "planned" as const,
          tags: [],
          cost: null,
        },
      }),
    ).toThrow(/corrupt stream/i);
  });

  it("throws when ActivityMoved targets a day that does not exist", () => {
    const state = fold([
      created,
      { type: "DayAdded", version: 1, payload: { tripId: TRIP, dayId: DAY_A } },
      addActivity,
    ]);

    expect(() =>
      evolveTrip(state, {
        type: "ActivityMoved",
        version: 1,
        payload: { tripId: TRIP, activityId: ACT, toDayId: GHOST, position: 0 },
      }),
    ).toThrow(/corrupt stream/i);
  });

  it("still moves an activity to the backlog when toDayId is null", () => {
    const state = fold([
      created,
      { type: "DayAdded", version: 1, payload: { tripId: TRIP, dayId: DAY_A } },
      addActivity,
    ]);

    const next = evolveTrip(state, {
      type: "ActivityMoved",
      version: 1,
      payload: { tripId: TRIP, activityId: ACT, toDayId: null, position: 0 },
    });

    expect(next.backlog).toEqual([ACT]);
  });
});

describe("lifecycle events", () => {
  const tripId = "11111111-1111-4111-8111-111111111111";
  const created = evolveTrip(null, {
    type: "TripCreated", version: 1, payload: { tripId, name: "Japan", createdBy: "u1", forkedFrom: null },
  });

  it("starts a trip active", () => {
    expect(created.status).toBe("active");
  });

  it("renames without touching anything else", () => {
    const renamed = evolveTrip(created, {
      type: "TripNameSet", version: 1, payload: { tripId, name: "Japan 2027" },
    });
    expect(renamed.name).toBe("Japan 2027");
    expect(renamed.days).toEqual(created.days);
  });

  it("round-trips delete and restore", () => {
    const deleted = evolveTrip(created, { type: "TripDeleted", version: 1, payload: { tripId } });
    expect(deleted.status).toBe("deleted");
    const restored = evolveTrip(deleted, { type: "TripRestored", version: 1, payload: { tripId } });
    expect(restored.status).toBe("active");
    expect(restored).toEqual(created);
  });
});
