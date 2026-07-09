import { beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "./db/client";
import { events } from "./db/schema";
import { appendToStream, readStream } from "./eventStore";

const NOW = "2026-07-07T12:00:00.000Z";

function tripCreated(tripId: string) {
  return {
    type: "TripCreated",
    version: 1,
    payload: { tripId, name: "Rome 2027", createdBy: "user-1" },
  };
}

describe("event store", () => {
  beforeEach(async () => {
    await db.delete(events);
  });

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
