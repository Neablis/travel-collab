import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { SavedStop } from "@tc/contracts";
import type { DiscoverScope, YoursVisibility } from "@/lib/playbooks";
import { db } from "./db/client";
import { savedDays } from "./db/schema";
import { discoverDays } from "./playbooks";
import { newSavedDayRow } from "./savedDays";

// *Yours*' public / private question (Mitchell, 2026-11-16: "There should be a
// filter when on yours tab to filter on public/private/all"). A question about
// *Yours* only: the query narrows your own days by `visibility` there, and
// asks nothing under any other scope, whatever the request says.

const READER = `vis-reader-${randomUUID().slice(0, 8)}`;
const OTHER = `vis-other-${randomUUID().slice(0, 8)}`;
const ids: string[] = [];

const STOPS: SavedStop[] = [
  SavedStop.parse({
    title: "A stop",
    timeWindow: null,
    location: null,
    notes: null,
    anchors: [],
    kind: "planned",
    tags: [],
    cost: null,
  }),
];

/** `minutes` before a fixed hour, so `newest` ranks the days in the order a test lists them. */
const ago = (minutes: number) => new Date(Date.UTC(2026, 0, 1, 12) - minutes * 60_000);

// Written directly, as `playbooks.tags.int.test.ts` does: what matters is the
// columns the query reads.
async function day(
  city: string,
  owner: string,
  visibility: "public" | "private",
  minutesAgo: number,
): Promise<string> {
  const at = ago(minutesAgo);
  const row = newSavedDayRow({
    ownerId: owner,
    name: `Day ${ids.length}`,
    stops: STOPS,
    sourceTripId: randomUUID(),
    sourceTripName: "Source",
    createdAt: at,
  });
  ids.push(row.id);
  await db
    .insert(savedDays)
    .values({ ...row, cities: [city], visibility, publishedAt: visibility === "public" ? at : null });
  return row.id;
}

afterAll(async () => {
  await db.delete(savedDays).where(inArray(savedDays.id, ids));
});

describe("Yours' public / private question", () => {
  async function library() {
    const city = `Vistest${randomUUID().slice(0, 6)}`;
    const mineShared = await day(city, READER, "public", 1);
    const minePrivate = await day(city, READER, "private", 2);
    const mineSharedOlder = await day(city, READER, "public", 3);
    const theirs = await day(city, OTHER, "public", 4);
    // Somebody else's private day, which no question can open to the reader.
    await day(city, OTHER, "private", 5);
    return { city, mineShared, minePrivate, mineSharedOlder, theirs };
  }

  const ask = (city: string, scope: DiscoverScope, visibility?: YoursVisibility) =>
    discoverDays({
      cities: [city],
      scope,
      sort: "newest",
      budget: "any",
      length: "any",
      readerId: READER,
      ...(visibility === undefined ? {} : { visibility }),
    });

  it("narrows Yours to the days you shared, or the ones you kept private, and All is every one", async () => {
    const lib = await library();
    const ids = async (visibility?: YoursVisibility) => (await ask(lib.city, "yours", visibility)).days.map((d) => d.savedDayId);

    expect(await ids()).toEqual([lib.mineShared, lib.minePrivate, lib.mineSharedOlder]);
    expect(await ids("all")).toEqual([lib.mineShared, lib.minePrivate, lib.mineSharedOlder]);
    expect(await ids("public")).toEqual([lib.mineShared, lib.mineSharedOlder]);
    expect(await ids("private")).toEqual([lib.minePrivate]);
  });

  // The count over the cards is the narrowed set's, not Yours' whole.
  it("counts the narrowed set", async () => {
    const lib = await library();
    const found = await ask(lib.city, "yours", "private");
    expect([found.matchCount, found.matchCountExact]).toEqual([1, true]);
  });

  // Under Everyone and Saved the question has no honest answer, so a
  // hand-edited `?visibility=private` there changes nothing.
  it("asks nothing under Everyone", async () => {
    const lib = await library();
    const everyone = (await ask(lib.city, "everyone")).days.map((d) => d.savedDayId);
    expect(everyone).toEqual([lib.mineShared, lib.minePrivate, lib.mineSharedOlder, lib.theirs]);
    expect((await ask(lib.city, "everyone", "private")).days.map((d) => d.savedDayId)).toEqual(everyone);
    expect((await ask(lib.city, "everyone", "public")).days.map((d) => d.savedDayId)).toEqual(everyone);
  });
});
