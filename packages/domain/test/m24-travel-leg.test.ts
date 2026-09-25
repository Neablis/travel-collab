import { describe, expect, it } from "vitest";
import type { TripCommand } from "@tc/contracts";
import { decideTripCommand, type DecideContext } from "../src/trip/decide";
import { evolveTrip } from "../src";
import type { TripState } from "../src/trip/state";

// M24: `mode` and `endLocation` on a transit stop. The command unions refuse a
// command that states a travel-leg field on a non-transit stop (contracts'
// m24-travel-leg.test.ts); this file owns the half only the decider can see —
// the RESULT of a patch against the stored stop — and the fact that the two
// fields are real edits rather than no-ops.
const CTX: DecideContext = { actorId: "alice" };
const TRIP_ID = "7d9a1f8e-0000-4000-8000-000000000001";
const ACT = "7d9a1f8e-0000-4000-8000-0000000000a9";
const ODAWARA = { name: "Odawara Station", lat: 35.2564, lng: 139.1553 };
const KYOTO = { name: "Kyoto Station", lat: 34.9858, lng: 135.7588 };

const base = (): TripState => ({
  tripId: TRIP_ID,
  name: "Japan",
  members: [{ userId: "alice", role: "owner" }],
  forkedFrom: null,
  startDate: null,
  days: [],
  backlog: [],
  activities: {},
  dismissedConflictIds: [],
  currency: "USD",
  budget: null,
  status: "active",
});

function apply(state: TripState, command: TripCommand): TripState {
  const d = decideTripCommand(state, command, CTX);
  if (!d.ok) throw new Error(`rejected: ${d.rejection.code}`);
  return d.events.reduce(evolveTrip, state);
}

const shinkansen = () =>
  apply(base(), {
    type: "AddActivity",
    tripId: TRIP_ID,
    activityId: ACT,
    title: "Shinkansen",
    kind: "transit",
    location: ODAWARA,
    mode: "train",
    endLocation: KYOTO,
  });

const update = (fields: Partial<Extract<TripCommand, { type: "UpdateActivity" }>>) =>
  ({ type: "UpdateActivity", tripId: TRIP_ID, activityId: ACT, ...fields }) as TripCommand;

describe("a travel leg is legal only while its stop is transit", () => {
  it("refuses an update that moves a stop off transit and leaves its mode or endLocation behind", () => {
    const d = decideTripCommand(shinkansen(), update({ kind: "pending" }), CTX);
    expect(d).toMatchObject({ ok: false, rejection: { code: "travel-leg-off-transit" } });
    expect(d.ok === false && d.rejection.message).toMatch(/mode or endLocation/);
  });

  it("accepts the same move when the command clears both, and never clears them for the caller", () => {
    const next = apply(shinkansen(), update({ kind: "pending", mode: null, endLocation: null }));
    expect(next.activities[ACT]).toMatchObject({ kind: "pending", mode: null, endLocation: null });
  });
});

// `FIELD_EQUAL` is where a new field has to be keyed or an edit to it is
// rejected as a no-op — KI-54's shape. Driven through the decider, which is
// where that rejection actually bites.
describe("a travel-leg-only edit is an edit", () => {
  it.each([
    ["mode", { mode: "bus" as const }],
    ["endLocation", { endLocation: { ...KYOTO, name: "Kyoto" } }],
  ])("an update changing only %s is not a no-op", (_field, fields) => {
    const d = decideTripCommand(shinkansen(), update(fields), CTX);
    expect(d.ok === false && d.rejection.code).not.toBe("no-op");
    expect(d.ok).toBe(true);
  });
});
