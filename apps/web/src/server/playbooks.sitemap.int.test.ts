import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import sitemap from "@/app/sitemap";
import { MIN_INDEXED_PLACE_DAYS, slugify } from "@/lib/playbookUrls";
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

describe("sitemap.xml's places", () => {
  // Cities minted per run: the published library is global, so a shared name
  // would count other tests' days.
  it("lists a city with enough days for a page of its own, and leaves out a thinner one", async () => {
    const run = randomUUID().slice(0, 6);
    const [listed, thin] = [`Sitemapfull${run}`, `Sitemapthin${run}`];
    const publishedAt = new Date();
    for (let i = 0; i < MIN_INDEXED_PLACE_DAYS; i++) await day(`Full ${i}`, { visibility: "public", publishedAt, cities: [listed] });
    for (let i = 1; i < MIN_INDEXED_PLACE_DAYS; i++) await day(`Thin ${i}`, { visibility: "public", publishedAt, cities: [thin] });

    const paths = (await sitemap()).map((entry) => new URL(entry.url).pathname);

    expect(paths).toContain(`/playbooks/city/${slugify(listed)}`);
    expect(paths).not.toContain(`/playbooks/city/${slugify(thin)}`);
  });
});
