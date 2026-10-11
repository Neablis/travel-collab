import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { SavedStop, type ActivityTag } from "@tc/contracts";
import { DISCOVER_PAGE_SIZE } from "@/lib/playbooks";
import { slugify } from "@/lib/playbookUrls";
import { db } from "./db/client";
import { savedDays } from "./db/schema";
import { discoverDays, publishedDaysPage, publishedTagPages, type DiscoverQuery } from "./playbooks";
import { newSavedDayRow } from "./savedDays";

// Tag pages and Discover's tag filter (M42 D10, ADR-070 §4): a day belongs to
// a tag when its description names the tag, not when a stop carries it.

const OWNER = `tag-owner-${randomUUID().slice(0, 8)}`;
const ids: string[] = [];

/** `count` stops, each tagged `tags`. */
const stops = (count: number, tags: ActivityTag[]): SavedStop[] =>
  Array.from({ length: count }, (_, i) =>
    SavedStop.parse({
      title: `Stop ${i}`,
      timeWindow: null,
      location: null,
      notes: null,
      anchors: [],
      kind: "planned",
      tags,
      cost: null,
    }),
  );

// Written directly, as `playbooks.places.int.test.ts` does: what matters is
// the columns the queries read.
async function day(city: string, dayStops: SavedStop[]): Promise<string> {
  const row = newSavedDayRow({
    ownerId: OWNER,
    name: `Day ${ids.length}`,
    stops: dayStops,
    sourceTripId: randomUUID(),
    sourceTripName: "Source",
    createdAt: new Date(),
  });
  await db.insert(savedDays).values({ ...row, cities: [city], visibility: "public", publishedAt: new Date() });
  ids.push(row.id);
  return row.id;
}

/** A day of four nightlife stops: "Late-night". */
const nightlifeDay = (city: string) => day(city, stops(4, ["nightlife"]));
/** Four meals and one bar: "Foodie", and carrying a Nightlife stop. */
const foodDayWithABar = (city: string) => day(city, [...stops(4, ["meal"]), ...stops(1, ["nightlife"])]);

afterAll(async () => {
  await db.delete(savedDays).where(inArray(savedDays.id, ids));
});

describe("tag pages", () => {
  it("count and list a city's days whose description names the tag, and not a day with one bar on it", async () => {
    const city = `Tagtest${randomUUID().slice(0, 6)}`;
    const late = [await nightlifeDay(city), await nightlifeDay(city), await nightlifeDay(city)];
    await foodDayWithABar(city);
    // Tagged only with what no description names.
    await day(city, stops(4, ["ticketed"]));
    await day(city, stops(4, ["lodging"]));

    const pages = (await publishedTagPages()).filter((page) => page.city?.slug === slugify(city));
    expect(pages.map((page) => [page.tag, page.days]).sort()).toEqual([
      ["meal", 1],
      ["nightlife", 3],
    ]);
    expect(pages[0]!.city).toMatchObject({ name: city, cities: [city] });

    const listed = await publishedDaysPage({ cities: [city], tag: "nightlife" }, { limit: 24, offset: 0 });
    expect(listed.total).toBe(3);
    expect(new Set(listed.days.map((d) => d.savedDayId))).toEqual(new Set(late));
  });

  it("has a library-wide page per tag and none for Ticketed or Lodging", async () => {
    const city = `Tagwide${randomUUID().slice(0, 6)}`;
    await nightlifeDay(city);
    await day(city, stops(4, ["ticketed", "lodging"]));
    const wide = (await publishedTagPages()).filter((page) => page.city === null);
    expect(wide.find((page) => page.tag === "nightlife")?.days).toBeGreaterThanOrEqual(1);
    expect(wide.map((page) => page.tag)).not.toContain("ticketed");
    expect(wide.map((page) => page.tag)).not.toContain("lodging");
  });
});

describe("Discover's tag filter", () => {
  it("keeps the days the tag describes, and pages them by cursor", async () => {
    const city = `Tagpage${randomUUID().slice(0, 6)}`;
    const late: string[] = [];
    for (let i = 0; i <= DISCOVER_PAGE_SIZE; i += 1) late.push(await nightlifeDay(city));
    await foodDayWithABar(city);
    const query: DiscoverQuery = {
      cities: [city], scope: "everyone", sort: "newest", budget: "any", length: "any", tag: "nightlife", readerId: null,
    };

    const first = await discoverDays(query);
    expect(first.days).toHaveLength(DISCOVER_PAGE_SIZE);
    expect(first.matchCount).toBe(DISCOVER_PAGE_SIZE + 1);
    expect(first.nextCursor).toBe(first.days.at(-1)!.savedDayId);

    const second = await discoverDays(query, first.nextCursor);
    expect(second.days).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    expect(new Set([...first.days, ...second.days].map((d) => d.savedDayId))).toEqual(new Set(late));
  });
});
