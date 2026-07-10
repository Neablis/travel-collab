import { beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { asc } from "drizzle-orm";
import { db } from "./db/client";
import { events, tripDetails, tripSummaries } from "./db/schema";
import { executeTripCommand } from "./commands";
import { getTripDetail, rebuildProjections } from "./projections";

const exec = (command: object, actorId = "user-1") => executeTripCommand(command, actorId);

describe("anchor conflicts through the server pipeline (ConflictContext, ADR-006)", () => {
  beforeEach(async () => {
    await db.delete(tripDetails);
    await db.delete(tripSummaries);
    await db.delete(events);
  });

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

    const liveDetails = await db.select().from(tripDetails).orderBy(asc(tripDetails.tripId));
    await rebuildProjections();
    const rebuiltDetails = await db.select().from(tripDetails).orderBy(asc(tripDetails.tripId));
    expect(rebuiltDetails).toEqual(liveDetails);
  });
});
