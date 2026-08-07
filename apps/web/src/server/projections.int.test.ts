import { beforeEach, describe, expect, it } from "vitest";
import { executeTripCommand } from "./commands";
import { listTripSummaries, rebuildProjections } from "./projections";
import { db } from "./db/client";
import { events, tripDetails, tripSummaries } from "./db/schema";

const actor = "u1";

describe("trip_summaries tracks lifecycle events", () => {
  beforeEach(async () => {
    await db.delete(tripDetails);
    await db.delete(tripSummaries);
    await db.delete(events);
  });

  it("tracks rename, delete, and restore, and rebuild reproduces them", async () => {
    const tripId = crypto.randomUUID();
    await executeTripCommand({ type: "CreateTrip", tripId, name: "Old" }, actor);
    await executeTripCommand({ type: "SetTripName", tripId, name: "New" }, actor);

    let rows = await listTripSummaries();
    expect(rows.find((r) => r.tripId === tripId)!.name).toBe("New");

    await executeTripCommand({ type: "DeleteTrip", tripId }, actor);
    rows = await listTripSummaries();
    expect(rows.find((r) => r.tripId === tripId)).toBeUndefined();

    await executeTripCommand({ type: "RestoreTrip", tripId }, actor);
    rows = await listTripSummaries();
    expect(rows.find((r) => r.tripId === tripId)!.status).toBe("active");

    // The golden guarantee: projections are disposable (Invariant 2).
    const before = await db.select().from(tripSummaries);
    await rebuildProjections();
    const after = await db.select().from(tripSummaries);
    expect(after).toEqual(before);
  });
});
