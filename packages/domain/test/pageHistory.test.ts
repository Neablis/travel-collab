import { describe, expect, it } from "vitest";
import type { EventEnvelope, PageDoc } from "@tc/contracts";
import {
  buildHistoryEntries,
  decideHistoryCommand,
  deriveUndoRedo,
  foldEnvelopes,
  groupBatches,
} from "../src";

const TRIP = "6e9a2c9e-3f7a-4b6e-9d3f-2b1a5c8d7e6f";
const P1 = "7f8b3d0f-4a8b-4c7f-8e4a-3c2b6d9e8f70";
const DAY = "8a9c4e10-5b9c-4d80-9f5b-4d3c7e0f9a81";
const ALICE = "alice";
const B = (n: number) => `0000000${n}-0000-4000-8000-000000000000`;

const doc = (text: string): PageDoc =>
  ({ v: 1, type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] }) as PageDoc;

function env(seq: number, type: string, payload: unknown, batch: number): EventEnvelope {
  return {
    streamId: TRIP, seq, type, version: 1, payload, actorId: ALICE,
    occurredAt: "2026-09-22T00:00:00.000Z", batchId: B(batch), origin: { kind: "user" },
  };
}

const genesis = env(1, "TripCreated", { tripId: TRIP, name: "Japan", createdBy: ALICE, forkedFrom: null }, 1);
const pageCreated = env(2, "PageCreated", {
  tripId: TRIP, pageId: P1, title: "Overview", context: { tripId: TRIP }, content: doc("a"), actorId: ALICE,
}, 2);
const pageEdited = env(3, "PageEdited", { tripId: TRIP, pageId: P1, content: doc("b") }, 3);

describe("foldEnvelopes with page events in the stream", () => {
  it("steps over them instead of choking", () => {
    const state = foldEnvelopes([genesis, pageCreated, pageEdited]);
    expect(state?.name).toBe("Japan");
  });

  // The guarantee the skip could easily have thrown away: skipping BY NAME
  // keeps a corrupt stream loud. Skipping "anything that fails to parse" would
  // have made this pass silently, folding to a plausible wrong state.
  it("still throws on an event type belonging to neither aggregate", () => {
    const corrupt = env(2, "SomethingNobodyWrote", { tripId: TRIP }, 2);
    expect(() => foldEnvelopes([genesis, corrupt])).toThrow();
  });

  it("still applies the trip's own events after a page event", () => {
    const state = foldEnvelopes([genesis, pageCreated, env(3, "DayAdded", { tripId: TRIP, dayId: DAY }, 3)]);
    expect(state?.days).toHaveLength(1);
  });
});

describe("groupBatches", () => {
  it("routes each envelope to its own aggregate's list", () => {
    const [tripBatch, pageBatch] = groupBatches([genesis, pageCreated]);
    expect(tripBatch?.events).toHaveLength(1);
    expect(tripBatch?.pageEvents).toEqual([]);
    expect(pageBatch?.events).toEqual([]);
    expect(pageBatch?.pageEvents).toHaveLength(1);
  });

  it("keeps a page-only batch as a batch, so history can still describe it", () => {
    const batches = groupBatches([genesis, pageCreated, pageEdited]);
    expect(batches).toHaveLength(3);
    expect(batches[2]?.pageEvents).toHaveLength(1);
  });
});

// **A page-only batch must NOT enter the undo stack**, and the test that used
// to live here asserted the opposite — that a notebook edit became the undo
// target "without deriveUndoRedo knowing about pages". It does become the
// target, and that is the bug: `foldEnvelopes` skips page events, so undoing
// to just before that batch produces an EMPTY trip diff, `decideHistoryCommand`
// rejects it as `nothing-to-undo`, and nothing is popped. The next undo picks
// the same batch. One notebook save and undo can never reach an earlier
// itinerary change again.
//
// Page undo needs the history decision to carry `PageEvent[]` — that is
// `KI-2026-09-22-c`, and it is an open design question because doing it naively
// deletes every notebook on a revert. Until then a notebook edit is not
// undoable, which is a smaller cost than undo being stuck.
describe("deriveUndoRedo with page-only batches", () => {
  const dayAdded = env(2, "DayAdded", { tripId: TRIP, dayId: DAY }, 2);
  const created = env(3, "PageCreated", {
    tripId: TRIP, pageId: P1, title: "Overview", context: { tripId: TRIP }, content: doc("a"), actorId: ALICE,
  }, 3);
  const edited = env(4, "PageEdited", { tripId: TRIP, pageId: P1, content: doc("b") }, 4);
  const log = [genesis, dayAdded, created, edited];

  it("steps over them, so undo reaches the last trip change", () => {
    // The day, not the notebook save that happened after it.
    expect(deriveUndoRedo(groupBatches(log)).undo).toEqual({ batchId: B(2), targetSeq: 1 });
  });

  it("leaves nothing to undo when the notebook edits are all there is", () => {
    expect(deriveUndoRedo(groupBatches([genesis, created, edited])).undo).toBeNull();
  });

  // The symptom as a user meets it, one layer up from the stack bookkeeping.
  it("undoes the day rather than rejecting the command", () => {
    const decision = decideHistoryCommand(log, { type: "UndoLastChange", tripId: TRIP });
    expect(decision.ok).toBe(true);
    if (!decision.ok) return;
    expect(decision.events.map((e) => e.type)).toEqual(["DayRemoved"]);
  });
});

describe("buildHistoryEntries", () => {
  it("says what happened to a notebook, by name", () => {
    const entries = buildHistoryEntries([genesis, pageCreated, pageEdited]);
    expect(entries.map((e) => e.description)).toEqual([
      "Created trip \"Japan\"",
      "Added the notebook \"Overview\"",
      "Edited \"Overview\"",
    ]);
  });

  it("distinguishes a rename from a content edit", () => {
    const renamed = env(3, "PageEdited", { tripId: TRIP, pageId: P1, title: "Trip Overview" }, 3);
    const entries = buildHistoryEntries([genesis, pageCreated, renamed]);
    expect(entries[2]?.description).toBe("Renamed \"Overview\" to \"Trip Overview\"");
  });

  // A deletion has to name what it removed, which is only knowable from the
  // state BEFORE the batch.
  it("names the notebook it deleted", () => {
    const deleted = env(3, "PageDeleted", { tripId: TRIP, pageId: P1 }, 3);
    const entries = buildHistoryEntries([genesis, pageCreated, deleted]);
    expect(entries[2]?.description).toBe("Deleted the notebook \"Overview\"");
  });
});
