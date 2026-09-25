import { describe, expect, it } from "vitest";
import { ActivityUpdatedV1, BatchableCommand, TripCommand } from "../src";

const TRIP = "7d9a1f8e-0000-4000-8000-00000000000a";
const A1 = "7d9a1f8e-0000-4000-8000-0000000000a1";
const KYOTO = { name: "Kyoto Station", lat: 34.9858, lng: 135.7588 };

// M24's exit gate: a travel-leg field on a stop that is not travel is refused
// by the SCHEMA, not by convention. Both unions carry the refinement (trip.ts),
// so both are asked — the assistant's proposals parse through the batchable one.
const add = (fields: Record<string, unknown>) => ({ type: "AddActivity", tripId: TRIP, activityId: A1, title: "Shinkansen", ...fields });
const issuePaths = (r: { success: boolean; error?: { issues: { path: (string | number)[] }[] } }) =>
  r.success ? [] : r.error!.issues.map((i) => i.path.join("."));

describe("a travel-leg field is legal only on a transit stop", () => {
  for (const [name, schema] of [["TripCommand", TripCommand], ["BatchableCommand", BatchableCommand]] as const) {
    it(`${name} refuses a mode on a non-transit AddActivity, including one whose kind is omitted`, () => {
      expect(issuePaths(schema.safeParse(add({ kind: "planned", mode: "train" })))).toEqual(["mode"]);
      expect(issuePaths(schema.safeParse(add({ mode: "train" })))).toEqual(["mode"]);
      expect(schema.safeParse(add({ kind: "transit", mode: "train" })).success).toBe(true);
    });

    it(`${name} refuses an endLocation on a non-transit AddActivity`, () => {
      expect(issuePaths(schema.safeParse(add({ kind: "pending", endLocation: KYOTO })))).toEqual(["endLocation"]);
      expect(schema.safeParse(add({ kind: "transit", endLocation: KYOTO })).success).toBe(true);
    });
  }

  // An update that says both halves of the contradiction at once needs no
  // stored state to refuse; one that says only `mode` is the decider's call.
  it("refuses an UpdateActivity setting a non-transit kind and a mode together, and leaves a bare mode to the decider", () => {
    const upd = (fields: Record<string, unknown>) => ({ type: "UpdateActivity", tripId: TRIP, activityId: A1, ...fields });
    expect(issuePaths(TripCommand.safeParse(upd({ kind: "planned", mode: "bus" })))).toEqual(["mode"]);
    expect(TripCommand.safeParse(upd({ kind: "planned", mode: null, endLocation: null })).success).toBe(true);
    expect(TripCommand.safeParse(upd({ mode: "bus" })).success).toBe(true);
  });
});

// The rule lives on commands and in the decider, never on the event payload:
// an event is a fact already decided, and replay must never refuse one.
it("an event payload carrying a leg on a non-transit stop still parses — replay never refuses", () => {
  const payload = { tripId: TRIP, activityId: A1, title: "Old leg", timeWindow: null, location: null, notes: null, kind: "hold", mode: "train", endLocation: KYOTO };
  expect(ActivityUpdatedV1.safeParse({ type: "ActivityUpdated", version: 1, payload }).success).toBe(true);
});
