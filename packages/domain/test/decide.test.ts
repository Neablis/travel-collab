import { describe, expect, it } from "vitest";
import { decideTripCommand, type DecideContext } from "../src/trip/decide";
import { evolveTrip } from "../src";
import type { TripState } from "../src/trip/state";

describe("lifecycle commands", () => {
  const ctx: DecideContext = { actorId: "u1" };
  const tripId = "11111111-1111-4111-8111-111111111111";
  const active = evolveTrip(null, {
    type: "TripCreated",
    version: 1,
    payload: { tripId, name: "Japan", createdBy: "u1", forkedFrom: null },
  });
  const deleted = evolveTrip(active, { type: "TripDeleted", version: 1, payload: { tripId } });

  it("renames a trip", () => {
    const d = decideTripCommand(active, { type: "SetTripName", tripId, name: "Japan 2027" }, ctx);
    expect(d).toEqual({ ok: true, events: [{ type: "TripNameSet", version: 1, payload: { tripId, name: "Japan 2027" } }] });
  });

  it("rejects renaming to the same name as a no-op", () => {
    const d = decideTripCommand(active, { type: "SetTripName", tripId, name: "Japan" }, ctx);
    expect(d.ok).toBe(false);
    expect(d.ok === false && d.rejection.code).toBe("no-op");
  });

  it("deletes an active trip", () => {
    const d = decideTripCommand(active, { type: "DeleteTrip", tripId }, ctx);
    expect(d.ok && d.events[0]!.type).toBe("TripDeleted");
  });

  it("rejects every command on a deleted trip except RestoreTrip", () => {
    const blocked = decideTripCommand(deleted, { type: "SetTripName", tripId, name: "X" }, ctx);
    expect(blocked.ok === false && blocked.rejection.code).toBe("trip-deleted");
    const allowed = decideTripCommand(deleted, { type: "RestoreTrip", tripId }, ctx);
    expect(allowed.ok && allowed.events[0]!.type).toBe("TripRestored");
  });

  it("rejects restoring a trip that is not deleted", () => {
    const d = decideTripCommand(active, { type: "RestoreTrip", tripId }, ctx);
    expect(d.ok === false && d.rejection.code).toBe("trip-not-deleted");
  });
});

describe("SetTripDates", () => {
  const ctx: DecideContext = { actorId: "u1" };
  const tripId = "11111111-1111-4111-8111-111111111111";
  const d1 = "aaaaaaaa-1111-4111-8111-111111111111";
  const d2 = "aaaaaaaa-2222-4111-8111-111111111111";
  const newIds = ["bbbbbbbb-1111-4111-8111-111111111111", "bbbbbbbb-2222-4111-8111-111111111111"];

  function tripWithDays(dayIds: string[]) {
    let s = evolveTrip(null, { type: "TripCreated", version: 1, payload: { tripId, name: "T", createdBy: "u1", forkedFrom: null } });
    for (const dayId of dayIds) s = evolveTrip(s, { type: "DayAdded", version: 1, payload: { tripId, dayId } });
    return s;
  }

  it("appends days when the range is longer than the current day count", () => {
    const d = decideTripCommand(tripWithDays([d1]), {
      type: "SetTripDates", tripId, startDate: "2026-07-07", endDate: "2026-07-09", newDayIds: newIds,
    }, ctx);
    expect(d.ok).toBe(true);
    expect(d.ok && d.events.map((e) => e.type)).toEqual(["TripStartDateSet", "DayAdded", "DayAdded"]);
  });

  it("removes from the TAIL when the range is shorter", () => {
    const d = decideTripCommand(tripWithDays([d1, d2]), {
      type: "SetTripDates", tripId, startDate: "2026-07-07", endDate: "2026-07-07", newDayIds: [],
    }, ctx);
    expect(d.ok && d.events.filter((e) => e.type === "DayRemoved").map((e) => e.payload.dayId)).toEqual([d2]);
  });

  it("rejects an end date before the start date", () => {
    const d = decideTripCommand(tripWithDays([d1]), {
      type: "SetTripDates", tripId, startDate: "2026-07-09", endDate: "2026-07-07", newDayIds: [],
    }, ctx);
    expect(d.ok === false && d.rejection.code).toBe("invalid-dates");
  });

  it("rejects an end date with no start date", () => {
    const d = decideTripCommand(tripWithDays([d1]), {
      type: "SetTripDates", tripId, startDate: null, endDate: "2026-07-07", newDayIds: [],
    }, ctx);
    expect(d.ok === false && d.rejection.code).toBe("invalid-dates");
  });

  it("rejects rather than clamping when the range would leave zero days", () => {
    const d = decideTripCommand(tripWithDays([d1]), {
      type: "SetTripDates", tripId, startDate: "2026-07-07", endDate: "2026-07-06", newDayIds: [],
    }, ctx);
    expect(d.ok === false && d.rejection.code).toBe("invalid-dates");
  });

  it("rejects when too few new day ids were supplied", () => {
    const d = decideTripCommand(tripWithDays([d1]), {
      type: "SetTripDates", tripId, startDate: "2026-07-07", endDate: "2026-07-09", newDayIds: [newIds[0]!],
    }, ctx);
    expect(d.ok === false && d.rejection.code).toBe("not-enough-day-ids");
  });

  it("sets the start date only when endDate is null", () => {
    const d = decideTripCommand(tripWithDays([d1, d2]), {
      type: "SetTripDates", tripId, startDate: "2026-07-07", endDate: null, newDayIds: [],
    }, ctx);
    expect(d.ok && d.events.map((e) => e.type)).toEqual(["TripStartDateSet"]);
  });

  it("is a no-op when nothing changes", () => {
    let s = tripWithDays([d1]);
    s = evolveTrip(s, { type: "TripStartDateSet", version: 1, payload: { tripId, startDate: "2026-07-07" } });
    const d = decideTripCommand(s, {
      type: "SetTripDates", tripId, startDate: "2026-07-07", endDate: "2026-07-07", newDayIds: [],
    }, ctx);
    expect(d.ok === false && d.rejection.code).toBe("no-op");
  });
});

// M13 link 5 — per-stop attribution. Two relations, not one (Mitchell,
// 2026-09-03): who BOOKED a stop is not who is GOING to it, and M19's cost
// splits need the participants rather than the owner.
describe("activity attribution (M13 link 5)", () => {
  const CTX: DecideContext = { actorId: "u1" };
  const TRIP_ID = "7d9a1f8e-0000-4000-8000-000000000001";
  const ACT = "7d9a1f8e-0000-4000-8000-0000000000a9";
  const base = (): TripState => ({
    tripId: TRIP_ID,
    name: "Rome",
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

  function added(over: Record<string, unknown> = {}): TripState {
    const d = decideTripCommand(
      base(),
      { type: "AddActivity", tripId: TRIP_ID, activityId: ACT, title: "Colosseum", ...over },
      CTX,
    );
    if (!d.ok) throw new Error("setup");
    return d.events.reduce(evolveTrip, base());
  }

  it("defaults to nobody booked and nobody going", () => {
    expect(added().activities[ACT]).toMatchObject({ bookedBy: null, participants: [] });
  });

  it("records both when the command supplies them", () => {
    const state = added({ bookedBy: "alice", participants: ["alice", "bob"] });
    expect(state.activities[ACT]).toMatchObject({
      bookedBy: "alice",
      participants: ["alice", "bob"],
    });
  });

  // The two relations are independent — a stop can be booked by someone who is
  // not going (the whole reason a single `assignee` would be wrong).
  it("lets the booker not be a participant", () => {
    const state = added({ bookedBy: "alice", participants: ["bob"] });
    expect(state.activities[ACT]!.bookedBy).toBe("alice");
    expect(state.activities[ACT]!.participants).toEqual(["bob"]);
  });

  describe("UpdateActivity", () => {
    const start = () => added({ bookedBy: "alice", participants: ["alice"] });
    const update = (over: Record<string, unknown>): TripState => {
      const s = start();
      const d = decideTripCommand(
        s,
        { type: "UpdateActivity", tripId: TRIP_ID, activityId: ACT, ...over },
        CTX,
      );
      if (!d.ok) throw new Error("update rejected");
      return d.events.reduce(evolveTrip, s);
    };

    // Omitted = unchanged. This is the drop this milestone's preflight exists
    // to prevent: an unrelated edit must not wipe attribution.
    it("leaves both alone when neither is mentioned", () => {
      expect(update({ title: "Colosseum tour" }).activities[ACT]).toMatchObject({
        bookedBy: "alice",
        participants: ["alice"],
      });
    });

    // `=== undefined`, not `??`: null is a real value here and means "nobody
    // booked this after all", which `?? current` would silently refuse.
    it("clears bookedBy on an explicit null", () => {
      expect(update({ bookedBy: null }).activities[ACT]!.bookedBy).toBeNull();
    });

    it("replaces participants wholesale rather than merging", () => {
      expect(update({ participants: ["bob"] }).activities[ACT]!.participants).toEqual(["bob"]);
    });

    it("empties participants on an explicit empty list", () => {
      expect(update({ participants: [] }).activities[ACT]!.participants).toEqual([]);
    });

    // A changed attribution is a real change, not a no-op — which is
    // `FIELD_EQUAL`'s job, and the reason both fields are keyed into it.
    it("is not a no-op when only attribution changes", () => {
      const s = start();
      const d = decideTripCommand(
        s,
        { type: "UpdateActivity", tripId: TRIP_ID, activityId: ACT, participants: ["bob"] },
        CTX,
      );
      expect(d.ok).toBe(true);
      if (d.ok) expect(d.events.length).toBeGreaterThan(0);
    });
  });
});
