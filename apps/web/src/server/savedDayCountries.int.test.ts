import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { SavedStop } from "@tc/contracts";
import { locationFactory } from "@tc/factories";
import { backfillSavedDayCountries } from "../../scripts/backfill-saved-day-countries.mjs";
import { db } from "./db/client";
import { savedDays } from "./db/schema";

// The `countries` backfill (M12 link 7), driven through its export against
// real Postgres — the same arrangement `savedDayAdds.int.test.ts` has for the
// cities backfill, so it is covered by a test rather than by having been run
// once on one laptop.

let OWNER = "";

beforeEach(() => {
  OWNER = `countries-owner-${randomUUID().slice(0, 8)}`;
});

function stop(title: string, start: string, location: SavedStop["location"]): SavedStop {
  return {
    title,
    timeWindow: { start, end: start },
    location,
    notes: null,
    anchors: [],
    kind: "planned",
    tags: [],
    cost: null,
    dayIndex: 0,
  };
}

/**
 * A row as it stood before 0025 or before the bundles carried codes: real
 * stops, and the column's default. Inserted directly because every app write
 * path now derives `countries`, which is exactly the state this cannot be in.
 */
async function rowWithoutCountries(
  stops: SavedStop[],
  visibility: "private" | "public" = "private",
): Promise<string> {
  const id = randomUUID();
  await db.insert(savedDays).values({
    id,
    ownerId: OWNER,
    name: "Saved before 0025",
    stops,
    cities: [],
    visibility,
    publishedAt: visibility === "public" ? new Date("2026-08-02T00:00:00.000Z") : null,
    sourceTripId: randomUUID(),
    sourceTripName: "Mexico",
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
  });
  return id;
}

const countriesOf = async (id: string) =>
  (await db.select().from(savedDays).where(eq(savedDays.id, id)))[0]?.countries;

describe("the 0025 countries backfill", () => {
  it("fills a row from its stops' country codes, once per country", async () => {
    const id = await rowWithoutCountries([
      stop("Zócalo", "09:00", locationFactory.build({ name: "Zócalo", city: "Mexico City", countryCode: "MX" })),
      stop("Catedral", "13:00", locationFactory.build({ name: "Catedral", city: "Puebla", countryCode: "MX" })),
    ]);
    const result = await backfillSavedDayCountries(db);

    expect(result.updated).toBeGreaterThan(0);
    expect(await countriesOf(id)).toEqual(["MX"]);
  });

  it("is safe to run twice", async () => {
    const id = await rowWithoutCountries([
      stop("Palais", "10:00", locationFactory.build({ name: "Palais", city: "Monaco", countryCode: "MC" })),
    ]);
    await backfillSavedDayCountries(db);
    await backfillSavedDayCountries(db);
    expect(await countriesOf(id)).toEqual(["MC"]);
  });

  // The library's state on 2026-09-09: cities and coordinates, no codes. The
  // backfill must leave such a row empty — never guess a country from a city.
  it("leaves a row whose stops carry no country code empty", async () => {
    const id = await rowWithoutCountries([
      stop("Fushimi Inari", "09:00", { name: "Fushimi Inari", city: "Kyoto" }),
    ]);
    await backfillSavedDayCountries(db);
    expect(await countriesOf(id)).toEqual([]);
  });

  it("refuses to clear a populated countries when the stops derive none", async () => {
    const id = await rowWithoutCountries([stop("Uncoded", "09:00", { name: "Uncoded", city: "Kyoto" })]);
    await db.update(savedDays).set({ countries: ["JP"] }).where(eq(savedDays.id, id));

    const result = await backfillSavedDayCountries(db);
    expect(result.refused).toContain(id);
    expect(await countriesOf(id)).toEqual(["JP"]);

    // Otherwise a real `db:backfill-countries` run on a machine that has run
    // this suite would exit non-zero over a fixture.
    await db.delete(savedDays).where(eq(savedDays.id, id));
  });

  // The gate box is "coverage is measured and written down", so the measure
  // must be the column's state AFTER the run — asserted against the table
  // itself, not against the script's own arithmetic.
  it("reports coverage as the column now stands, overall and for published rows", async () => {
    await rowWithoutCountries(
      [stop("Zócalo", "09:00", locationFactory.build({ name: "Zócalo", city: "Mexico City", countryCode: "MX" }))],
      "public",
    );
    // A moderated day is out of place search (D5), so it must be out of the
    // published count too — without one in the table the two filters agree.
    const moderated = await rowWithoutCountries(
      [stop("Palais", "10:00", locationFactory.build({ name: "Palais", city: "Monaco", countryCode: "MC" }))],
      "public",
    );
    await db.update(savedDays).set({ moderatedAt: new Date() }).where(eq(savedDays.id, moderated));
    const { coverage } = await backfillSavedDayCountries(db);

    const measured = await db.execute<{ all_with: number; all: number; pub_with: number; pub: number }>(sql`
      select
        count(*) filter (where cardinality(countries) > 0)::int as all_with,
        count(*)::int as all,
        count(*) filter (where visibility = 'public' and deleted_at is null and moderated_at is null and cardinality(countries) > 0)::int as pub_with,
        count(*) filter (where visibility = 'public' and deleted_at is null and moderated_at is null)::int as pub
      from saved_days
    `);
    const row = measured.rows[0]!;
    expect(coverage.all).toEqual({ withCountry: Number(row.all_with), total: Number(row.all) });
    expect(coverage.published).toEqual({ withCountry: Number(row.pub_with), total: Number(row.pub) });
    expect(coverage.published.withCountry).toBeGreaterThan(0);
  });
});
