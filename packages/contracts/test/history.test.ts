import { describe, expect, it } from "vitest";
import {
  EventEnvelope,
  Origin,
  TripCommand,
  TripEvent,
  TripHistory,
} from "../src";

describe("M2 history contracts", () => {
  it("parses every origin kind", () => {
    expect(Origin.parse({ kind: "user" }).kind).toBe("user");
    expect(Origin.parse({ kind: "undo", undoesBatchId: "7d9a1f8e-0000-4000-8000-000000000001" }).kind).toBe("undo");
    expect(Origin.parse({ kind: "redo", redoesBatchId: "7d9a1f8e-0000-4000-8000-000000000002" }).kind).toBe("redo");
    expect(Origin.parse({ kind: "revert", toSeq: 3 }).kind).toBe("revert");
    expect(() => Origin.parse({ kind: "revert", toSeq: 0 })).toThrow();
  });

  it("envelope requires batchId and origin", () => {
    const base = {
      streamId: "7d9a1f8e-0000-4000-8000-00000000000a",
      seq: 1,
      type: "TripCreated",
      version: 1,
      payload: {},
      actorId: "u1",
      occurredAt: "2026-07-08T00:00:00.000Z",
    };
    expect(() => EventEnvelope.parse(base)).toThrow();
    expect(
      EventEnvelope.parse({
        ...base,
        batchId: "7d9a1f8e-0000-4000-8000-00000000000b",
        origin: { kind: "user" },
      }).batchId,
    ).toBeDefined();
  });

  it("history commands and dismissal events joined the unions", () => {
    const tripId = "7d9a1f8e-0000-4000-8000-00000000000a";
    expect(TripCommand.parse({ type: "UndoLastChange", tripId }).type).toBe("UndoLastChange");
    expect(TripCommand.parse({ type: "RedoChange", tripId }).type).toBe("RedoChange");
    expect(TripCommand.parse({ type: "RevertToState", tripId, toSeq: 2 }).type).toBe("RevertToState");
    expect(TripCommand.parse({ type: "DismissConflict", tripId, conflictId: "time-overlap:d:a:b" }).type).toBe("DismissConflict");
    expect(TripEvent.parse({ type: "ConflictDismissed", version: 1, payload: { tripId, conflictId: "x:y:z" } }).type).toBe("ConflictDismissed");
    expect(TripEvent.parse({ type: "ConflictUndismissed", version: 1, payload: { tripId, conflictId: "x:y:z" } }).type).toBe("ConflictUndismissed");
  });

  it("TripHistory round-trips", () => {
    const tripId = "7d9a1f8e-0000-4000-8000-00000000000a";
    const history = {
      tripId,
      canUndo: true,
      canRedo: false,
      entries: [
        {
          batchId: "7d9a1f8e-0000-4000-8000-00000000000b",
          fromSeq: 2,
          toSeq: 3,
          actorId: "u1",
          occurredAt: "2026-07-08T00:00:00.000Z",
          origin: { kind: "revert", toSeq: 1 },
          description: "Reverted to version 1",
          undone: false,
        },
      ],
    };
    expect(TripHistory.parse(history)).toEqual(history);
  });
});
