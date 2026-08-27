import { describe, expect, it } from "vitest";
import type { EventEnvelope } from "@tc/contracts";
import { projectTripSummaries } from "../src";

const T1 = "6e9a2c9e-3f7a-4b6e-9d3f-2b1a5c8d7e6f";
const T2 = "7f8b3d0f-4a8b-4c7f-8e4a-3c2b6d9e8f70";

function envelope(streamId: string, name: string, actorId: string): EventEnvelope {
  return {
    streamId,
    seq: 1,
    type: "TripCreated",
    version: 1,
    payload: { tripId: streamId, name, createdBy: actorId },
    actorId,
    occurredAt: "2026-07-07T12:00:00.000Z",
    batchId: "6e9a2c9e-3f7a-4b6e-9d3f-2b1a5c8d7e6f",
    origin: { kind: "user" },
  };
}

describe("projectTripSummaries", () => {
  it("produces one summary per stream with creator as sole member", () => {
    const summaries = projectTripSummaries([
      envelope(T1, "Rome 2027", "user-1"),
      envelope(T2, "Tokyo 2028", "user-2"),
    ]);
    expect(summaries).toHaveLength(2);
    const rome = summaries.find((s) => s.tripId === T1);
    expect(rome).toEqual({
      tripId: T1,
      name: "Rome 2027",
      status: "active",
      members: [{ userId: "user-1", role: "owner" }],
     
      createdAt: "2026-07-07T12:00:00.000Z",
    });
  });

  it("throws on an unparseable event (replay totality guard)", () => {
    const bad = { ...envelope(T1, "Rome 2027", "user-1"), payload: { nope: true } };
    expect(() => projectTripSummaries([bad])).toThrow();
  });

  it("projects name changes and filters nothing (status is carried, not applied)", () => {
    const created = envelope(T1, "Old", "user-1");
    const nameSet: EventEnvelope = { ...created, seq: 2, type: "TripNameSet", payload: { tripId: T1, name: "New" } };
    const deleted: EventEnvelope = { ...created, seq: 3, type: "TripDeleted", payload: { tripId: T1 } };

    const summaries = projectTripSummaries([created, nameSet, deleted]);
    expect(summaries[0]!.name).toBe("New");
    expect(summaries[0]!.status).toBe("deleted");
  });

  it("restores status to active on TripRestored", () => {
    const created = envelope(T1, "Old", "user-1");
    const deleted: EventEnvelope = { ...created, seq: 2, type: "TripDeleted", payload: { tripId: T1 } };
    const restored: EventEnvelope = { ...created, seq: 3, type: "TripRestored", payload: { tripId: T1 } };

    const summaries = projectTripSummaries([created, deleted, restored]);
    expect(summaries[0]!.status).toBe("active");
  });

  it("ignores lifecycle events for an unknown stream instead of crashing", () => {
    const nameSet: EventEnvelope = {
      ...envelope(T1, "Old", "user-1"),
      streamId: T2,
      type: "TripNameSet",
      payload: { tripId: T2, name: "New" },
    };
    expect(() => projectTripSummaries([nameSet])).not.toThrow();
    expect(projectTripSummaries([nameSet])).toHaveLength(0);
  });
});
