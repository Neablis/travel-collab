import { describe, expect, it } from "vitest";
import { decideTripCommand, type DecideContext } from "../src/trip/decide";
import { evolveTrip } from "../src";

describe("lifecycle commands", () => {
  const ctx: DecideContext = { actorId: "u1" };
  const tripId = "11111111-1111-4111-8111-111111111111";
  const active = evolveTrip(null, {
    type: "TripCreated",
    version: 1,
    payload: { tripId, name: "Japan", createdBy: "u1" },
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
