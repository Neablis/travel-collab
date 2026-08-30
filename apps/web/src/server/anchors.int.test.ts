import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "./db/client";
import { tripDetails } from "./db/schema";
import { executeTripCommand } from "./commands";
import { getTripDetail, rebuildProjections } from "./projections";

// Per run rather than the fixed "user-1" (KI-69).
const ACTOR = `user-1-${randomUUID().slice(0, 8)}`;
const exec = (command: object, actorId = ACTOR) => executeTripCommand(command, actorId);

// The beforeEach that deleted every row of trip_details, trip_summaries and
// events is gone (KI-69) — see the rebuild comparison at the end for the one
// assertion that depended on it.
describe("anchor conflicts through the server pipeline (ConflictContext, ADR-006)", () => {

  it("a date shift recomputes anchor conflicts, and rebuild reproduces them", async () => {
    const tripId = randomUUID();
    const dayId = randomUUID();
    const activityId = randomUUID();

    await exec({ type: "CreateTrip", tripId, name: "Anchor trip" });
    // 2027-05-04 is a Tuesday.
    await exec({ type: "SetTripStartDate", tripId, startDate: "2027-05-04" });
    await exec({ type: "AddDay", tripId, dayId });
    await exec({
      type: "AddActivity",
      tripId,
      activityId,
      dayId,
      title: "Monday Market",
      anchors: [{ kind: "dayOfWeek", days: ["mon"] }],
    });

    // Day 1 == startDate == 2027-05-04 (Tuesday), which the "mon" anchor excludes.
    let detail = await getTripDetail(tripId);
    expect(detail?.conflicts.some((c) => c.kind === "anchor-violation" && c.subjects.includes(activityId))).toBe(
      true,
    );

    // 2027-05-03 is a Monday — shifting the start date to it satisfies the anchor.
    await exec({ type: "SetTripStartDate", tripId, startDate: "2027-05-03" });
    detail = await getTripDetail(tripId);
    expect(detail?.conflicts.some((c) => c.kind === "anchor-violation" && c.subjects.includes(activityId))).toBe(
      false,
    );

    // Scoped to this trip's row (KI-69). Unscoped, this compared every row in
    // trip_details — so it was coupled to whatever else had written to that
    // table, most sharply to `shares.int.test.ts`, which deliberately wrote a
    // corrupted doc with no `where` clause. The length assertion keeps a
    // filtered comparison from passing vacuously on two empty arrays.
    const where = eq(tripDetails.tripId, tripId);
    const liveDetails = await db.select().from(tripDetails).where(where);
    expect(liveDetails).toHaveLength(1);
    await rebuildProjections();
    const rebuiltDetails = await db.select().from(tripDetails).where(where);
    expect(rebuiltDetails).toEqual(liveDetails);
  });
});
