import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { SavedDayVisibility } from "@tc/contracts";
import { db } from "@/server/db/client";
import { savedDays, users } from "@/server/db/schema";
import { executeTripCommand } from "@/server/commands";
import { getTripDetail } from "@/server/projections";
import { saveDay, setSavedDayVisibility } from "@/server/savedDays";
import { entitleAccounts } from "@/server/test-support/entitledAccount";
import { playbookCityCopy, playbookDayCopy, playbookProfileCopy } from "./copy";
import { cityCardFor, countryCardFor, dayCardFor, profileCardFor } from "./playbooks";

// The Playbooks link-preview lookups (spec 2026-10-02 §2.7). Under test is
// what a stranger holding a link learns: a published day's name and its
// author's PUBLIC name, "Dana R." (Mitchell, 2026-10-02) — never the surname or
// the address, which are seeded so they are there to leak — and the generic
// card for every day, person or city a signed-out reader could not open.
//
// Cities are minted per run: the city count is over every published day in
// the database, so a shared name would make it a function of other files.

const run = randomUUID().slice(0, 8);
const OWNER = `dev-og-pb-owner-${run}`;
const NOBODY = `dev-og-pb-nobody-${run}`;
const CITY = `Kyotoish${run}`;
const OTHER_CITY = `Naraish${run}`;
const PUBLIC_NAME = "Dana R.";

/** A one-day playbook by OWNER with one stop per city, published unless told not to. */
async function seedDay(
  name: string,
  cities: string[],
  visibility: SavedDayVisibility = SavedDayVisibility.enum.public,
): Promise<string> {
  const tripId = randomUUID();
  const dayId = randomUUID();
  await executeTripCommand({ type: "CreateTrip", tripId, name: "Source" }, OWNER);
  await executeTripCommand({ type: "AddDay", tripId, dayId }, OWNER);
  for (const [i, city] of cities.entries()) {
    const result = await executeTripCommand(
      {
        type: "AddActivity",
        tripId,
        activityId: randomUUID(),
        dayId,
        title: `Stop in ${city}`,
        timeWindow: { start: `${String(i + 8).padStart(2, "0")}:00`, end: `${String(i + 9).padStart(2, "0")}:00` },
        location: { name: `Somewhere in ${city}`, city },
      },
      OWNER,
    );
    if (!result.ok) throw new Error("failed to seed a stop");
  }
  const detail = await getTripDetail(tripId);
  if (detail === null) throw new Error("no trip");
  const saved = await saveDay({ name, dayIds: [dayId] }, detail, OWNER);
  if (!saved.ok) throw new Error(saved.error.message);
  await setSavedDayVisibility(saved.value.savedDayId, OWNER, visibility);
  return saved.value.savedDayId;
}

let published = "";
let privateDay = "";
let moderated = "";
let deleted = "";

beforeAll(async () => {
  await entitleAccounts([OWNER]);
  await db
    .update(users)
    .set({ name: "Dana Reyes", displayName: "Dana Reyes", email: "dana@example.com" })
    .where(eq(users.id, OWNER));
  published = await seedDay("Temples before the crowds", [CITY, OTHER_CITY]);
  // A fixture write, as the board tests do: the counters are `reviews.ts`'s.
  await db.update(savedDays).set({ rating: 4.62, reviewCount: 12 }).where(eq(savedDays.id, published));
  privateDay = await seedDay("Kept to myself", [CITY], SavedDayVisibility.enum.private);
  moderated = await seedDay("Hidden by an operator", [CITY]);
  await db.update(savedDays).set({ moderatedAt: new Date() }).where(eq(savedDays.id, moderated));
  // Published AND deleted, so it is the deletion that hides it.
  deleted = await seedDay("Gone", [CITY]);
  await db.update(savedDays).set({ deletedAt: new Date() }).where(eq(savedDays.id, deleted));
});

/** Everything a card would print, as one string to search for leaks. */
const printed = (...values: unknown[]) => JSON.stringify(values);

describe("dayCardFor", () => {
  it("draws a published day with its name, cities, facts, rating and the author's public name", async () => {
    const card = await dayCardFor(published);

    expect(card).toEqual({
      kind: "day",
      name: "Temples before the crowds",
      cities: [CITY, OTHER_CITY],
      dayCount: 1,
      stopCount: 2,
      author: PUBLIC_NAME,
      rating: 4.62,
      reviewCount: 12,
    });
    expect(playbookDayCopy(card).description).toBe(
      `${CITY}, ${OTHER_CITY} · 2 stops · by ${PUBLIC_NAME} · rated 4.6 from 12 reviews`,
    );
  });

  it("never prints the author's surname or address", async () => {
    const card = await dayCardFor(published);

    const text = printed(card, playbookDayCopy(card));
    for (const leak of ["Reyes", "dana@", "example.com"]) expect(text).not.toContain(leak);
  });

  it.each([
    ["a private day", () => privateDay],
    ["a moderated day", () => moderated],
    ["a deleted day", () => deleted],
    ["an unknown id", () => randomUUID()],
    ["an id that is not a uuid", () => "not-a-uuid"],
  ])("gives %s the generic card", async (_state, id) => {
    expect(await dayCardFor(id())).toEqual({ kind: "generic" });
  });
});

describe("profileCardFor", () => {
  it("draws someone who has shared, by public name, with their numbers and the cities they know", async () => {
    const card = await profileCardFor(OWNER);

    // The private, moderated and deleted days count for nothing here.
    expect(card).toEqual({ kind: "profile", author: PUBLIC_NAME, playbooksShared: 1, adds: 0, cities: [CITY, OTHER_CITY] });
    const text = printed(card, playbookProfileCopy(card));
    for (const leak of ["Reyes", "dana@"]) expect(text).not.toContain(leak);
  });

  it.each([
    ["someone with nothing shared", () => NOBODY],
    ["an id nobody has", () => `no-such-user-${run}`],
  ])("gives %s the generic card", async (_state, id) => {
    expect(await profileCardFor(id())).toEqual({ kind: "generic" });
  });
});

describe("cityCardFor", () => {
  it("counts only the published, live, unmoderated days in a city", async () => {
    const card = await cityCardFor(CITY);

    expect(card).toEqual({ kind: "city", city: CITY, days: 1 });
    expect(playbookCityCopy(card).title).toBe(`${CITY} playbooks`);
  });

  it.each([
    ["a city no day touches", () => `Nowhere${run}`],
    ["the right letters in the wrong case, which Discover would not match either", () => CITY.toLowerCase()],
    ["an empty city", () => ""],
  ])("gives %s the generic card", async (_state, city) => {
    expect(await cityCardFor(city())).toEqual({ kind: "generic" });
  });
});

describe("countryCardFor", () => {
  // Tuvalu, so no other file's day is counted: the count is library-wide.
  // "XX" rides the published day too, so a code with no name is refused for
  // being one, not for being on no day.
  it("names a country by its English name and counts only the days a stranger could open", async () => {
    await db
      .update(savedDays)
      .set({ countries: ["TV", "XX"] })
      .where(inArray(savedDays.id, [published, privateDay, moderated, deleted]));

    expect(await countryCardFor("TV")).toEqual({ kind: "country", country: "Tuvalu", days: 1 });
  });

  it.each([
    ["a country no day touches", "AQ"],
    ["a code that names no country", "XX"],
  ])("gives %s the generic card", async (_state, code) => {
    expect(await countryCardFor(code)).toEqual({ kind: "generic" });
  });
});
