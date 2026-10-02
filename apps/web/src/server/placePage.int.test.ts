import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { MIN_INDEXED_PLACE_DAYS, slugify } from "@/lib/playbookUrls";
import { NOINDEX_FOLLOW } from "@/lib/siteMetadata";
import { db } from "./db/client";
import { savedDays } from "./db/schema";
import { placeListing, placeMetadata } from "./placePage";
import { newSavedDayRow } from "./savedDays";

// The city and country pages' shared half (SEO pass, D6). Below the threshold
// is asserted here rather than in e2e: off production every page is `noindex`
// (`siteRobots`), so a test build cannot tell a thin page from a full one.
//
// The city is minted per run, and the country is one no other file seeds: the
// published library is global, so a shared place would count other tests' days.

const run = randomUUID().slice(0, 6);
const CITY = `Placepage${run}`;
const OWNER = `place-page-owner-${run}`;
const ids: string[] = [];

// Rows written directly, as `playbooks.places.int.test.ts` does.
async function day(name: string, columns: Partial<typeof savedDays.$inferInsert>): Promise<string> {
  const row = newSavedDayRow({
    ownerId: OWNER,
    name,
    stops: [],
    sourceTripId: randomUUID(),
    sourceTripName: "Source",
    createdAt: new Date(),
  });
  await db.insert(savedDays).values({ ...row, visibility: "public", publishedAt: new Date(), ...columns });
  ids.push(row.id);
  return row.id;
}

/** What Next hands a page for `/playbooks/<kind>/<slug>?page=<page>`. */
const props = (slug: string, page?: string) => ({
  params: Promise.resolve({ slug }),
  searchParams: Promise.resolve(page === undefined ? {} : { page }),
});

afterAll(async () => {
  await db.delete(savedDays).where(inArray(savedDays.id, ids));
});

describe("place pages", () => {
  it("keeps a page under the threshold out of the index, and lets it in at the threshold", async () => {
    for (let i = 1; i < MIN_INDEXED_PLACE_DAYS; i++) await day(`Day ${i}`, { cities: [CITY] });
    const thin = await placeMetadata("city", props(slugify(CITY)));
    expect(thin.robots).toEqual(NOINDEX_FOLLOW);
    expect(thin.alternates?.canonical).toBe(`/playbooks/city/${slugify(CITY)}`);

    await day("The one that tips it", { cities: [CITY] });
    expect((await placeMetadata("city", props(slugify(CITY)))).robots).toBeUndefined();
  });

  it("lists a country's days under its English name, with the country's own card", async () => {
    const id = await day("In Nauru", { countries: ["NR"] });

    const listing = await placeListing("country", props("nauru"));
    expect(listing).toMatchObject({ name: "Nauru", path: "/playbooks/country/nauru", total: 1, page: 1 });
    expect(listing.days.map((d) => d.savedDayId)).toEqual([id]);
    const meta = await placeMetadata("country", props("nauru"));
    expect(meta.title).toBe("Nauru playbooks");
    expect(meta.openGraph?.images).toContainEqual(expect.objectContaining({ url: "/api/og/playbooks/country/NR" }));
  });
});
