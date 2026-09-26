import { describe, expect, it } from "vitest";
import { ActivityUpdatedV1, BatchableCommand, SavedDaySequence, TripCommand } from "../src";

const TRIP = "7d9a1f8e-0000-4000-8000-00000000000a";
const A1 = "7d9a1f8e-0000-4000-8000-0000000000a1";

// ADR-055: a pending reason is legal only on a pending stop, refused by the
// SCHEMA on both unions (the assistant's proposals parse through the
// batchable one) — the same rule, asked the same way, as M24's travel leg.
const add = (fields: Record<string, unknown>) => ({ type: "AddActivity", tripId: TRIP, activityId: A1, title: "Kikunoi Roan", ...fields });
const upd = (fields: Record<string, unknown>) => ({ type: "UpdateActivity", tripId: TRIP, activityId: A1, ...fields });
const issues = (r: { success: boolean; error?: { issues: { path: (string | number)[]; message: string }[] } }) =>
  r.success ? [] : r.error!.issues.map((i) => `${i.path.join(".")}: ${i.message}`);

describe("a pending reason is legal only on a pending stop", () => {
  for (const [name, schema] of [["TripCommand", TripCommand], ["BatchableCommand", BatchableCommand]] as const) {
    it(`${name} refuses it on a non-pending AddActivity, including one whose kind is omitted`, () => {
      const refusal = 'pendingReason: pendingReason is only allowed on a pending stop (kind "pending")';
      expect(issues(schema.safeParse(add({ kind: "planned", pendingReason: "book" })))).toEqual([refusal]);
      expect(issues(schema.safeParse(add({ kind: "transit", pendingReason: "maybe" })))).toEqual([refusal]);
      expect(issues(schema.safeParse(add({ pendingReason: "book" })))).toEqual([refusal]);
      expect(schema.safeParse(add({ kind: "pending", pendingReason: "maybe" })).success).toBe(true);
    });
  }

  it("refuses an UpdateActivity setting another kind and a reason together, and leaves a bare reason to the decider", () => {
    expect(issues(TripCommand.safeParse(upd({ kind: "planned", pendingReason: "book" })))).toHaveLength(1);
    expect(TripCommand.safeParse(upd({ kind: "planned", pendingReason: null })).success).toBe(true);
    expect(TripCommand.safeParse(upd({ pendingReason: "maybe" })).success).toBe(true);
  });

  it("is a closed vocabulary", () => {
    expect(TripCommand.safeParse(add({ kind: "pending", pendingReason: "someday" })).success).toBe(false);
  });

  // The Playbook write path asks the same rule, so a saved day holding a stop
  // that `AddActivity` would refuse is never written.
  it("is refused on the saved-day write path too", () => {
    const stop = { title: "Kikunoi Roan", timeWindow: null, location: null, notes: null, anchors: [], kind: "planned", tags: [], cost: null, dayIndex: 0, pendingReason: "book" };
    expect(issues(SavedDaySequence.safeParse([stop]))).toEqual(['0.pendingReason: pendingReason is only allowed on a pending stop (kind "pending")']);
  });
});

// Never on the event payload: replay must never refuse a fact already decided.
it("an event payload carrying a reason on a non-pending stop still parses — replay never refuses", () => {
  const payload = { tripId: TRIP, activityId: A1, title: "Old", timeWindow: null, location: null, notes: null, kind: "planned", pendingReason: "book" };
  expect(ActivityUpdatedV1.safeParse({ type: "ActivityUpdated", version: 1, payload }).success).toBe(true);
});

it("a payload written before ADR-055 reads as no reason", () => {
  const payload = { tripId: TRIP, activityId: A1, title: "Old", timeWindow: null, location: null, notes: null, kind: "hold" };
  const parsed = ActivityUpdatedV1.parse({ type: "ActivityUpdated", version: 1, payload });
  expect(parsed.payload).toMatchObject({ kind: "pending", pendingReason: null });
});
