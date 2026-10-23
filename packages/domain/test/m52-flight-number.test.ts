import { describe, expect, it } from "vitest";
import { TripDetail, type EventEnvelope, type TripCommand } from "@tc/contracts";
import { decideTripCommand, type DecideContext } from "../src/trip/decide";
import { evolveTrip, projectTripDetails } from "../src";
import type { TripState } from "../src/trip/state";

// M52 decision 5: a transit stop's flight number. Replay is the half that
// matters most: every log and every `trip_details.doc` written before the
// field has no such key, and both must still read back as the same trip.
const CTX: DecideContext = { actorId: "alice" };
const TRIP_ID = "7d9a1f8e-0000-4000-8000-000000000001";
const ACT = "7d9a1f8e-0000-4000-8000-0000000000a9";
const BATCH = "7d9a1f8e-0000-4000-8000-0000000000b1";
const LISBON = { name: "Lisbon Airport", lat: 38.7742, lng: -9.1342 };

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

// The payload as it was stored before M52: no `flightNumber` key at all.
const legacyLog = (): EventEnvelope[] => [
  envelope(1, "TripCreated", { tripId: TRIP_ID, name: "Portugal", createdBy: "alice" }),
  envelope(2, "ActivityAdded", {
    tripId: TRIP_ID, activityId: ACT, dayId: null, title: "Fly home", timeWindow: null, location: LISBON,
    notes: null, anchors: [], kind: "transit", tags: [], cost: null, bookedBy: null, participants: [],
    mode: "flight", endLocation: null, pendingReason: null,
  }),
];

describe("a log written before flightNumber", () => {
  it("replays to the trip its stored projection says", () => {
    const [replayed] = projectTripDetails(legacyLog());
    // The stored doc from then has no key either; it is read back through the contract.
    const { flightNumber: _dropped, ...legacyView } = replayed!.activities[ACT]!;
    const stored = TripDetail.parse({ ...replayed, activities: { [ACT]: legacyView } });
    expect(replayed).toEqual(stored);
    expect(replayed!.activities[ACT]!.flightNumber).toBeNull();
  });
});

describe("a flight number", () => {
  const base = (): TripState => ({
    tripId: TRIP_ID, name: "Portugal", members: [{ userId: "alice", role: "owner" }], forkedFrom: null,
    startDate: null, days: [], backlog: [], activities: {}, dismissedConflictIds: [], currency: "USD", budget: null,
    status: "active",
  });

  const decide = (state: TripState, command: TripCommand) => decideTripCommand(state, command, CTX);
  const flight = (): { state: TripState; events: EventEnvelope[] } => {
    const d = decide(base(), {
      type: "AddActivity", tripId: TRIP_ID, activityId: ACT, title: "Fly home", kind: "transit", mode: "flight",
      location: LISBON, flightNumber: "TP 1234",
    });
    if (!d.ok) throw new Error(`rejected: ${d.rejection.code}`);
    return { state: d.events.reduce(evolveTrip, base()), events: d.events.map((e, i) => envelope(i + 2, e.type, e.payload)) };
  };

  it("round-trips through the log", () => {
    const { events } = flight();
    const [detail] = projectTripDetails([legacyLog()[0]!, ...events]);
    expect(detail!.activities[ACT]!.flightNumber).toBe("TP 1234");
  });

  // `FIELD_EQUAL` is where a new field has to be keyed, or an edit to it is
  // rejected as a no-op (KI-54's shape).
  it("is an edit on its own", () => {
    const d = decide(flight().state, { type: "UpdateActivity", tripId: TRIP_ID, activityId: ACT, flightNumber: "TP 1236" });
    expect(d.ok).toBe(true);
  });

  it("is refused on a stop that is no longer transit, unless the command clears it", () => {
    const { state } = flight();
    const off = decide(state, { type: "UpdateActivity", tripId: TRIP_ID, activityId: ACT, kind: "planned", mode: null });
    expect(off).toMatchObject({ ok: false, rejection: { code: "travel-leg-off-transit" } });
    expect(off.ok === false && off.rejection.message).toMatch(/flightNumber/);
    const cleared = decide(state, {
      type: "UpdateActivity", tripId: TRIP_ID, activityId: ACT, kind: "planned", mode: null, flightNumber: null,
    });
    expect(cleared.ok).toBe(true);
  });
});
