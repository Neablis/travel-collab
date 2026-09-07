import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { TripDetail } from "@tc/contracts";
import { executeTripCommand } from "./commands";
import { getTripDetail, listTripSummaries, rebuildProjections } from "./projections";
import { db } from "./db/client";
import { tripDetails, tripSummaries } from "./db/schema";

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

/**
 * KI-2026-09-05-r. `trip_details.doc` is `jsonb(...).$type<TripDetail>()` — a
 * Drizzle CAST, checked by nothing at runtime — and `getTripDetail` handed that
 * column straight back under a `Promise<TripDetail | null>` signature. Every
 * caller inherited a claim no code had verified; `requireTripAccess` was the
 * one that re-parsed downstream (KI-74) and the other six did not.
 *
 * These two tests are the two halves of the claim, asserted against
 * `getTripDetail` itself rather than a route, because the source is where the
 * lie was.
 */
describe("getTripDetail parses the stored document", () => {
  async function seedDay(): Promise<string> {
    const tripId = randomUUID();
    const dayId = randomUUID();
    await executeTripCommand({ type: "CreateTrip", tripId, name: "Parsed" }, actor);
    await executeTripCommand({ type: "AddDay", tripId, dayId }, actor);
    await executeTripCommand(
      { type: "AddActivity", tripId, activityId: randomUUID(), dayId, title: "Ramen" },
      actor,
    );
    return tripId;
  }

  /** Overwrite a trip's stored doc, the way only a past version of this server could. */
  async function rewriteDoc(
    tripId: string,
    mutate: (doc: Record<string, unknown>) => void,
  ): Promise<void> {
    const rows = await db.select().from(tripDetails).where(eq(tripDetails.tripId, tripId));
    const doc = JSON.parse(JSON.stringify(rows[0]!.doc)) as Record<string, unknown>;
    mutate(doc);
    await db
      .update(tripDetails)
      // The `as` is the cast under test: the column's `$type<TripDetail>()` lets
      // anything at all be stored under that name.
      .set({ doc: doc as unknown as TripDetail })
      .where(eq(tripDetails.tripId, tripId));
  }

  // Rewriting the row is the only faithful way to get a pre-M18 doc: a doc is
  // re-written only when its trip next changes, so the real rows in this shape
  // are the ones nobody has touched since.
  it("supplies the contract's defaults for a doc written before the fields existed", async () => {
    const tripId = await seedDay();
    await rewriteDoc(tripId, (doc) => {
      const activities = doc.activities as Record<string, Record<string, unknown>>;
      for (const activity of Object.values(activities)) {
        delete activity.kind;
        delete activity.tags;
      }
      delete doc.forkedFrom;
    });

    const detail = await getTripDetail(tripId);
    expect(detail).not.toBeNull();
    const activities = Object.values(detail!.activities);
    expect(activities).toHaveLength(1);
    // Returned raw, these three are `undefined` while the signature says
    // otherwise — the defaults exist only inside a parse.
    expect(activities[0]!.kind).toBe("planned");
    expect(activities[0]!.tags).toEqual([]);
    expect(detail!.forkedFrom).toBeNull();
  });

  it("refuses a stored doc that is not a TripDetail, rather than returning it", async () => {
    const tripId = await seedDay();
    // `members` is `.min(1)`: an empty list is a document this server could only
    // have written by being wrong, and no `.default()` can rescue it.
    await rewriteDoc(tripId, (doc) => {
      doc.members = [];
    });

    // Throwing, not `null`: `null` is this function's word for "no such trip",
    // and a trip whose row is broken is not a trip that does not exist.
    await expect(getTripDetail(tripId)).rejects.toThrow();
  });
});
