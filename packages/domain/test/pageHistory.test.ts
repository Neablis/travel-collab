import { describe, expect, it } from "vitest";
import type { EventEnvelope, PageDoc } from "@tc/contracts";
import { buildHistoryEntries, deriveUndoRedo, foldEnvelopes, groupBatches } from "../src";

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

  // The reason a page-only batch must survive grouping: `deriveUndoRedo`
  // stacks batches, so a notebook edit is undoable only if it is a batch.
  it("makes a notebook edit undoable without deriveUndoRedo knowing about pages", () => {
    const targets = deriveUndoRedo(groupBatches([genesis, pageCreated, pageEdited]));
    expect(targets.undo).not.toBeNull();
    // Undoing the last batch targets the seq just before it — i.e. back to the
    // page as it was created, not back past the trip's genesis.
    expect(targets.undo).toEqual({ batchId: B(3), targetSeq: 2 });
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
