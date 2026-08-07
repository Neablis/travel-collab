import { describe, expect, it } from "vitest";
import { predictCommand, predictBatch } from "../src/predict";
import { tripDetailFromState } from "../src/trip/detail";
import type { TripState } from "../src/trip/state";

const tripId = "11111111-1111-1111-1111-111111111111";
const baseState: TripState = {
  tripId,
  name: "Rome",
  members: [{ userId: "u1", role: "owner" }],
  startDate: null,
  days: [{ dayId: "d1", activityIds: [] }],
  backlog: [],
  activities: {},
  dismissedConflictIds: [],
  currency: "USD",
  budget: null,
  status: "active",
};
const detail = () => tripDetailFromState(baseState, "2027-01-01T00:00:00.000Z");

describe("predictCommand", () => {
  it("applies a valid command and returns the new detail + description", () => {
    const r = predictCommand(detail(), { type: "AddDay", tripId, dayId: "d2" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.detail.days.map((d) => d.dayId)).toEqual(["d1", "d2"]);
    expect(r.description).toBe("Added Day 2");
  });

  it("rejects a command the decider rejects", () => {
    const r = predictCommand(detail(), { type: "MoveActivity", tripId, activityId: "nope", toDayId: "d1", position: 0 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.rejection.code).toBe("activity-not-found");
  });
});

describe("predictBatch", () => {
  it("folds commands into one description, all applied", () => {
    const r = predictBatch(detail(), [
      { type: "AddDay", tripId, dayId: "d2" },
      { type: "AddDay", tripId, dayId: "d3" },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.detail.days.map((d) => d.dayId)).toEqual(["d1", "d2", "d3"]);
    expect(r.description).toBe("Added Day 2; Added Day 3");
  });

  it("is all-or-nothing — a later invalid command rejects the whole batch", () => {
    const r = predictBatch(detail(), [
      { type: "AddDay", tripId, dayId: "d2" },
      { type: "RemoveDay", tripId, dayId: "ghost" },
    ]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.rejection.code).toBe("day-not-found");
  });
});
