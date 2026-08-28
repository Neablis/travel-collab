import { describe, expect, it } from "vitest";
import type { Anchor } from "@tc/contracts";
import { decideTripCommand, evolveTrip, tripDetailFromState, type TripState } from "../src";

const TRIP = "7d9a1f8e-0000-4000-8000-00000000000a";
const A1 = "7d9a1f8e-0000-4000-8000-0000000000a1";
const CTX = { actorId: "u1" };
const TOD: Anchor = { kind: "timeOfDay", window: { start: "08:00", end: "13:00" } };

function withActivity(anchors: Anchor[]): TripState {
  return {
    tripId: TRIP, name: "Rome", members: [{ userId: "u1", role: "owner" }], forkedFrom: null,
    startDate: null, days: [], backlog: [A1],
    activities: { [A1]: { title: "Market", timeWindow: null, location: null, notes: null, anchors, kind: "planned" as const, tags: [], cost: null } },
    dismissedConflictIds: [],
    currency: "USD", budget: null,
    status: "active",
  };
}

describe("anchors in domain state", () => {
  it("AddActivity carries anchors into state; the detail exposes them", () => {
    const decision = decideTripCommand(
      { tripId: TRIP, name: "Rome", members: [{ userId: "u1", role: "owner" }], forkedFrom: null, startDate: null, days: [], backlog: [], activities: {}, dismissedConflictIds: [], currency: "USD", budget: null, status: "active" },
      { type: "AddActivity", tripId: TRIP, activityId: A1, title: "Market", anchors: [TOD] },
      CTX,
    );
    if (!decision.ok) throw new Error(decision.rejection.code);
    const state = evolveTrip({ tripId: TRIP, name: "Rome", members: [{ userId: "u1", role: "owner" }], forkedFrom: null, startDate: null, days: [], backlog: [], activities: {}, dismissedConflictIds: [], currency: "USD", budget: null, status: "active" }, decision.events[0]!);
    expect(state.activities[A1]!.anchors).toEqual([TOD]);
    expect(tripDetailFromState(state, "2026-07-09T00:00:00.000Z").activities[A1]!.anchors).toEqual([TOD]);
  });

  it("UpdateActivity with omitted anchors leaves them unchanged; explicit [] clears", () => {
    const state = withActivity([TOD]);
    const omit = decideTripCommand(state, { type: "UpdateActivity", tripId: TRIP, activityId: A1, title: "Renamed" }, CTX);
    if (!omit.ok) throw new Error(omit.rejection.code);
    const afterOmit = evolveTrip(state, omit.events[0]!);
    expect(afterOmit.activities[A1]!.anchors).toEqual([TOD]);

    const clear = decideTripCommand(afterOmit, { type: "UpdateActivity", tripId: TRIP, activityId: A1, anchors: [] }, CTX);
    if (!clear.ok) throw new Error(clear.rejection.code);
    expect(evolveTrip(afterOmit, clear.events[0]!).activities[A1]!.anchors).toEqual([]);
  });

  it("re-setting the identical anchor set is a no-op", () => {
    const state = withActivity([TOD]);
    const decision = decideTripCommand(state, { type: "UpdateActivity", tripId: TRIP, activityId: A1, anchors: [TOD] }, CTX);
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.rejection.code).toBe("no-op");
  });
});
