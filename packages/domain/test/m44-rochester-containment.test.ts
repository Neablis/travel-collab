import { describe, expect, it } from "vitest";
import { decideTripCommand, detectConflicts, evolveTrip, type TripState } from "../src";
import { CTX, TRIP } from "./support/tripGenerator";
import { rochesterContainmentCommandsFor } from "./support/rochester";

function foldCommands(): TripState {
  const create = decideTripCommand(null, { type: "CreateTrip", tripId: TRIP, name: "Rochester", forkedFrom: null }, CTX);
  if (!create.ok) throw new Error("CreateTrip must succeed");
  let state: TripState | null = null;
  for (const e of create.events) state = evolveTrip(state, e);
  for (const command of rochesterContainmentCommandsFor(TRIP)) {
    const decision = decideTripCommand(state, command, CTX);
    if (!decision.ok) throw new Error(`fixture command rejected: ${command.type}`);
    for (const e of decision.events) state = evolveTrip(state, e);
  }
  return state!;
}

describe("M44 D4: Rochester-shaped trip", () => {
  it("raises no time-overlap when a meal sits inside a day-long stop on each of three days", () => {
    const state = foldCommands();
    // Guard against a vacuous pass: the fixture must really hold the stops.
    expect(state.days).toHaveLength(3);
    expect(state.days.every((d) => d.activityIds.length === 2)).toBe(true);
    expect(detectConflicts(state).filter((c) => c.kind === "time-overlap")).toEqual([]);
  });
});
