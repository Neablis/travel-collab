import { describe, expect, it } from "vitest";
import type { EventEnvelope } from "@tc/contracts";
import { foldEnvelopes, projectTripDetails, tripDetailFromState } from "../src";

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
    expect(detail.days).toEqual([{ dayId: DAY, activityIds: [A1, A2], date: null, costSubtotal: 0 }]);
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

/**
 * M51 decision 8a: a stop names who added it. Attribution is the add's
 * envelope `actorId`, not a payload field, so every `ActivityAdded` already in
 * the log folds to a name with no event changed.
 */
describe("addedBy", () => {
  const A3 = "7a9c4e10-5b9c-4d80-9f5b-4d3c7e0f9a83";
  const by = (envelope: EventEnvelope, actorId: string, origin: EventEnvelope["origin"] = { kind: "user" }): EventEnvelope =>
    ({ ...envelope, actorId, origin });

  function attributed(): EventEnvelope[] {
    const [created, day, colosseum, vatican] = stream();
    return [
      created!,
      day!,
      // Written in the pre-M13 payload shape: no kind, tags, bookedBy.
      colosseum!,
      // The assistant and a public-API key both act as the person they act
      // for, so their adds reach the log under that person's id.
      by(vatican!, "user-2"),
      by({ ...vatican!, seq: 5, type: "ActivityRemoved", payload: { tripId: T1, activityId: A2 } }, "user-2"),
      // Undo re-adds through the ordinary event, under whoever undid it.
      by({ ...vatican!, seq: 6 }, "user-3", { kind: "undo", undoesBatchId: vatican!.batchId }),
      by({ ...vatican!, seq: 7, payload: { tripId: T1, activityId: A3, dayId: null, title: "Gelato", timeWindow: null, location: null, notes: null } }, "user-4"),
    ];
  }

  it("is the actor of the add, in the projection and on the live fold alike", () => {
    const [detail] = projectTripDetails(attributed());
    const addedBy = Object.fromEntries(Object.entries(detail!.activities).map(([id, a]) => [id, a.addedBy]));
    expect(addedBy).toEqual({ [A1]: "user-1", [A2]: "user-3", [A3]: "user-4" });
    // The live pipeline writes `tripDetailFromState(foldEnvelopes(...))`;
    // the rebuild must reach the same document (Invariant 2).
    expect(tripDetailFromState(foldEnvelopes(attributed())!, detail!.createdAt)).toEqual(detail);
  });
});
