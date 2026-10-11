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
function rowOf(city: string, dayStops: SavedStop[], publishedAt: Date) {
  const row = newSavedDayRow({
    ownerId: OWNER,
    name: `Day ${ids.length}`,
    stops: dayStops,
    sourceTripId: randomUUID(),
    sourceTripName: "Source",
    createdAt: publishedAt,
  });
  ids.push(row.id);
  return { ...row, cities: [city], visibility: "public" as const, publishedAt };
}

async function day(city: string, dayStops: SavedStop[], publishedAt = new Date()): Promise<string> {
  const row = rowOf(city, dayStops, publishedAt);
  await db.insert(savedDays).values(row);
  return row.id;
}

const LATE_NIGHT = stops(4, ["nightlife"]);
const FOOD_AND_A_BAR = [...stops(4, ["meal"]), ...stops(1, ["nightlife"])];
/** A day of four nightlife stops: "Late-night". */
const nightlifeDay = (city: string, publishedAt?: Date) => day(city, LATE_NIGHT, publishedAt);
/** Four meals and one bar: "Foodie", and carrying a Nightlife stop. */
const foodDayWithABar = (city: string, publishedAt?: Date) => day(city, FOOD_AND_A_BAR, publishedAt);

/** `minutes` before a fixed hour, so `newest` ranks the days in the order a test lists them. */
const ago = (minutes: number) => new Date(Date.UTC(2026, 0, 1, 12) - minutes * 60_000);

const newestIn = (city: string): DiscoverQuery => ({
  cities: [city], scope: "everyone", sort: "newest", budget: "any", length: "any", tag: "nightlife", readerId: null,
});

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
    const query = newestIn(city);

    const first = await discoverDays(query);
    expect(first.days).toHaveLength(DISCOVER_PAGE_SIZE);
    expect(first.matchCount).toBe(DISCOVER_PAGE_SIZE + 1);
    expect(first.nextCursor).toBe(first.days.at(-1)!.savedDayId);

    const second = await discoverDays(query, first.nextCursor);
    expect(second.days).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    expect(new Set([...first.days, ...second.days].map((d) => d.savedDayId))).toEqual(new Set(late));
  });

  // The card says which of its chips are pages it is on: the meals-and-a-bar
  // day carries Nightlife and is on Food's page only.
  it("names on each card the tags its description names", async () => {
    const city = `Tagnamed${randomUUID().slice(0, 6)}`;
    const id = await foodDayWithABar(city);
    const { days } = await discoverDays({ ...newestIn(city), tag: "any" });
    const card = days.find((d) => d.savedDayId === id)!;
    expect([card.tags, card.namedTags]).toEqual([["meal", "nightlife"], ["meal"]]);
  });

  // A filtered-out row where one page ends: page one still holds a full page,
  // page two starts after its last card, and the row never shows.
  it("skips a filtered-out row at a page's edge, on either side of it", async () => {
    const city = `Tagedge${randomUUID().slice(0, 6)}`;
    const late: string[] = [];
    for (let i = 0; i < DISCOVER_PAGE_SIZE; i += 1) late.push(await nightlifeDay(city, ago(i)));
    await foodDayWithABar(city, ago(DISCOVER_PAGE_SIZE));
    const first = await discoverDays(newestIn(city));
    // Twenty-four, then only the dinner: no next page, rather than an empty one.
    expect([first.days.map((d) => d.savedDayId), first.nextCursor]).toEqual([late, null]);

    const lastOne = await nightlifeDay(city, ago(DISCOVER_PAGE_SIZE + 1));
    const again = await discoverDays(newestIn(city));
    expect(again.nextCursor).toBe(late.at(-1));
    const second = await discoverDays(newestIn(city), again.nextCursor);
    expect([second.days.map((d) => d.savedDayId), second.nextCursor]).toEqual([[lastOne], null]);
  });

  // A cursor nothing can read, or that names no row, is page one.
  it("reads a stale or malformed cursor as page one", async () => {
    const city = `Tagstale${randomUUID().slice(0, 6)}`;
    for (let i = 0; i < 3; i += 1) await nightlifeDay(city, ago(i));
    const first = await discoverDays(newestIn(city));
    for (const after of ["not-a-cursor", randomUUID()]) {
      const page = await discoverDays(newestIn(city), after);
      expect(page.days.map((d) => d.savedDayId), after).toEqual(first.days.map((d) => d.savedDayId));
    }
  });

  // Past the 200-row window the count of a tag search is a floor, since the
  // tag cannot be a predicate, while its pages still reach every match.
  it("past the candidate window, counts a tag search as a floor and still lists every match", async () => {
    const city = `Tagwindow${randomUUID().slice(0, 6)}`;
    // Two hundred newer dinners fill the window; the three late nights are past it.
    await db.insert(savedDays).values(Array.from({ length: 200 }, (_, i) => rowOf(city, FOOD_AND_A_BAR, ago(i))));
    const late = [await nightlifeDay(city, ago(300)), await nightlifeDay(city, ago(301)), await nightlifeDay(city, ago(302))];

    const found = await discoverDays(newestIn(city));
    expect([found.matchCount, found.matchCountExact]).toEqual([3, false]);
    expect([found.days.map((d) => d.savedDayId), found.nextCursor]).toEqual([late, null]);
  });
});
