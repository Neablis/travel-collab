import { describe, expect, it } from "vitest";
import type { EventEnvelope, Origin, TripEvent } from "@tc/contracts";
import {
  buildHistoryEntries,
  decideHistoryCommand,
  decideTripCommand,
  deriveUndoRedo,
  diffTripStates,
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
  let log = run([], { type: "CreateTrip", tripId: TRIP, name: "Rome" , forkedFrom: null});
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
    const log = run([], { type: "CreateTrip", tripId: TRIP, name: "Rome" , forkedFrom: null});
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

// M27 D17: an assistant card's Undo names the batch it means. Without the
// precondition, a collaborator's write landing between the card's render and
// the server's decision would make "Undo" take back THEIR change.
describe("UndoLastChange with undoesBatchId", () => {
  const headBatch = (log: Log) => log[log.length - 1]!.batchId;

  it("undoes when the named batch is still the undo target", () => {
    const log = freshTrip();
    const mine = headBatch(log);
    const decision = decideHistoryCommand(log, { type: "UndoLastChange", tripId: TRIP, undoesBatchId: mine });
    expect(decision.ok).toBe(true);
    if (decision.ok) expect(decision.origin).toEqual({ kind: "undo", undoesBatchId: mine });
  });

  it("refuses, deciding no events, once someone else's change is on top", () => {
    let log = freshTrip();
    const mine = headBatch(log);
    log = run(log, { type: "AddDay", tripId: TRIP, dayId: uuid(901) }); // the collaborator
    const decision = decideHistoryCommand(log, { type: "UndoLastChange", tripId: TRIP, undoesBatchId: mine });
    expect(decision).toEqual({
      ok: false,
      rejection: { code: "undo-target-changed", message: expect.any(String) },
    });
  });

  it("refuses when the named batch was already undone, rather than undoing the one beneath", () => {
    let log = freshTrip();
    const mine = headBatch(log);
    log = run(log, { type: "UndoLastChange", tripId: TRIP }); // from History, or by someone else
    const decision = decideHistoryCommand(log, { type: "UndoLastChange", tripId: TRIP, undoesBatchId: mine });
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.rejection.code).toBe("undo-target-changed");
  });

  it("without it, undo still takes whatever is on top", () => {
    let log = freshTrip();
    log = run(log, { type: "AddDay", tripId: TRIP, dayId: uuid(902) });
    const top = headBatch(log);
    const decision = decideHistoryCommand(log, { type: "UndoLastChange", tripId: TRIP });
    expect(decision.ok).toBe(true);
    if (decision.ok) expect(decision.origin).toEqual({ kind: "undo", undoesBatchId: top });
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

  // ADR-064 / spec W11: an accepted suggestion is the reviewer replaying the
  // author's commands, so it is an ordinary edit — undoable, and worded the
  // way the same commands would be. The UI adds "Suggested by …"; the domain
  // knows ids, never names.
  it("an accepted suggestion is undoable and described like a user batch", () => {
    let log = run(freshTrip(), { type: "AddDay", tripId: TRIP, dayId: uuid(901) });
    const batchId = log[log.length - 1]!.batchId;
    const origin: Origin = { kind: "suggestion", suggestionId: uuid(902), changeId: uuid(903), authorId: "u2" };
    log = log.map((e) => (e.batchId === batchId ? { ...e, origin } : e));

    expect(deriveUndoRedo(groupBatches(log)).undo?.batchId).toBe(batchId);
    const last = buildHistoryEntries(log).at(-1)!;
    expect(last.description).toBe("Added Day 2");
    expect(last.origin).toEqual(origin);

    log = run(log, { type: "UndoLastChange", tripId: TRIP });
    expect(state(log).days).toHaveLength(1);
    expect(buildHistoryEntries(log).at(-1)!.description).toBe("Undid: Added Day 2");
  });

  // M40 D1-D3: "Accept all" is one batch whose origin lists the changes. One
  // entry, counted rather than described per change, and one undo.
  it("an accept-all is one entry, counted, and one undo takes all of it", () => {
    let log = freshTrip();
    const before = log.length;
    log = run(log, { type: "AddDay", tripId: TRIP, dayId: uuid(911) });
    log = run(log, { type: "AddDay", tripId: TRIP, dayId: uuid(912) });
    const origin: Origin = {
      kind: "suggestions",
      changes: [
        { suggestionId: uuid(913), changeId: uuid(914) },
        { suggestionId: uuid(915), changeId: uuid(916) },
      ],
      authorIds: ["u2", "u3"],
    };
    // The two adds as the one batch an accept-all appends.
    log = log.map((e, i) => (i >= before ? { ...e, batchId: uuid(917), origin } : e));

    const last = buildHistoryEntries(log).at(-1)!;
    expect(last.description).toBe("Accepted 2 suggestions");
    expect(deriveUndoRedo(groupBatches(log)).undo?.batchId).toBe(uuid(917));

    log = run(log, { type: "UndoLastChange", tripId: TRIP });
    expect(state(log).days).toHaveLength(1);
    expect(buildHistoryEntries(log).at(-1)!.description).toBe("Undid: Accepted 2 suggestions");

    log = run(log, { type: "RedoChange", tripId: TRIP });
    expect(state(log).days).toHaveLength(3);
    expect(buildHistoryEntries(log).at(-1)!.description).toBe("Redid: Accepted 2 suggestions");
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

// M41 D6 through the history pipeline: undo, redo and revert are diffs to a
// replayed state (`diff.ts`), so the day a parked stop left has to survive
// them, or ⌘Z quietly turns "From Day 1" into nothing.
describe("undo and redo keep the day a parked stop left (M41 D6)", () => {
  const DAY_2 = uuid(901);
  const A2 = uuid(902);
  function parkedFromDay1(): Log {
    let log = freshTrip();
    log = run(log, { type: "AddDay", tripId: TRIP, dayId: DAY_2 });
    log = run(log, { type: "MoveActivity", tripId: TRIP, activityId: A1, toDayId: DAY, position: 0 });
    return run(log, { type: "MoveActivity", tripId: TRIP, activityId: A1, toDayId: null, position: 0 });
  }

  it("puts a stop dragged off the rack back with the day it left, on undo", () => {
    let log = parkedFromDay1();
    expect(state(log).parkedFrom).toEqual({ [A1]: DAY });
    log = run(log, { type: "MoveActivity", tripId: TRIP, activityId: A1, toDayId: DAY_2, position: 0 });
    expect(state(log).parkedFrom).toEqual({});

    log = run(log, { type: "UndoLastChange", tripId: TRIP });
    expect(state(log).backlog).toEqual([A1]);
    expect(state(log).parkedFrom).toEqual({ [A1]: DAY });
  });

  it("names the day again when an undone park is redone", () => {
    let log = run(parkedFromDay1(), { type: "UndoLastChange", tripId: TRIP });
    expect(state(log).parkedFrom).toEqual({});
    log = run(log, { type: "RedoChange", tripId: TRIP });
    expect(state(log).parkedFrom).toEqual({ [A1]: DAY });
  });

  it("keeps it through a reorder inside the rack", () => {
    let log = parkedFromDay1();
    log = run(log, { type: "AddActivity", tripId: TRIP, activityId: A2, title: "Trevi" });
    log = run(log, { type: "MoveActivity", tripId: TRIP, activityId: A1, toDayId: null, position: 1 });
    expect(state(log).backlog).toEqual([A2, A1]);
    expect(state(log).parkedFrom).toEqual({ [A1]: DAY });
  });

  // The other direction: a target with no origin for a stop that has one now
  // (a revert past the park) has to clear it, or the diff's own contract —
  // applied, it yields the target — does not hold.
  it("clears an origin the target does not have", () => {
    const current = state(parkedFromDay1());
    const target: TripState = { ...current, parkedFrom: {} };
    const reverted = diffTripStates(current, target).reduce<TripState>((s, e) => evolveTrip(s, e)!, current);
    expect(reverted.parkedFrom ?? {}).toEqual({});
    expect(tripStatesEqual(reverted, target)).toBe(true);
  });

  it("is part of what makes two states equal", () => {
    const parked = state(parkedFromDay1());
    expect(tripStatesEqual(parked, { ...parked, parkedFrom: {} })).toBe(false);
    expect(tripStatesEqual({ ...parked, parkedFrom: undefined }, { ...parked, parkedFrom: {} })).toBe(true);
  });
});
