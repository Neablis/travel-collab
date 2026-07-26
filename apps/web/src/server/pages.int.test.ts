import { beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "./db/client";
import { events, pages, tripDetails, tripSummaries } from "./db/schema";
import { executeTripCommand } from "./commands";
import { listPages, getPage, createPage, updatePage, deletePage } from "./pages";

async function seedTrip() {
  const tripId = randomUUID();
  await executeTripCommand({ type: "CreateTrip", tripId, name: "Rome 2027" }, "user-1");
  return { tripId };
}

describe("pages repository", () => {
  beforeEach(async () => {
    await db.delete(tripDetails);
    await db.delete(tripSummaries);
    await db.delete(events);
    await db.delete(pages);
  });

  it("lazily instantiates the two default pages on first list", async () => {
    const { tripId } = await seedTrip();
    const first = await listPages(tripId);
    expect(first.map((p) => p.title).sort()).toEqual(["Day Sheet", "Trip Overview"]);
    const second = await listPages(tripId); // idempotent — no duplicate instantiation
    expect(second).toHaveLength(2);
  });

  it("creates, reads, updates, deletes a page", async () => {
    const { tripId } = await seedTrip();
    const created = await createPage(
      tripId,
      { title: "Notes", context: { tripId }, content: { type: "doc", content: [] } },
      "user-1",
    );
    expect(created.title).toBe("Notes");
    const fetched = await getPage(created.id);
    expect(fetched!.id).toBe(created.id);
    const updated = await updatePage(created.id, { title: "Renamed" });
    expect(updated!.title).toBe("Renamed");
    expect(updated!.updatedAt >= created.updatedAt).toBe(true);
    expect(await deletePage(created.id)).toBe(true);
    expect(await getPage(created.id)).toBeNull();
  });
});
