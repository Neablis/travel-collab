import { describe, expect, it } from "vitest";
import type { EventEnvelope, Origin, TripEvent } from "@tc/contracts";
import {
  buildHistoryEntries,
  decideHistoryCommand,
  decideTripCommand,
  deriveUndoRedo,
  evolveTrip,
  foldEnvelopes,
  groupBatches,
  tripStatesEqual,
  type TripState,
} from "../src";

const TRIP = "7d9a1f8e-0000-4000-8000-00000000000a";
const DAY = "7d9a1f8e-0000-4000-8000-00000000000d";
const A1 = "7d9a1f8e-0000-4000-8000-0000000000a1";
const CTX = { actorId: "u1" };
const uuid = (n: number) => `7d9a1f8e-0000-4000-8000-${String(n).padStart(12, "0")}`;

// Pure pipeline simulator: run a command exactly like the server will
// (decide → append envelopes with batch metadata).
type Log = EventEnvelope[];
let nextBatch = 500;
function run(log: Log, input: unknown): Log {
  const state = foldEnvelopes(log);
  const command = input as never;
  const type = (input as { type: string }).type;
  let events: TripEvent[];
  let origin: Origin;
  if (type === "UndoLastChange" || type === "RedoChange" || type === "RevertToState") {
    const decision = decideHistoryCommand(log, command);
    if (!decision.ok) throw new Error(decision.rejection.code);
    events = decision.events;
    origin = decision.origin;
  } else {
    const decision = decideTripCommand(state, command, CTX);
    if (!decision.ok) throw new Error(decision.rejection.code);
    events = decision.events;
    origin = { kind: "user" };
  }
  const batchId = uuid(nextBatch++);
  return [
    ...log,
    ...events.map((e, i) => ({
      streamId: TRIP,
      seq: log.length + 1 + i,
      type: e.type,
      version: e.version,
      payload: e.payload,
      actorId: "u1",
      occurredAt: "2026-07-08T00:00:00.000Z",
      batchId,
      origin,
    })),
  ];
}

function freshTrip(): Log {
  let log = run([], { type: "CreateTrip", tripId: TRIP, name: "Rome" });
  log = run(log, { type: "AddDay", tripId: TRIP, dayId: DAY });
  log = run(log, { type: "AddActivity", tripId: TRIP, activityId: A1, title: "Colosseum" });
  return log; // 3 batches: create, day, activity (activity in backlog)
}

function state(log: Log): TripState {
  const s = foldEnvelopes(log);
  if (s === null) throw new Error("empty");
  return s;
}

describe("deriveUndoRedo", () => {
  it("initial batch is never undoable; nothing to redo initially", () => {
    const log = run([], { type: "CreateTrip", tripId: TRIP, name: "Rome" });
    const targets = deriveUndoRedo(groupBatches(log));
    expect(targets.undo).toBeNull();
    expect(targets.redo).toBeNull();
  });

  it("undo targets the last effective batch; redo appears after undo; new change clears redo", () => {
    let log = freshTrip();
    const before = state(log);
    log = run(log, { type: "UndoLastChange", tripId: TRIP }); // undoes AddActivity
    expect(state(log).activities[A1]).toBeUndefined();
    let targets = deriveUndoRedo(groupBatches(log));
    expect(targets.redo).not.toBeNull();
    expect(targets.undoneBatchIds).toHaveLength(1);

    log = run(log, { type: "RedoChange", tripId: TRIP });
    expect(tripStatesEqual(state(log), before)).toBe(true); // undo∘redo = identity

    log = run(log, { type: "UndoLastChange", tripId: TRIP }); // undo the redo's target again
    log = run(log, { type: "AddDay", tripId: TRIP, dayId: uuid(900) }); // new change...
    targets = deriveUndoRedo(groupBatches(log));
    expect(targets.redo).toBeNull(); // ...clears redo
  });

  it("undo bottoms out at the creation batch", () => {
    let log = freshTrip();
    log = run(log, { type: "UndoLastChange", tripId: TRIP }); // activity
    log = run(log, { type: "UndoLastChange", tripId: TRIP }); // day
    const targets = deriveUndoRedo(groupBatches(log));
    expect(targets.undo).toBeNull();
    expect(() => run(log, { type: "UndoLastChange", tripId: TRIP })).toThrow("nothing-to-undo");
  });

  it("a revert is itself an effective, undoable action", () => {
    let log = freshTrip();
    const before = state(log);
    log = run(log, { type: "RevertToState", tripId: TRIP, toSeq: 1 }); // back to bare trip
    expect(state(log).days).toHaveLength(0);
    log = run(log, { type: "UndoLastChange", tripId: TRIP }); // undo the revert
    expect(tripStatesEqual(state(log), before)).toBe(true);
  });
});

describe("decideHistoryCommand rejections", () => {
  it("rejects revert to the current state and to nonexistent seqs", () => {
    const log = freshTrip();
    const atCurrent = decideHistoryCommand(log, { type: "RevertToState", tripId: TRIP, toSeq: log.length });
    expect(atCurrent.ok).toBe(false);
    if (!atCurrent.ok) expect(atCurrent.rejection.code).toBe("already-at-that-state");
    const beyond = decideHistoryCommand(log, { type: "RevertToState", tripId: TRIP, toSeq: 99 });
    expect(beyond.ok).toBe(false);
    if (!beyond.ok) expect(beyond.rejection.code).toBe("invalid-revert-target");
  });

  it("rejects redo when there is nothing to redo", () => {
    const decision = decideHistoryCommand(freshTrip(), { type: "RedoChange", tripId: TRIP });
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.rejection.code).toBe("nothing-to-redo");
  });
});

describe("buildHistoryEntries", () => {
  it("groups per batch, describes in domain language, marks undone entries", () => {
    let log = freshTrip();
    log = run(log, { type: "UndoLastChange", tripId: TRIP });
    const entries = buildHistoryEntries(log);
    expect(entries.map((e) => e.description)).toEqual([
      'Created trip "Rome"',
      "Added Day 1",
      'Added "Colosseum" to the backlog',
      'Undid: Added "Colosseum" to the backlog',
    ]);
    expect(entries[2]!.undone).toBe(true);
    expect(entries[3]!.origin.kind).toBe("undo");
  });

  it("a revert renders as ONE entry, not an event burst", () => {
    let log = freshTrip();
    log = run(log, { type: "RevertToState", tripId: TRIP, toSeq: 1 });
    const entries = buildHistoryEntries(log);
    expect(entries[entries.length - 1]!.description).toBe("Reverted to version 1");
    // the revert batch's several compensating events collapsed into one entry:
    expect(entries).toHaveLength(4);
  });
});
