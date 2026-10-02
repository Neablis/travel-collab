import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { db } from "./db/client";
import { savedDays } from "./db/schema";
import { sitemapDays } from "./playbooks";
import { newSavedDayRow } from "./savedDays";

// Rows are written directly: what matters here is the four columns the query
// filters on, not how a day comes to be published.
const OWNER = `sitemap-owner-${randomUUID().slice(0, 8)}`;
const ids: string[] = [];

async function day(name: string, columns: Partial<typeof savedDays.$inferInsert>): Promise<string> {
  const row = newSavedDayRow({
    ownerId: OWNER,
    name,
    stops: [],
    sourceTripId: randomUUID(),
    sourceTripName: "Source",
    createdAt: new Date(),
  });
  await db.insert(savedDays).values({ ...row, ...columns });
  ids.push(row.id);
  return row.id;
}

afterAll(async () => {
  await db.delete(savedDays).where(inArray(savedDays.id, ids));
});

describe("sitemapDays", () => {
  it("lists a published day and leaves out private, moderated and deleted ones", async () => {
    const publishedAt = new Date("2026-09-01T00:00:00Z");
    const shown = await day("Shown", { visibility: "public", publishedAt });
    const hidden = [
      await day("Private", { visibility: "private" }),
      await day("Moderated", { visibility: "public", publishedAt, moderatedAt: new Date() }),
      await day("Deleted", { visibility: "public", publishedAt, deletedAt: new Date() }),
    ];

    const listed = await sitemapDays();
    const mine = listed.filter((d) => ids.includes(d.savedDayId));

    expect(mine).toEqual([{ savedDayId: shown, name: "Shown", publishedAt: publishedAt.toISOString() }]);
    for (const id of hidden) expect(listed.map((d) => d.savedDayId)).not.toContain(id);
  });
});
