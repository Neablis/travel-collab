import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { slugify } from "@/lib/playbookUrls";
import { NOINDEX_FOLLOW } from "@/lib/siteMetadata";
import { db } from "./db/client";
import { savedDays } from "./db/schema";
import { lengthListing, lengthMetadata } from "./lengthPage";
import { publishedLengthPages } from "./playbooks";
import { newSavedDayRow } from "./savedDays";

// The length pages: Discover's length band over the place lattice. As in
// `placePage.int.test.ts`, the city is minted per run and the country (Palau)
// is one no other file seeds, since the published library is global.

const run = randomUUID().slice(0, 6);
const CITY = `Lengthpage${run}`;
const OTHER_CITY = `Lengthother${run}`;
const CITY_SLUG = slugify(CITY);
const OWNER = `length-page-owner-${run}`;
const ids: string[] = [];

// Rows written directly, as the place pages' test does.
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

/** What Next hands a length page: its segments, and `?page=`. */
const props = (params: { band: string; slug?: string; citySlug?: string }, page?: string) => ({
  params: Promise.resolve(params),
  searchParams: Promise.resolve(page === undefined ? {} : { page }),
});

afterAll(async () => {
  await db.delete(savedDays).where(inArray(savedDays.id, ids));
});

describe("the length pages", () => {
  it("counts each day once in its band at every scope it matches, and lists exactly that set", async () => {
    const short = [
      await day("One day A", { cities: [CITY], countries: ["PW"], dayCount: 1 }),
      await day("One day B", { cities: [CITY], countries: ["PW"], dayCount: 1 }),
    ];
    await day("Five days", { cities: [CITY], countries: ["PW"], dayCount: 5 });
    // In the country, but another city: on the country's page, not the pair's.
    const elsewhere = await day("One day elsewhere", { cities: [OTHER_CITY], countries: ["PW"], dayCount: 1 });

    const pages = (await publishedLengthPages()).filter(
      (page) => page.city?.slug === CITY_SLUG || page.country?.slug === "palau",
    );
    const count = (band: string, city: string | null, country: string | null) =>
      pages.find(
        (page) => page.band === band && (page.city?.slug ?? null) === city && (page.country?.slug ?? null) === country,
      )?.days;
    expect(count("one", CITY_SLUG, null)).toBe(2);
    expect(count("one", null, "palau")).toBe(3);
    expect(count("one", CITY_SLUG, "palau")).toBe(2);
    expect(count("four-six", CITY_SLUG, null)).toBe(1);
    expect(count("seven-plus", CITY_SLUG, null)).toBeUndefined();

    // The list a page draws is the set its count counted: the band's days, the pair's city only.
    const pair = await lengthListing("country", props({ slug: "palau", citySlug: CITY_SLUG, band: "1-day" }));
    expect(pair).toMatchObject({
      heading: `1-day trips in ${CITY}, Palau`,
      path: `/playbooks/country/palau/city/${CITY_SLUG}/length/1-day`,
      total: 2,
    });
    expect(pair.days.map((d) => d.savedDayId).sort()).toEqual([...short].sort());
    const country = await lengthListing("country", props({ slug: "palau", band: "1-day" }));
    expect(country.days.map((d) => d.savedDayId).sort()).toEqual([...short, elsewhere].sort());
    expect(country.total).toBe(3);
  });

  it("keeps a page under the threshold out of the index, and lets it in at the threshold", async () => {
    const city = `Lengththin${randomUUID().slice(0, 6)}`;
    const route = props({ slug: slugify(city), band: "2-3-days" });
    await day("Two days", { cities: [city], dayCount: 2 });
    await day("Three days", { cities: [city], dayCount: 3 });
    const thin = await lengthMetadata("city", route);
    expect(thin.robots).toEqual(NOINDEX_FOLLOW);
    expect(thin.alternates?.canonical).toBe(`/playbooks/city/${slugify(city)}/length/2-3-days`);
    expect(thin.title).toBe(`2-3 day trips in ${city}`);

    await day("Three more days", { cities: [city], dayCount: 3 });
    expect((await lengthMetadata("city", props({ slug: slugify(city), band: "2-3-days" }))).robots).toBeUndefined();
  });

  it("answers a segment that names no band, a band with no day there, and a page past the end as missing", async () => {
    const city = `Lengthnone${randomUUID().slice(0, 6)}`;
    await day("Just one day", { cities: [city], dayCount: 1 });
    expect(await lengthMetadata("city", props({ slug: slugify(city), band: "one" }))).toEqual({});
    expect(await lengthMetadata("city", props({ slug: slugify(city), band: "7-plus-days" }))).toEqual({});
    expect(await lengthMetadata("city", props({ slug: slugify(city), band: "1-day" }, "2"))).toEqual({});
    expect(await lengthMetadata("city", props({ slug: slugify(city), band: "1-day" }))).toMatchObject({
      title: `1-day trips in ${city}`,
    });
  });
});
