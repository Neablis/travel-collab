import { beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { asc } from "drizzle-orm";
import { db } from "./db/client";
import { events, tripSummaries } from "./db/schema";
import { handleCreateTrip } from "./commands";
import { rebuildTripSummaries } from "./projections";

describe("handleCreateTrip", () => {
  beforeEach(async () => {
    await db.delete(tripSummaries);
    await db.delete(events);
  });

  it("appends TripCreated with actor and updates the projection", async () => {
    const tripId = randomUUID();
    const result = await handleCreateTrip({ tripId, name: "Rome 2027" }, "user-1");
    expect(result).toEqual({ ok: true, tripId });

    const eventRows = await db.select().from(events);
    expect(eventRows).toHaveLength(1);
    expect(eventRows[0]!.actorId).toBe("user-1");

    const summaryRows = await db.select().from(tripSummaries);
    expect(summaryRows).toHaveLength(1);
    expect(summaryRows[0]!.name).toBe("Rome 2027");
    expect(summaryRows[0]!.members).toEqual([{ userId: "user-1", role: "owner" }]);
  });

  it("rejects a duplicate tripId with a typed error", async () => {
    const tripId = randomUUID();
    await handleCreateTrip({ tripId, name: "Rome 2027" }, "user-1");
    const second = await handleCreateTrip({ tripId, name: "Rome again" }, "user-1");
    expect(second).toEqual({
      ok: false,
      error: {
        code: "trip-already-exists",
        message: "A trip with this id already exists.",
      },
    });
  });

  it("rejects invalid input via the contract schema", async () => {
    const result = await handleCreateTrip({ tripId: "not-a-uuid", name: "" }, "user-1");
    expect(result.ok).toBe(false);
  });

  it("GOLDEN: rebuild from the log equals the live projection", async () => {
    await handleCreateTrip({ tripId: randomUUID(), name: "Rome 2027" }, "user-1");
    await handleCreateTrip({ tripId: randomUUID(), name: "Tokyo 2028" }, "user-2");

    const live = await db.select().from(tripSummaries).orderBy(asc(tripSummaries.tripId));
    await rebuildTripSummaries();
    const rebuilt = await db.select().from(tripSummaries).orderBy(asc(tripSummaries.tripId));

    const normalize = (rows: typeof live) =>
      rows.map((r) => ({ ...r, createdAt: new Date(r.createdAt).toISOString() }));
    expect(normalize(rebuilt)).toEqual(normalize(live));
  });
});
