import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { SavedStop, type ActivityTag } from "@tc/contracts";
import { slugify } from "@/lib/playbookUrls";
import { db } from "./db/client";
import { savedDays } from "./db/schema";
import { publishedCountryCityPages, publishedDaysPage, publishedTagPages } from "./playbooks";
import { countryCityFor, tagPageFor } from "./publicLibrary";
import { countryCityListing } from "./placePage";
import { countryTagListing } from "./tagPage";
import { newSavedDayRow } from "./savedDays";

// The SEO lattice (country × city × tag): a page exists only for a
// combination a published day matches, and the page lists exactly the days its
// count promised. Country codes are obscure on purpose (placePage.int.test.ts
// does the same with Nauru): the published library is global, so a shared
// code like JP would count other suites' days.

const STEM = `Lattice${randomUUID().slice(0, 6)}`;
const ROME = `${STEM} Rome`;
const MILAN = `${STEM} Milan`;
const OWNER = `lattice-owner-${randomUUID().slice(0, 8)}`;
const ids: string[] = [];

/** Four meal stops: a day whose description names meal (as in playbooks.tags.int.test.ts). */
const mealStops = (): SavedStop[] =>
  Array.from({ length: 4 }, (_, i) =>
    SavedStop.parse({
      title: `Stop ${i}`,
      timeWindow: null,
      location: null,
      notes: null,
      anchors: [],
      kind: "planned",
      tags: ["meal"] as ActivityTag[],
      cost: null,
    }),
  );

// Written directly, as playbooks.places.int.test.ts does: what matters is the
// columns the queries filter on, not how a day gets published.
async function day(name: string, columns: Partial<typeof savedDays.$inferInsert>): Promise<string> {
  const row = newSavedDayRow({
    ownerId: OWNER,
    name,
    stops: mealStops(),
    sourceTripId: randomUUID(),
    sourceTripName: "Source",
    createdAt: new Date(),
  });
  await db.insert(savedDays).values({ ...row, visibility: "public", publishedAt: new Date(), ...columns });
  ids.push(row.id);
  return row.id;
}

afterAll(async () => {
  await db.delete(savedDays).where(inArray(savedDays.id, ids));
});

describe("the SEO lattice", () => {
  it("counts a tag in a country, in a city, and in a country×city, and lists the same days", async () => {
    const rome = slugify(ROME);
    const milan = slugify(MILAN);
    // Three Rome days in Nauru, one Milan day in Nauru, one Rome day in
    // Kiribati, and one Rome day touching both — the AND rule is
    // array-membership (the day's cities include the city AND its countries
    // include the country), so the two-country day counts under both, exactly
    // as the listing filter below lists it under both.
    await day("Rome NR 1", { cities: [ROME], countries: ["NR"] });
    await day("Rome NR 2", { cities: [ROME], countries: ["NR"] });
    await day("Rome NR 3", { cities: [ROME], countries: ["NR"] });
    await day("Milan NR", { cities: [MILAN], countries: ["NR"] });
    await day("Rome KI", { cities: [ROME], countries: ["KI"] });
    await day("Rome NR+KI", { cities: [ROME], countries: ["NR", "KI"] });

    const tags = await publishedTagPages();
    const at = (tag: string, city: string | null, country: string | null) =>
      tags.find((page) => page.tag === tag && (page.city?.slug ?? null) === city && (page.country?.slug ?? null) === country);
    expect(at("meal", null, null)?.days).toBe(6);
    expect(at("meal", rome, null)?.days).toBe(5);
    expect(at("meal", null, "nauru")?.days).toBe(5);
    expect(at("meal", null, "kiribati")?.days).toBe(2);
    expect(at("meal", rome, "nauru")?.days).toBe(4);
    expect(at("meal", rome, "kiribati")?.days).toBe(2);
    expect(at("meal", milan, "nauru")?.days).toBe(1);
    expect(at("meal", milan, "kiribati")).toBeUndefined();

    const cities = await publishedCountryCityPages();
    const cc = (country: string, city: string) =>
      cities.find((page) => page.country.slug === country && page.city.slug === city);
    expect(cc("nauru", rome)?.days).toBe(4);
    expect(cc("nauru", milan)?.days).toBe(1);
    expect(cc("kiribati", rome)?.days).toBe(2);
    expect(cc("kiribati", milan)).toBeUndefined();

    // The resolvers the routes and the sitemap read.
    expect((await tagPageFor("meal", null, "nauru"))?.days).toBe(5);
    expect((await tagPageFor("meal", rome, "nauru"))?.days).toBe(4);
    expect((await countryCityFor("nauru", rome))?.days).toBe(4);
    expect(await countryCityFor("kiribati", milan)).toBeNull();

    // The listing is the count: the AND is `countries` in SQL plus the city
    // spellings in application code, since the place predicate ORs places.
    const listed = await publishedDaysPage(
      { countries: ["NR"], citiesWithin: [ROME], tag: "meal" },
      { limit: 24, offset: 0 },
    );
    expect(listed.total).toBe(4);
    const listedKI = await publishedDaysPage(
      { countries: ["KI"], citiesWithin: [ROME] },
      { limit: 24, offset: 0 },
    );
    expect(listedKI.total).toBe(2);

    // The country×city listing is the count, with the lattice around it.
    const pair = await countryCityListing({
      params: Promise.resolve({ slug: "nauru", citySlug: rome }),
      searchParams: Promise.resolve({}),
    });
    expect(pair).toMatchObject({
      heading: `${ROME} playbooks in Nauru`,
      path: `/playbooks/country/nauru/city/${rome}`,
      total: 4,
      page: 1,
    });
    expect(pair.nav?.parents.map((link) => link.href)).toEqual(["/playbooks/country/nauru", `/playbooks/city/${rome}`]);
    expect(pair.nav?.children.map((link) => link.href)).toEqual([`/playbooks/country/nauru/city/${rome}/meal`]);

    // The country×city×tag listing is the same count, under its own heading.
    const tagged = await countryTagListing({
      params: Promise.resolve({ slug: "nauru", citySlug: rome, tag: "meal" }),
      searchParams: Promise.resolve({}),
    });
    expect(tagged).toMatchObject({
      heading: `${ROME} food playbooks in Nauru`,
      path: `/playbooks/country/nauru/city/${rome}/meal`,
      total: 4,
      page: 1,
    });
    expect(tagged.nav?.parents.map((link) => link.href)).toEqual([
      `/playbooks/country/nauru/city/${rome}`,
      "/playbooks/country/nauru/meal",
      `/playbooks/city/${rome}/meal`,
    ]);
  });
});
