import { beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "./db/client";
import { events, pages, tripDetails, tripSummaries } from "./db/schema";
import { executeTripCommand } from "./commands";
import { getTripDetail } from "./projections";
import { createPage } from "./pages";
import { duplicateTrip } from "./duplicateTrip";

const actor = "user-1";

describe("duplicateTrip", () => {
  beforeEach(async () => {
    await db.delete(tripDetails);
    await db.delete(tripSummaries);
    await db.delete(events);
    await db.delete(pages);
  });

  it("copies planning state into a fresh stream with fresh ids", async () => {
    const tripId = randomUUID();
    const dayId = randomUUID();
    const activityId = randomUUID();
    await executeTripCommand({ type: "CreateTrip", tripId, name: "Japan" }, actor);
    await executeTripCommand({ type: "AddDay", tripId, dayId }, actor);
    await executeTripCommand(
      { type: "AddActivity", tripId, activityId, dayId, title: "Ramen" },
      actor,
    );

    const result = await duplicateTrip(tripId, actor);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.detail.name).toBe("Japan (copy)");
    expect(result.detail.tripId).not.toBe(tripId);
    expect(result.detail.days).toHaveLength(1);
    // Fresh ids: reusing source ids across streams is the KI-1 hazard.
    expect(result.detail.days[0]!.dayId).not.toBe(dayId);
    expect(Object.keys(result.detail.activities)[0]).not.toBe(activityId);
    expect(Object.values(result.detail.activities)[0]!.title).toBe("Ramen");

    // The source is untouched.
    const source = await getTripDetail(tripId);
    expect(source!.days[0]!.dayId).toBe(dayId);
  });

  it("does not copy the source trip's pages", async () => {
    const tripId = randomUUID();
    await executeTripCommand({ type: "CreateTrip", tripId, name: "Japan" }, actor);
    await createPage(
      tripId,
      { title: "Packing", context: { tripId }, content: { type: "doc", content: [] } },
      actor,
    );

    const result = await duplicateTrip(tripId, actor);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Pages are a separate CRUD module (ADR-014); a duplicate copies planning
    // state only. Query the pages table directly rather than calling
    // listPages, which would lazily seed default pages on the destination
    // trip and mask "not copied" behind a false "not empty".
    const copied = await db.select().from(pages).where(eq(pages.tripId, result.tripId));
    expect(copied).toHaveLength(0);
  });

  it("refuses to duplicate a deleted trip", async () => {
    const tripId = randomUUID();
    await executeTripCommand({ type: "CreateTrip", tripId, name: "Gone" }, actor);
    await executeTripCommand({ type: "DeleteTrip", tripId }, actor);
    const result = await duplicateTrip(tripId, actor);
    expect(result.ok === false && result.error.code).toBe("trip-deleted");
  });
});
