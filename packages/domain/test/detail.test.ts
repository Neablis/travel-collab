import { describe, expect, it } from "vitest";
import type { EventEnvelope } from "@tc/contracts";
import { projectTripDetails } from "../src";

const T1 = "6e9a2c9e-3f7a-4b6e-9d3f-2b1a5c8d7e6f";
const DAY = "7f8b3d0f-4a8b-4c7f-8e4a-3c2b6d9e8f70";
const A1 = "9a0c4e1f-5b9c-4d8f-9f5b-4d3c7e0f9a81";
const A2 = "8a9c4e10-5b9c-4d80-9f5b-4d3c7e0f9a82";

function stream(): EventEnvelope[] {
  let seq = 0;
  const env = (type: string, payload: unknown): EventEnvelope => ({
    streamId: T1,
    seq: ++seq,
    type,
    version: 1,
    payload,
    actorId: "user-1",
    occurredAt: "2026-07-08T12:00:00.000Z",
    batchId: "6e9a2c9e-3f7a-4b6e-9d3f-2b1a5c8d7e6f",
    origin: { kind: "user" },
  });
  return [
    env("TripCreated", { tripId: T1, name: "Rome 2027", createdBy: "user-1" }),
    env("DayAdded", { tripId: T1, dayId: DAY }),
    env("ActivityAdded", {
      tripId: T1, activityId: A1, dayId: DAY, title: "Colosseum",
      timeWindow: { start: "09:00", end: "11:00" }, location: null, notes: null,
    }),
    env("ActivityAdded", {
      tripId: T1, activityId: A2, dayId: DAY, title: "Vatican Museums",
      timeWindow: { start: "10:00", end: "12:00" }, location: null, notes: null,
    }),
  ];
}

describe("projectTripDetails", () => {
  it("folds a stream into a board document with conflicts computed", () => {
    const details = projectTripDetails(stream());
    expect(details).toHaveLength(1);
    const detail = details[0]!;
    expect(detail).toMatchObject({
      tripId: T1,
      name: "Rome 2027",
      startDate: null,
      backlog: [],
      createdAt: "2026-07-08T12:00:00.000Z",
    });
    expect(detail.days).toEqual([{ dayId: DAY, activityIds: [A1, A2] }]);
    expect(detail.activities[A1]).toMatchObject({ activityId: A1, title: "Colosseum" });
    expect(detail.conflicts).toHaveLength(1);
    expect(detail.conflicts[0]).toMatchObject({ kind: "time-overlap" });
  });

  it("is deterministic across calls", () => {
    expect(projectTripDetails(stream())).toEqual(projectTripDetails(stream()));
  });

  it("throws on an unparseable event (replay totality guard)", () => {
    const bad = stream();
    bad[1] = { ...bad[1]!, payload: { nope: true } };
    expect(() => projectTripDetails(bad)).toThrow();
  });
});
