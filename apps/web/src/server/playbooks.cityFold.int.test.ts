import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { db } from "./db/client";
import { savedDays } from "./db/schema";
import { discoverDays, type DiscoverQuery } from "./playbooks";
import { newSavedDayRow } from "./savedDays";

// KI-2026-10-05-d: Discover matched a city by its exact spelling, so a day
// stored as "kyoto" was never found by a search for "Kyoto", nor "Sao Paulo"
// by "São Paulo". Cities are minted per run because the library is global.
const OWNER = `fold-owner-${randomUUID().slice(0, 8)}`;
const ids: string[] = [];

async function day(name: string, cities: string[]): Promise<string> {
  const row = newSavedDayRow({
    ownerId: OWNER,
    name,
    stops: [],
    sourceTripId: randomUUID(),
    sourceTripName: "Source",
    createdAt: new Date(),
  });
  await db.insert(savedDays).values({ ...row, cities, visibility: "public", publishedAt: new Date() });
  ids.push(row.id);
  return row.id;
}

function search(cities: string[]): Promise<Awaited<ReturnType<typeof discoverDays>>> {
  const query: DiscoverQuery = {
    cities, scope: "everyone", sort: "newest", budget: "any", length: "any", readerId: OWNER,
  };
  return discoverDays(query);
}

afterAll(async () => {
  await db.delete(savedDays).where(inArray(savedDays.id, ids));
});

describe("Discover's city filter, across spellings of one city", () => {
  it("finds a day whose city is stored in another case", async () => {
    const stem = `kyototest${randomUUID().slice(0, 6)}`;
    const id = await day("Lowercase", [stem]);
    const capitalised = stem[0]!.toUpperCase() + stem.slice(1);

    const same = await search([stem]);
    expect(same.days.map((d) => d.savedDayId), "same case").toContain(id);
    const other = await search([capitalised]);
    expect(other.days.map((d) => d.savedDayId), "other case").toContain(id);
    // The card says which of ITS cities matched, in its own spelling.
    expect(other.days.find((d) => d.savedDayId === id)?.matchedCities).toEqual([stem]);
  });

  it("finds a day whose city is stored without its accent", async () => {
    const stem = randomUUID().slice(0, 6);
    const id = await day("Unaccented", [`Sao Paulo ${stem}`]);

    const accented = await search([`São Paulo ${stem}`]);
    expect(accented.days.map((d) => d.savedDayId), "accented").toContain(id);
  });

  // The entry's warning: two spellings of one city are one city, in the
  // ranking's matched count and in the sibling chips alike.
  it("counts two spellings of one city as one city", async () => {
    const stem = `Foldtest${randomUUID().slice(0, 6)}`;
    const other = `Othertest${randomUUID().slice(0, 6)}`;
    // Both spellings on one day, and a second city on each day.
    const both = await day("Both spellings", [stem, stem.toLowerCase(), other]);
    const one = await day("One spelling", [stem.toUpperCase(), other.toLowerCase()]);

    // Asked by both spellings: each day matches ONE city, so neither outranks
    // the other on matched count and `newest` decides — the later insert first.
    const found = await search([stem, stem.toUpperCase()]);
    expect(found.days.map((d) => d.savedDayId)).toEqual([one, both]);
    // No chip for a spelling of the asked-for city, and one chip for `other`
    // counting both days, however each spells it.
    expect(found.siblings).toEqual([{ city: other.toLowerCase(), days: 2 }]);
  });
});
