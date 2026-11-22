import { describe, expect, it } from "vitest";
import type { DiscoverDay } from "@/lib/playbooks";
import { discoverFromSnapshot, type LibraryEntry } from "./librarySnapshot";

// What the snapshot does that the SQL does not, and what it must set per query
// on a card it read once for everyone. That it otherwise answers as the SQL
// does is `librarySnapshot.int.test.ts`'s, against a real database.

const AT = Date.UTC(2026, 0, 1, 12);

/** A published day `id` in `cities`, readable unless `card` is false, with `adds` adds. */
function entry(id: string, cities: string[], adds: number, card = true): LibraryEntry {
  const day = {
    savedDayId: id,
    ownerId: "owner",
    ownerDisplayName: "Owner",
    name: id,
    cities,
    matchedCities: [],
    stopCount: 1,
    dayCount: 1,
    window: null,
    preview: [],
    totalCost: null,
    adds,
    rating: null,
    reviewCount: 0,
    visibility: "public",
    authorKind: "human",
    sourceTripName: "Source",
    createdAt: new Date(AT).toISOString(),
    publishedAt: new Date(AT).toISOString(),
    isMine: false,
    cover: null,
    description: null,
    tags: [],
    namedTags: [],
    linkedTags: [],
  } as unknown as DiscoverDay;
  return {
    id,
    card: card ? day : null,
    ownerId: "owner",
    citiesFolded: cities.map((city) => city.toLowerCase()),
    countries: [],
    dayCount: 1,
    adds,
    rating: null,
    reviewCount: 0,
    score: null,
    createdAt: AT,
    publishedAt: AT,
  };
}

const QUERY = {
  cities: [] as string[],
  countries: [] as string[],
  sort: "most-added" as const,
  budget: "any" as const,
  length: "any" as const,
  authorId: null,
};

// Ids sort as uuids do, so `adds` alone decides the order here.
const LIBRARY = [
  entry("00000000-0000-4000-8000-000000000001", ["Kyoto"], 3),
  entry("00000000-0000-4000-8000-000000000002", ["Osaka", "Kyoto"], 2),
  entry("00000000-0000-4000-8000-000000000003", ["Nara"], 1, false),
  entry("00000000-0000-4000-8000-000000000004", ["Osaka"], 0),
];

describe("Discover over the library snapshot", () => {
  it("pages from the cursor's rank", () => {
    const after = discoverFromSnapshot(LIBRARY, QUERY, LIBRARY[0]!.id);

    expect(after.days.map((day) => day.name)).toEqual([LIBRARY[1]!.id, LIBRARY[3]!.id]);
  });

  // The SQL ranks from a private or deleted day's keys; only a hand-made URL
  // can name one, and page one costs no read.
  it("reads a cursor that names no day in the snapshot as no cursor", () => {
    const pageOne = discoverFromSnapshot(LIBRARY, QUERY, null);

    expect(discoverFromSnapshot(LIBRARY, QUERY, "00000000-0000-4000-8000-0000000000ff")).toEqual(pageOne);
    expect(discoverFromSnapshot(LIBRARY, QUERY, "not a uuid")).toEqual(pageOne);
    expect(pageOne.days.map((day) => day.name)).toEqual([LIBRARY[0]!.id, LIBRARY[1]!.id, LIBRARY[3]!.id]);
  });

  it("works out each card's matched cities for the cities asked, by their key", () => {
    const answer = discoverFromSnapshot(LIBRARY, { ...QUERY, cities: ["kyoto"] }, null);

    expect(answer.days.map((day) => day.matchedCities)).toEqual([["Kyoto"], ["Kyoto"]]);
    // Read once for everyone, so nothing on it is the reader's.
    expect(answer.days.every((day) => !day.isMine)).toBe(true);
  });

  // `publishedPlaybookCount` counts rows, read or not.
  it("counts the whole library, an unreadable day too, whatever was asked", () => {
    expect(discoverFromSnapshot(LIBRARY, { ...QUERY, cities: ["Nara"] }, null)).toMatchObject({
      days: [],
      matchCount: 0,
      sharedPlaybookCount: 4,
    });
  });
});
