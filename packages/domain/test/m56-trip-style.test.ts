import { describe, expect, it } from "vitest";
import { TripDetail, type EventEnvelope, type SetTripStyle, type TripCommand } from "@tc/contracts";
import { decideTripCommand, type DecideContext } from "../src/trip/decide";
import { describeUserBatch, diffTripStates, evolveTrip, hydrate, projectTripDetails, tripDetailFromState, tripStatesEqual } from "../src";
import type { TripState } from "../src/trip/state";

// M56 D4: a trip's pace and tags, set at Create. Every trip and every
// `trip_details.doc` written before them has neither, and both must still
// read back as the same trip.
const CTX: DecideContext = { actorId: "alice" };
const TRIP_ID = "7d9a1f8e-0000-4000-8000-000000000056";
const BATCH = "7d9a1f8e-0000-4000-8000-0000000000b6";

const envelope = (seq: number, type: string, payload: Record<string, unknown>): EventEnvelope => ({
  streamId: TRIP_ID,
  seq,
  type,
  version: 1,
  payload,
  actorId: "alice",
  occurredAt: "2026-10-30T12:00:00.000Z",
  batchId: BATCH,
  origin: { kind: "user" },
});

const created = (): EventEnvelope => envelope(1, "TripCreated", { tripId: TRIP_ID, name: "Lisbon", createdBy: "alice" });

const base = (): TripState => ({
  tripId: TRIP_ID, name: "Lisbon", members: [{ userId: "alice", role: "owner" }], forkedFrom: null,
  startDate: null, days: [], backlog: [], activities: {}, dismissedConflictIds: [], currency: "USD", budget: null,
  status: "active",
});

const decide = (state: TripState, command: TripCommand) => decideTripCommand(state, command, CTX);
const style = (pace: SetTripStyle["pace"], tags: SetTripStyle["tags"]): SetTripStyle => ({ type: "SetTripStyle", tripId: TRIP_ID, pace, tags });

describe("a trip written before pace and tags", () => {
  it("reads back with no pace and no tags", () => {
    const [replayed] = projectTripDetails([created()]);
    const { pace: _pace, tags: _tags, ...legacyDoc } = replayed!;
    const stored = TripDetail.parse(legacyDoc);
    expect(replayed).toEqual(stored);
    expect(stored.pace).toBeNull();
    expect(stored.tags).toEqual([]);
  });
});

describe("SetTripStyle", () => {
  it("decides and evolves into the trip's detail", () => {
    const d = decide(base(), style("slow", ["beach", "museum"]));
    if (!d.ok) throw new Error(`rejected: ${d.rejection.code}`);
    const [detail] = projectTripDetails([created(), ...d.events.map((e, i) => envelope(i + 2, e.type, e.payload))]);
    expect(detail).toMatchObject({ pace: "slow", tags: ["beach", "museum"] });
  });

  it("is refused as a no-op when it changes nothing, and accepted when it clears", () => {
    expect(decide(base(), style(null, []))).toMatchObject({ ok: false, rejection: { code: "no-op" } });
    const d = decide(base(), style("packed", ["nightlife"]));
    if (!d.ok) throw new Error(`rejected: ${d.rejection.code}`);
    const styled = d.events.reduce(evolveTrip, base());
    expect(decide(styled, style("packed", ["nightlife"]))).toMatchObject({ ok: false, rejection: { code: "no-op" } });
    expect(decide(styled, style(null, [])).ok).toBe(true);
    // Each half is a change on its own, or equality is missing one of them.
    expect(decide(styled, style("slow", ["nightlife"])).ok).toBe(true);
    expect(decide(styled, style("packed", ["nightlife", "beach"])).ok).toBe(true);
  });

  // Undo is a diff to the earlier state; a field equality skipped would make
  // it a silent no-op.
  it("is undone by the diff, and survives hydrate", () => {
    const d = decide(base(), style("balanced", ["sight"]));
    if (!d.ok) throw new Error(`rejected: ${d.rejection.code}`);
    const styled = d.events.reduce(evolveTrip, base());
    const undone = diffTripStates(styled, base()).reduce(evolveTrip, styled);
    expect(tripStatesEqual(undone, base())).toBe(true);
    expect(tripStatesEqual(hydrate(tripDetailFromState(styled, "2026-10-30T12:00:00.000Z")), styled)).toBe(true);
  });

  it("is described in history", () => {
    const d = decide(base(), style("slow", ["beach"]));
    if (!d.ok) throw new Error(`rejected: ${d.rejection.code}`);
    expect(describeUserBatch(base(), d.events)).toBe("Set the trip's pace to slow and its tags to beach");
    const cleared = decide(d.events.reduce(evolveTrip, base()), style(null, []));
    if (!cleared.ok) throw new Error(`rejected: ${cleared.rejection.code}`);
    expect(describeUserBatch(base(), cleared.events)).toBe("Cleared the trip's pace and tags");
  });
});
