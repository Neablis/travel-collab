import { describe, expect, it } from "vitest";
import { ActivityUpdatedV1, BatchableCommand, clearDetailFieldsForKind, SavedDaySequence, TripCommand } from "../src";

const TRIP = "7d9a1f8e-0000-4000-8000-00000000000a";
const A1 = "7d9a1f8e-0000-4000-8000-0000000000a1";

// M52 decision 5: a flight number is a transit stop's detail, refused by the
// SCHEMA on both unions by the rule `mode` follows (adr055-pending-reason.test.ts).
const add = (fields: Record<string, unknown>) => ({ type: "AddActivity", tripId: TRIP, activityId: A1, title: "Fly home", ...fields });
const upd = (fields: Record<string, unknown>) => ({ type: "UpdateActivity", tripId: TRIP, activityId: A1, ...fields });
const issues = (r: { success: boolean; error?: { issues: { path: (string | number)[]; message: string }[] } }) =>
  r.success ? [] : r.error!.issues.map((i) => `${i.path.join(".")}: ${i.message}`);

describe("a flight number is legal only on a transit stop", () => {
  for (const [name, schema] of [["TripCommand", TripCommand], ["BatchableCommand", BatchableCommand]] as const) {
    it(`${name} refuses it on a non-transit AddActivity, including one whose kind is omitted`, () => {
      const refusal = 'flightNumber: flightNumber is only allowed on a transit stop (kind "transit")';
      expect(issues(schema.safeParse(add({ kind: "pending", flightNumber: "TP 1234" })))).toEqual([refusal]);
      expect(issues(schema.safeParse(add({ flightNumber: "TP 1234" })))).toEqual([refusal]);
      expect(schema.safeParse(add({ kind: "transit", mode: "flight", flightNumber: "TP 1234" })).success).toBe(true);
    });
  }

  it("refuses an empty one rather than storing a blank", () => {
    expect(TripCommand.safeParse(add({ kind: "transit", flightNumber: "  " })).success).toBe(false);
  });

  it("is cleared by a patch that moves the stop off transit, unless the patch names it", () => {
    expect(clearDetailFieldsForKind({ kind: "planned" })).toMatchObject({ flightNumber: null });
    expect(clearDetailFieldsForKind({ kind: "transit" })).not.toHaveProperty("flightNumber");
    expect(issues(TripCommand.safeParse(upd(clearDetailFieldsForKind({ kind: "planned", flightNumber: "TP 1234" }))))).toHaveLength(1);
  });

  it("is refused on the saved-day write path too", () => {
    const stop = { title: "Fly home", timeWindow: null, location: null, notes: null, anchors: [], kind: "planned", tags: [], cost: null, dayIndex: 0, flightNumber: "TP 1234" };
    expect(issues(SavedDaySequence.safeParse([stop]))).toEqual(['0.flightNumber: flightNumber is only allowed on a transit stop (kind "transit")']);
  });
});

it("a payload written before M52 reads as no flight number", () => {
  const payload = { tripId: TRIP, activityId: A1, title: "Old", timeWindow: null, location: null, notes: null, kind: "transit", mode: "flight" };
  expect(ActivityUpdatedV1.parse({ type: "ActivityUpdated", version: 1, payload }).payload).toMatchObject({ flightNumber: null });
});
