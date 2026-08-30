import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { executeTripCommand } from "./commands";
import { listTripSummaries, rebuildProjections } from "./projections";
import { db } from "./db/client";
import { tripSummaries } from "./db/schema";

// Per run rather than the fixed "u1" (KI-69), so this file's events cannot be
// confused with another suite's or a developer's own.
const actor = `u1-${randomUUID().slice(0, 8)}`;

// The beforeEach that deleted every row of trip_details, trip_summaries and
// events is gone (KI-69). The three `listTripSummaries()` reads below already
// filter by this test's tripId; the rebuild comparison is now scoped to it too.
describe("trip_summaries tracks lifecycle events", () => {

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
    //
    // Scoped to this trip's row (KI-69). Unscoped, this compared every row in
    // trip_summaries before and after — and with neither select carrying an
    // `orderBy`, more than one row made the comparison order-dependent on the
    // heap, since `rebuildProjections` deletes and re-inserts. It passed only
    // because the truncation guaranteed exactly one row existed.
    //
    // The length assertion is what keeps this honest: a filtered comparison of
    // two empty arrays would pass while proving nothing.
    const where = eq(tripSummaries.tripId, tripId);
    const before = await db.select().from(tripSummaries).where(where);
    expect(before).toHaveLength(1);
    await rebuildProjections();
    const after = await db.select().from(tripSummaries).where(where);
    expect(after).toEqual(before);
  });
});
