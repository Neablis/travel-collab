import { randomUUID } from "node:crypto";
import { inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SavedStop, type ActivityTag } from "@tc/contracts";
import {
  type BudgetBand,
  type DiscoverResponse,
  type DiscoverSort,
  type LengthBand,
  type RatingFloor,
  type TagFilter,
} from "@/lib/playbooks";
import { db } from "./db/client";
import { savedDayRanks, savedDays } from "./db/schema";
import {
  discoverFromSnapshot,
  publishedDaysFromSnapshot,
  type LibraryEntry,
  type PublishedDaysFilter,
} from "./librarySnapshot";
import { discoverDays, publishedDaysPage, readLibrarySnapshot } from "./playbooks";
import { newSavedDayRow } from "./savedDays";

// **The snapshot answers what the SQL answers** (ADR-063, amended
// 2026-11-22). A stranger's Discover and the place, tag, length and author
// pages are worked out of one cached copy of the library rather than read per
// URL, so `librarySnapshot.ts` spells `matchPredicate`, `matchedCount` and
// `orderBy` a second time. This holds the two spellings to one answer over a
// library built to tie, to fold, to sit outside the library and to fail to
// parse — every sort, place, band and page, card for card.

const RUN = randomUUID().slice(0, 6);
const OWNERS = [`snap-a-${RUN}`, `snap-b-${RUN}`];
const CITIES = [`Snapa${RUN}`, `Snapb${RUN}`, `Snapc${RUN}`];
const COUNTRIES = [`XA${RUN}`, `XB${RUN}`];
const ids: string[] = [];

/** A small deterministic stream, so a failure reproduces. */
function stream(seed: number): () => number {
  let x = seed;
  return () => {
    x = (x * 1103515245 + 12345) % 2147483648;
    return x / 2147483648;
  };
}

const stop = (i: number, day: number, tags: ActivityTag[], amountMinor: number | null): SavedStop =>
  SavedStop.parse({
    title: `Stop ${i}`,
    timeWindow: null,
    location: null,
    notes: null,
    anchors: [],
    kind: "planned",
    tags,
    cost: amountMinor === null ? null : { amountMinor, currency: "USD" },
    dayIndex: day,
  });

const AT = Date.UTC(2026, 0, 1, 12);

beforeAll(async () => {
  const next = stream(7);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)]!;
  for (let n = 0; n < 40; n += 1) {
    // Few distinct values, so every key ties often and the next key decides.
    const dayCount = pick([1, 1, 2, 3, 4, 7]);
    const tags: ActivityTag[] = pick([["nightlife"], ["meal"], ["meal", "nightlife"]]);
    const stops = Array.from({ length: 4 }, (_, i) =>
      stop(i, i % dayCount, tags, pick([null, 5_000, 15_000, 40_000])),
    );
    // A city in two spellings: "snapa…" must match "Snapa…" (KI-2026-10-05-d).
    const cities = [...new Set([pick([CITIES[0]!, CITIES[0]!.toLowerCase(), CITIES[1]!]), pick(CITIES)])];
    const createdAt = new Date(AT - pick([0, 1, 2, 3]) * 60_000);
    const row = newSavedDayRow({
      ownerId: pick(OWNERS),
      name: `Snapshot day ${n}`,
      stops,
      sourceTripId: randomUUID(),
      sourceTripName: "Source",
      createdAt,
    });
    ids.push(row.id);
    const rated = next() < 0.6;
    await db.insert(savedDays).values({
      ...row,
      dayCount,
      cities,
      countries: next() < 0.5 ? [] : [pick(COUNTRIES)],
      visibility: "public",
      publishedAt: next() < 0.2 ? null : new Date(AT - pick([0, 1, 2]) * 60_000),
      adds: pick([0, 0, 1, 2]),
      rating: rated ? pick([3, 4, 4.5, 5]) : null,
      reviewCount: rated ? pick([1, 2, 2, 5]) : 0,
    });
    if (next() < 0.5) {
      await db.insert(savedDayRanks).values({
        savedDayId: row.id,
        score: pick([0.5, 1, 1, 2]),
        addsRecent: 0,
        commentsRecent: 0,
        quality: 1,
        newDayLift: 1,
        computedAt: new Date(),
      });
    }
  }
  // Outside the library: private, deleted, moderated. Neither spelling may list them.
  for (const columns of [
    { visibility: "private" as const, publishedAt: null },
    { deletedAt: new Date() },
    { moderatedAt: new Date() },
  ]) {
    const row = newSavedDayRow({
      ownerId: OWNERS[0]!,
      name: "Not in the library",
      stops: [stop(0, 0, ["meal"], null)],
      sourceTripId: randomUUID(),
      sourceTripName: "Source",
      createdAt: new Date(AT),
    });
    ids.push(row.id);
    await db.insert(savedDays).values({ ...row, cities: [CITIES[0]!], visibility: "public", publishedAt: new Date(AT), ...columns });
  }
  // In the library and unreadable: ranked and counted by both, carded by neither.
  const broken = newSavedDayRow({
    ownerId: OWNERS[1]!,
    name: "Unreadable",
    stops: [stop(0, 0, ["meal"], null)],
    sourceTripId: randomUUID(),
    sourceTripName: "Source",
    createdAt: new Date(AT),
  });
  ids.push(broken.id);
  await db.insert(savedDays).values({ ...broken, cities: [CITIES[0]!], visibility: "public", publishedAt: new Date(AT), adds: 9 });
  await db.execute(sql`update saved_days set stops = '[{"bogus": true}]'::jsonb where id = ${broken.id}`);
});

afterAll(async () => {
  await db.delete(savedDayRanks).where(inArray(savedDayRanks.savedDayId, ids));
  await db.delete(savedDays).where(inArray(savedDays.id, ids));
});

const SORTS: DiscoverSort[] = ["top", "most-added", "highest-rated", "most-reviewed", "newest"];

/** Every place this suite can ask about, alone and together. Nothing else in the database is in them. */
const PLACES: { cities: string[]; countries: string[] }[] = [
  { cities: [CITIES[0]!], countries: [] },
  { cities: [CITIES[0]!.toLowerCase(), CITIES[1]!], countries: [] },
  { cities: CITIES, countries: [] },
  { cities: [], countries: [COUNTRIES[0]!] },
  { cities: [CITIES[2]!], countries: COUNTRIES },
];

/** The SQL's answer and the snapshot's, with the library-wide count set aside: other suites' days are in it. */
async function bothDiscover(
  entries: LibraryEntry[],
  search: { cities: string[]; countries: string[]; sort: DiscoverSort; budget: BudgetBand; length: LengthBand; rating: RatingFloor; tag: TagFilter },
  after: string | null,
): Promise<[DiscoverResponse, DiscoverResponse]> {
  const live = await discoverDays({ ...search, scope: "everyone", readerId: null }, after);
  const snapshot = discoverFromSnapshot(entries, { ...search, authorId: null }, after);
  return [
    { ...live, sharedPlaybookCount: 0 },
    { ...snapshot, sharedPlaybookCount: 0 },
  ];
}

describe("the library snapshot", () => {
  it("holds every published day once, and nothing outside the library", async () => {
    const entries = await readLibrarySnapshot();
    const ours = entries.filter((entry) => ids.includes(entry.id));

    expect(ours).toHaveLength(41);
    expect(ours.filter((entry) => entry.card === null)).toHaveLength(1);
  });

  it("answers every stranger's Discover search as the SQL does, page for page", async () => {
    const entries = await readLibrarySnapshot();
    const filters: { budget: BudgetBand; length: LengthBand; rating: RatingFloor; tag: TagFilter }[] = [
      { budget: "any", length: "any", rating: "any", tag: "any" },
      { budget: "under200", length: "any", rating: "any", tag: "any" },
      { budget: "any", length: "two-three", rating: "4", tag: "any" },
      { budget: "any", length: "any", rating: "any", tag: "nightlife" },
    ];
    let compared = 0;
    for (const sort of SORTS) {
      for (const place of PLACES) {
        for (const filter of filters) {
          const search = { ...place, sort, ...filter };
          let after: string | null = null;
          for (let pages = 0; ; pages += 1) {
            const [live, snapshot] = await bothDiscover(entries, search, after);
            expect(snapshot, JSON.stringify({ search, after })).toEqual(live);
            compared += live.days.length;
            after = live.nextCursor;
            if (after === null) break;
            if (pages > 10) throw new Error("the cursor never ended");
          }
        }
      }
    }
    // Not a comparison of empty lists.
    expect(compared).toBeGreaterThan(500);
  });

  it("pages Discover by a cursor taken from any ranked day, as the SQL does", async () => {
    const entries = await readLibrarySnapshot();
    const search = { cities: CITIES, countries: [], sort: "top" as const, budget: "any" as const, length: "any" as const, rating: "any" as const, tag: "any" as const };
    // Every day in the library, the unreadable one too; not the three outside
    // it, which the snapshot reads as no cursor (`discoverFromSnapshot`).
    const inLibrary = new Set(entries.map((entry) => entry.id));
    const cursors = ids.filter((id) => inLibrary.has(id));
    expect(cursors).toHaveLength(41);
    for (const id of cursors) {
      const [live, snapshot] = await bothDiscover(entries, search, id);
      expect(snapshot, id).toEqual(live);
    }
  });

  it("answers every place, tag, length and author page as the SQL does", async () => {
    const entries = await readLibrarySnapshot();
    const filters: PublishedDaysFilter[] = [
      ...PLACES.map(({ cities, countries }) => ({ cities, countries })),
      { cities: [CITIES[0]!], tag: "nightlife" },
      { countries: [COUNTRIES[0]!], length: "two-three" },
      { countries: COUNTRIES, citiesWithin: [CITIES[2]!] },
      { authorId: OWNERS[0]! },
      { authorId: OWNERS[1]!, sort: "newest" },
    ];
    for (const filter of filters) {
      for (const page of [
        { limit: 24, offset: 0 },
        { limit: 5, offset: 5 },
        { limit: 24, offset: 100 },
      ]) {
        const live = await publishedDaysPage(filter, page);
        expect(publishedDaysFromSnapshot(entries, filter, page), JSON.stringify({ filter, page })).toEqual(live);
      }
    }
  });
});
