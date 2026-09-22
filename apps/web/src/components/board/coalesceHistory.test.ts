import { describe, expect, it } from "vitest";
import type { HistoryEntry } from "@tc/contracts";
import { coalesceHistory } from "./coalesceHistory";

const P1 = "7f8b3d0f-4a8b-4c7f-8e4a-3c2b6d9e8f70";
const P2 = "8a9c4e10-5b9c-4d80-9f5b-4d3c7e0f9a81";

let seq = 100;
function entry(over: Partial<HistoryEntry> = {}): HistoryEntry {
  seq -= 1;
  return {
    batchId: `${seq}`.padStart(8, "0") + "-0000-4000-8000-000000000000",
    fromSeq: seq,
    toSeq: seq,
    actorId: "alice",
    occurredAt: "2026-09-22T00:00:00.000Z",
    origin: { kind: "user" },
    description: 'Edited "Overview"',
    undone: false,
    ...over,
  };
}

describe("coalesceHistory", () => {
  it("collapses a run of autosaves on one page into one row", () => {
    const rows = coalesceHistory([entry({ pageId: P1 }), entry({ pageId: P1 }), entry({ pageId: P1 })]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.count).toBe(3);
  });

  // The newest, so previewing from this row lands after the whole run rather
  // than in the middle of somebody's sentence.
  it("keeps the newest batch of the run as the row's entry", () => {
    const newest = entry({ pageId: P1 });
    const rows = coalesceHistory([newest, entry({ pageId: P1 }), entry({ pageId: P1 })]);
    expect(rows[0]!.entry.batchId).toBe(newest.batchId);
  });

  it("never groups trip changes, which carry no pageId", () => {
    const rows = coalesceHistory([
      entry({ description: "Added a day" }),
      entry({ description: "Added a day" }),
    ]);
    expect(rows).toHaveLength(2);
  });

  it("keeps two people's work apart", () => {
    const rows = coalesceHistory([
      entry({ pageId: P1, actorId: "alice" }),
      entry({ pageId: P1, actorId: "bob" }),
      entry({ pageId: P1, actorId: "alice" }),
    ]);
    expect(rows.map((r) => r.entry.actorId)).toEqual(["alice", "bob", "alice"]);
  });

  it("keeps two pages apart", () => {
    const rows = coalesceHistory([entry({ pageId: P1 }), entry({ pageId: P2 }), entry({ pageId: P1 })]);
    expect(rows).toHaveLength(3);
  });

  // Adjacency: collapsing across the day would put a trip change inside a run
  // it did not belong to.
  it("does not collapse across an unrelated change", () => {
    const rows = coalesceHistory([
      entry({ pageId: P1 }),
      entry({ description: "Added a day" }),
      entry({ pageId: P1 }),
    ]);
    expect(rows.map((r) => r.count)).toEqual([1, 1, 1]);
  });

  // A run half struck through would be a lie — the two states cannot share a
  // row.
  it("never groups an undone entry with a live one", () => {
    const rows = coalesceHistory([
      entry({ pageId: P1, undone: true }),
      entry({ pageId: P1, undone: true }),
      entry({ pageId: P1, undone: false }),
    ]);
    expect(rows).toHaveLength(3);
  });

  it("leaves an empty history empty", () => {
    expect(coalesceHistory([])).toEqual([]);
  });
});
