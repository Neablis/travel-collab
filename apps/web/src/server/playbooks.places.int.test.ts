import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { slugify } from "@/lib/playbookUrls";
import { db } from "./db/client";
import { savedDays } from "./db/schema";
import { placeFor, publishedDaysPage, publishedPlaces } from "./playbooks";
import { newSavedDayRow } from "./savedDays";

// Cities minted per run: the published library is global, so a shared name
// like "Kyoto" would count other tests' days. Two spellings of each, which
// differ as text and slug alike.
function spellings(): [string, string] {
  const stem = `Placetest${randomUUID().slice(0, 6)}`;
  return [`${stem} City`, `${stem}-city`];
}
const [SPELLING_A, SPELLING_B] = spellings();
const OWNER = `place-owner-${randomUUID().slice(0, 8)}`;
const ids: string[] = [];

// Rows are written directly, as `playbooks.sitemap.int.test.ts` does: what
// matters is the columns the queries filter on, not how a day gets published.
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

afterAll(async () => {
  await db.delete(savedDays).where(inArray(savedDays.id, ids));
});

describe("place pages", () => {
  it("merges spellings that slug alike, and counts only what a stranger can open", async () => {
    const a = await day("One", { cities: [SPELLING_A] });
    const b = await day("Two", { cities: [SPELLING_B] });
    await day("Private", { cities: [SPELLING_A], visibility: "private" });
    await day("Moderated", { cities: [SPELLING_A], moderatedAt: new Date() });
    await day("Deleted", { cities: [SPELLING_A], deletedAt: new Date() });

    const slug = slugify(SPELLING_A);
    expect(slugify(SPELLING_B)).toBe(slug);

    const place = await placeFor("city", slug);
    expect(place).toMatchObject({ kind: "city", slug, days: 2 });
    expect(new Set(place!.cities)).toEqual(new Set([SPELLING_A, SPELLING_B]));
    expect((await publishedPlaces()).filter((p) => p.kind === "city" && p.slug === slug)).toHaveLength(1);

    const listed = await publishedDaysPage({ cities: place!.cities }, { limit: 24, offset: 0 });
    expect(listed.total).toBe(2);
    expect(new Set(listed.days.map((d) => d.savedDayId))).toEqual(new Set([a, b]));
  });

  // The sitemap and the page both apply the threshold to `days`, which must be
  // the number of days the page lists (`total`): a day carrying two spellings
  // of one city, summed per spelling, would be three, and the place listed in
  // the sitemap but `noindex`.
  it("counts a day carrying two spellings of one city once, as the page does", async () => {
    const [one, other] = spellings();
    await day("Both", { cities: [one, other] });
    await day("One", { cities: [one] });

    const place = await placeFor("city", slugify(one));
    expect(place?.days).toBe(2);
    const listed = await publishedDaysPage({ cities: place!.cities }, { limit: 24, offset: 0 });
    expect(listed.total).toBe(place!.days);
  });

  it("pages by offset", async () => {
    // Its own city, so it runs alone (`-t`) as it runs after the others.
    const city = `Pagetest${randomUUID().slice(0, 6)}`;
    await day("First", { cities: [city] });
    await day("Second", { cities: [city] });
    const place = await placeFor("city", slugify(city));
    expect(place?.days).toBe(2);
    const first = await publishedDaysPage({ cities: place!.cities }, { limit: 1, offset: 0 });
    const second = await publishedDaysPage({ cities: place!.cities }, { limit: 1, offset: 1 });
    expect(first.days).toHaveLength(1);
    expect(second.days).toHaveLength(1);
    expect(second.days[0]!.savedDayId).not.toBe(first.days[0]!.savedDayId);
  });

  it("has no page for a slug no published day touches", async () => {
    expect(await placeFor("city", `nowhere-${randomUUID().slice(0, 8)}`)).toBeNull();
    expect(await placeFor("country", "atlantis")).toBeNull();
  });
});
