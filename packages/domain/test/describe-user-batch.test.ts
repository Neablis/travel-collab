import { describe, expect, it } from "vitest";
import { describeUserBatch, foldEnvelopes } from "../src/trip/history";
import type { TripEvent, EventEnvelope } from "@tc/contracts";

const tripId = "11111111-1111-1111-1111-111111111111";

describe("describeUserBatch", () => {
  it("joins per-event descriptions with '; ', folding state across the batch", () => {
    // First, create a trip so we have a valid state to start from
    const createEvent: EventEnvelope = {
      streamId: tripId,
      seq: 1,
      type: "TripCreated",
      version: 1,
      payload: { tripId, name: "Test Trip", createdBy: "u1" },
      actorId: "u1",
      occurredAt: "2026-07-08T00:00:00.000Z",
      batchId: "batch-1",
      origin: { kind: "user" },
    };
    const stateBefore = foldEnvelopes([createEvent]);

    const events: TripEvent[] = [
      { type: "DayAdded", version: 1, payload: { tripId, dayId: "d1" } },
      { type: "DayAdded", version: 1, payload: { tripId, dayId: "d2" } },
    ];
    // First DayAdded sees 0 days -> "Day 1"; second sees 1 -> "Day 2".
    expect(describeUserBatch(stateBefore, events)).toBe("Added Day 1; Added Day 2");
  });

  it("describes lifecycle events", () => {
    const createEvent: EventEnvelope = {
      streamId: tripId,
      seq: 1,
      type: "TripCreated",
      version: 1,
      payload: { tripId, name: "Japan", createdBy: "u1" },
      actorId: "u1",
      occurredAt: "2026-07-08T00:00:00.000Z",
      batchId: "batch-1",
      origin: { kind: "user" },
    };
    const state = foldEnvelopes([createEvent]);

    expect(
      describeUserBatch(state, [{ type: "TripNameSet", version: 1, payload: { tripId, name: "Japan 2027" } }])
    ).toBe('Renamed the trip to "Japan 2027"');
    expect(describeUserBatch(state, [{ type: "TripDeleted", version: 1, payload: { tripId } }])).toBe(
      "Deleted the trip"
    );
    expect(describeUserBatch(state, [{ type: "TripRestored", version: 1, payload: { tripId } }])).toBe(
      "Restored the trip"
    );
  });
});
