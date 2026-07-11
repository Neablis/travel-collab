import { describe, expect, it } from "vitest";
import type { TripCommand } from "@tc/contracts";
import { decideTripCommand, detectConflicts, evolveTrip, tripDetailFromState, type TripState } from "../src";

const TRIP = "7d9a1f8e-0000-4000-8000-00000000000a";
const DAY = "7d9a1f8e-0000-4000-8000-00000000000d";
const A1 = "7d9a1f8e-0000-4000-8000-0000000000a1";
const A2 = "7d9a1f8e-0000-4000-8000-0000000000a2";
const CTX = { actorId: "u1" };

// A state with one live time-overlap conflict.
function conflictedState(): TripState {
  return {
    tripId: TRIP,
    name: "Rome",
    members: [{ userId: "u1", role: "owner" }],
    startDate: null,
    days: [{ dayId: DAY, activityIds: [A1, A2] }],
    backlog: [],
    activities: {
      [A1]: { title: "Colosseum", timeWindow: { start: "09:00", end: "11:00" }, location: null, notes: null, anchors: [], cost: null },
      [A2]: { title: "Vatican", timeWindow: { start: "10:00", end: "12:00" }, location: null, notes: null, anchors: [], cost: null },
    },
    dismissedConflictIds: [],
    currency: "USD",
    budget: null,
  };
}

describe("conflict dismissal", () => {
  it("conflict ids are content-derived (deterministic across recomputation)", () => {
    const [first] = detectConflicts(conflictedState());
    const [second] = detectConflicts(conflictedState());
    expect(first).toBeDefined();
    expect(first!.id).toBe(second!.id);
  });

  it("DismissConflict emits ConflictDismissed for a live conflict", () => {
    const state = conflictedState();
    const conflictId = detectConflicts(state)[0]!.id;
    const decision = decideTripCommand(state, { type: "DismissConflict", tripId: TRIP, conflictId }, CTX);
    if (!decision.ok) throw new Error(decision.rejection.code);
    expect(decision.events).toEqual([
      { type: "ConflictDismissed", version: 1, payload: { tripId: TRIP, conflictId } },
    ]);
  });

  it("rejects dismissing an unknown or already-dismissed conflict", () => {
    const state = conflictedState();
    const bad = decideTripCommand(state, { type: "DismissConflict", tripId: TRIP, conflictId: "nope" }, CTX);
    expect(bad.ok).toBe(false);
    const conflictId = detectConflicts(state)[0]!.id;
    const dismissed = evolveTrip(state, {
      type: "ConflictDismissed", version: 1, payload: { tripId: TRIP, conflictId },
    });
    const again = decideTripCommand(dismissed, { type: "DismissConflict", tripId: TRIP, conflictId }, CTX);
    expect(again.ok).toBe(false);
  });

  it("evolve adds (sorted) and removes dismissal ids; detail doc carries them", () => {
    const state = conflictedState();
    const dismissed = evolveTrip(state, {
      type: "ConflictDismissed", version: 1, payload: { tripId: TRIP, conflictId: "b" },
    });
    const dismissed2 = evolveTrip(dismissed, {
      type: "ConflictDismissed", version: 1, payload: { tripId: TRIP, conflictId: "a" },
    });
    expect(dismissed2.dismissedConflictIds).toEqual(["a", "b"]);
    const undismissed = evolveTrip(dismissed2, {
      type: "ConflictUndismissed", version: 1, payload: { tripId: TRIP, conflictId: "b" },
    });
    expect(undismissed.dismissedConflictIds).toEqual(["a"]);
    expect(tripDetailFromState(undismissed, "2026-07-08T00:00:00.000Z").dismissedConflictIds).toEqual(["a"]);
  });
});

describe("no-op command guards", () => {
  it("rejects a same-value start date, unchanged update, and same-position move with code no-op", () => {
    const state = conflictedState();
    const cases: TripCommand[] = [
      { type: "SetTripStartDate", tripId: TRIP, startDate: null },
      { type: "UpdateActivity", tripId: TRIP, activityId: A1 }, // all fields omitted = unchanged
      { type: "MoveActivity", tripId: TRIP, activityId: A2, toDayId: DAY, position: 1 },
    ];
    for (const command of cases) {
      const decision = decideTripCommand(state, command, CTX);
      expect(decision.ok).toBe(false);
      if (!decision.ok) expect(decision.rejection.code).toBe("no-op");
    }
  });

  it("still accepts real changes", () => {
    const state = conflictedState();
    const decision = decideTripCommand(
      state,
      { type: "MoveActivity", tripId: TRIP, activityId: A2, toDayId: null, position: 0 },
      CTX,
    );
    expect(decision.ok).toBe(true);
  });
});
