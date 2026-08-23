import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "./db/client";
import { appendToStream, readStream } from "./eventStore";

const NOW = "2026-07-07T12:00:00.000Z";

function tripCreated(tripId: string) {
  return {
    type: "TripCreated",
    version: 1,
    payload: { tripId, name: "Rome 2027", createdBy: "user-1" },
  };
}

// No beforeEach truncation: every test mints its own randomUUID() streamId
// and every assertion below reads back through readStream(db, streamId),
// which is already scoped to that one stream — so leftover rows from other
// tests (this file or any other) never leak into an assertion here (Phase 2
// Task 2.6; see docs/testing-baseline.md for the isolation-strategy writeup).
describe("event store", () => {
  it("appends and reads back envelopes in order", async () => {
    const streamId = randomUUID();
    const result = await db.transaction((tx) =>
      appendToStream(tx, {
        streamId,
        expectedSeq: 0,
        events: [tripCreated(streamId)],
        actorId: "user-1",
        occurredAt: NOW,
        batchId: randomUUID(),
        origin: { kind: "user" },
      }),
    );
    expect(result.ok).toBe(true);
    const stream = await readStream(db, streamId);
    expect(stream).toHaveLength(1);
    expect(stream[0]).toMatchObject({
      streamId,
      seq: 1,
      type: "TripCreated",
      version: 1,
      actorId: "user-1",
    });
    expect(new Date(stream[0]!.occurredAt).toISOString()).toBe(NOW);
  });

  it("returns a typed conflict when two appends race on the same seq", async () => {
    const streamId = randomUUID();
    const append = () =>
      db.transaction((tx) =>
        appendToStream(tx, {
          streamId,
          expectedSeq: 0,
          events: [tripCreated(streamId)],
          actorId: "user-1",
          occurredAt: NOW,
          batchId: randomUUID(),
          origin: { kind: "user" },
        }),
      );
    const first = await append();
    const second = await append();
    expect(first.ok).toBe(true);
    expect(second).toEqual({ ok: false, code: "concurrency-conflict" });
  });
});
