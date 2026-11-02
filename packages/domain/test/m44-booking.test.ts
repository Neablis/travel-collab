import { describe, expect, it } from "vitest";
import { TripDetail, type EventEnvelope, type TripCommand } from "@tc/contracts";
import { decideTripCommand, type DecideContext } from "../src/trip/decide";
import { diffTripStates, evolveTrip, projectTripDetails } from "../src";
import type { TripState } from "../src/trip/state";

// M44 decision 1: what was booked for a stop. Replay is the half that matters
// most: every log and every `trip_details.doc` written before the field has no
// such key, and both must still read back as the same trip.
const CTX: DecideContext = { actorId: "alice" };
const TRIP_ID = "7d9a1f8e-0000-4000-8000-000000000001";
const ACT = "7d9a1f8e-0000-4000-8000-0000000000a9";
const BATCH = "7d9a1f8e-0000-4000-8000-0000000000b1";

const envelope = (seq: number, type: string, payload: Record<string, unknown>): EventEnvelope => ({
  streamId: TRIP_ID,
  seq,
  type,
  version: 1,
  payload,
  actorId: "alice",
  occurredAt: "2026-07-07T12:00:00.000Z",
  batchId: BATCH,
  origin: { kind: "user" },
});

// The payload as it was stored before M44: no `booking` key at all.
const legacyLog = (): EventEnvelope[] => [
  envelope(1, "TripCreated", { tripId: TRIP_ID, name: "Rochester", createdBy: "alice" }),
  envelope(2, "ActivityAdded", {
    tripId: TRIP_ID, activityId: ACT, dayId: null, title: "Dinner", timeWindow: null, location: null,
    notes: null, anchors: [], kind: "planned", tags: [], cost: null, bookedBy: null, participants: [],
    mode: null, endLocation: null, pendingReason: null, flightNumber: null,
  }),
];

describe("a log written before booking", () => {
  it("replays to the trip its stored projection says, with booking null", () => {
    const [replayed] = projectTripDetails(legacyLog());
    // The stored doc from then has no key either; it is read back through the contract.
    const { booking: _dropped, ...legacyView } = replayed!.activities[ACT]!;
    const stored = TripDetail.parse({ ...replayed, activities: { [ACT]: legacyView } });
    expect(replayed).toEqual(stored);
    expect(replayed!.activities[ACT]!.booking).toBeNull();
  });
});

describe("a booking", () => {
  const base = (): TripState => ({
    tripId: TRIP_ID, name: "Rochester", members: [{ userId: "alice", role: "owner" }], forkedFrom: null,
    startDate: null, days: [], backlog: [], activities: {}, dismissedConflictIds: [], currency: "USD", budget: null,
    status: "active",
  });
  const decide = (state: TripState, command: TripCommand) => decideTripCommand(state, command, CTX);
  const apply = (state: TripState, command: TripCommand): { state: TripState; events: EventEnvelope[] } => {
    const d = decide(state, command);
    if (!d.ok) throw new Error(`rejected: ${d.rejection.code}`);
    return { state: d.events.reduce(evolveTrip, state), events: d.events.map((e, i) => envelope(i + 2, e.type, e.payload)) };
  };
  const dinner = (booking?: { confirmation?: string; provider?: string; url?: string }) =>
    apply(base(), { type: "AddActivity", tripId: TRIP_ID, activityId: ACT, title: "Dinner", ...(booking ? { booking } : {}) });

  it("is null on a stop added without one", () => {
    expect(dinner().state.activities[ACT]!.booking).toBeNull();
  });

  it("round-trips through the log on a stop of any kind", () => {
    const { events } = dinner({ confirmation: "XK29QP", provider: "Opentable" });
    const [detail] = projectTripDetails([legacyLog()[0]!, ...events]);
    expect(detail!.activities[ACT]!.booking).toEqual({ confirmation: "XK29QP", provider: "Opentable" });
  });

  it("is set by an update, which is an edit on its own", () => {
    const { state } = dinner();
    const set = apply(state, { type: "UpdateActivity", tripId: TRIP_ID, activityId: ACT, booking: { url: "https://example.com/r/1" } });
    expect(set.state.activities[ACT]!.booking).toEqual({ url: "https://example.com/r/1" });
  });

  it("is cleared by null, and a booking with none of its parts is stored as null", () => {
    const { state } = dinner({ confirmation: "XK29QP" });
    expect(apply(state, { type: "UpdateActivity", tripId: TRIP_ID, activityId: ACT, booking: null }).state.activities[ACT]!.booking).toBeNull();
    expect(apply(state, { type: "UpdateActivity", tripId: TRIP_ID, activityId: ACT, booking: {} }).state.activities[ACT]!.booking).toBeNull();
    expect(dinner({}).state.activities[ACT]!.booking).toBeNull();
  });

  it("is left alone by an update that does not name it, and a repeat of it is a no-op", () => {
    const { state } = dinner({ confirmation: "XK29QP" });
    const renamed = apply(state, { type: "UpdateActivity", tripId: TRIP_ID, activityId: ACT, title: "Late dinner" });
    expect(renamed.state.activities[ACT]!.booking).toEqual({ confirmation: "XK29QP" });
    const same = decide(state, { type: "UpdateActivity", tripId: TRIP_ID, activityId: ACT, booking: { confirmation: "XK29QP" } });
    expect(same).toMatchObject({ ok: false });
  });

  it("is diffed: a booking-only change between two states becomes an ActivityUpdated carrying it", () => {
    const before = dinner().state;
    const after = apply(before, { type: "UpdateActivity", tripId: TRIP_ID, activityId: ACT, booking: { provider: "Opentable" } }).state;
    const events = diffTripStates(before, after);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "ActivityUpdated", payload: { booking: { provider: "Opentable" } } });
  });
});
