import { describe, expect, it } from "vitest";
import type { TripCommand } from "@tc/contracts";
import { decideTripCommand, type DecideContext } from "../src/trip/decide";
import { evolveTrip } from "../src";
import type { TripState } from "../src/trip/state";

// ADR-055: why a pending stop is pending. The command unions refuse a command
// that states a reason on another kind (contracts' adr055-pending-reason.test.ts);
// this file owns the half only the decider can see — the RESULT of a patch
// against the stored stop — and that a reason-only edit is a real edit.
const CTX: DecideContext = { actorId: "alice" };
const TRIP_ID = "7d9a1f8e-0000-4000-8000-000000000001";
const ACT = "7d9a1f8e-0000-4000-8000-0000000000a9";

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

const dinner = () =>
  apply(base(), { type: "AddActivity", tripId: TRIP_ID, activityId: ACT, title: "Kikunoi Roan", kind: "pending", pendingReason: "book" });

const update = (fields: Partial<Extract<TripCommand, { type: "UpdateActivity" }>>) =>
  ({ type: "UpdateActivity", tripId: TRIP_ID, activityId: ACT, ...fields }) as TripCommand;

describe("a pending reason is legal only while its stop is pending", () => {
  it("stores the reason an AddActivity states", () => {
    expect(dinner().activities[ACT]).toMatchObject({ kind: "pending", pendingReason: "book" });
  });

  it("refuses an update that moves a stop off pending and leaves its reason behind", () => {
    const d = decideTripCommand(dinner(), update({ kind: "planned" }), CTX);
    expect(d).toMatchObject({ ok: false, rejection: { code: "pending-reason-off-pending" } });
    expect(d.ok === false && d.rejection.message).toMatch(/Only a pending stop can have pendingReason/);
  });

  it("refuses a reason patched onto a stop that is not pending", () => {
    const planned = apply(dinner(), update({ kind: "planned", pendingReason: null }));
    const d = decideTripCommand(planned, update({ pendingReason: "maybe" }), CTX);
    expect(d).toMatchObject({ ok: false, rejection: { code: "pending-reason-off-pending" } });
  });

  // The decider never clears a reason on the caller's behalf — the refusal two
  // tests up is that half; this is the other: stated explicitly, the move lands.
  it("accepts the same move when the command clears the reason itself", () => {
    const next = apply(dinner(), update({ kind: "planned", pendingReason: null }));
    expect(next.activities[ACT]).toMatchObject({ kind: "planned", pendingReason: null });
  });

  // `FIELD_EQUAL` is where a new field has to be keyed or an edit to it is
  // rejected as a no-op — KI-54's shape.
  it("an update changing only the reason is not a no-op", () => {
    const next = apply(dinner(), update({ pendingReason: "maybe" }));
    expect(next.activities[ACT]).toMatchObject({ pendingReason: "maybe" });
  });
});
