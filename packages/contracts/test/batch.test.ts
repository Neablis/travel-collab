import { describe, expect, it } from "vitest";
import { BatchableCommand } from "../src/trip";

const tripId = "11111111-1111-1111-1111-111111111111";

describe("BatchableCommand", () => {
  it("accepts a batchable command", () => {
    const r = BatchableCommand.safeParse({ type: "AddDay", tripId, dayId: "22222222-2222-2222-2222-222222222222" });
    expect(r.success).toBe(true);
  });

  it("rejects CreateTrip", () => {
    const r = BatchableCommand.safeParse({ type: "CreateTrip", tripId, name: "x" });
    expect(r.success).toBe(false);
  });

  it("rejects history commands", () => {
    for (const type of ["UndoLastChange", "RedoChange"]) {
      expect(BatchableCommand.safeParse({ type, tripId }).success).toBe(false);
    }
    expect(BatchableCommand.safeParse({ type: "RevertToState", tripId, toSeq: 1 }).success).toBe(false);
  });
});
