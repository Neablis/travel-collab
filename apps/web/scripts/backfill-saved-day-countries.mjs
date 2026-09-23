// Backfill for M12 link 7: fill `saved_days.countries` on every row saved
// before migration 0025 added the column — and again after the content
// bundles gain `countryCode` and are re-imported.
//
// Usage:
//   pnpm --filter web db:backfill-countries
//
// Safe to run again: it compares before it writes. It is
// `backfill-saved-day-cities.mjs` with the country rule swapped in, and every
// reason that file gives — a script and not SQL, the bridge rather than the
// domain, the path import — holds here unchanged; read it there rather than
// twice.
//
// --- Coverage, printed every run ---
// The milestone's gate box: *"the filter is not shipped over a column that is
// empty for most of the library."* On 2026-09-09 the content library carried
// `countryCode` on none of its 1,375 locations, so a clean run of this script
// could report "updated 0" over an all-empty column and look like success.
// Coverage — rows with at least one country, over all rows and over the
// published rows the country filter and `/api/places` actually read — is the
// number that says whether it was.

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { pathToFileURL } from "node:url";
import { savedDayCountries } from "../src/server/savedDayCountries.ts";
import { savedDays } from "../src/server/db/schema.ts";

/**
 * @typedef {{ withCountry: number; total: number }} Coverage
 * @param {ReturnType<typeof drizzle>} db
 * @returns {Promise<{
 *   scanned: number; updated: number; unreadable: string[]; refused: string[];
 *   coverage: { all: Coverage; published: Coverage };
 * }>}
 */
export async function backfillSavedDayCountries(db) {
  const rows = await db.select().from(savedDays);
  /** @type {string[]} */
  const unreadable = [];
  /** @type {string[]} */
  const refused = [];
  let updated = 0;
  const all = { withCountry: 0, total: 0 };
  const published = { withCountry: 0, total: 0 };

  for (const row of rows) {
    let countries = row.countries ?? [];
    // Same as the cities backfill: a non-array is reported, never read as a
    // day that visits nowhere (KI-71).
    if (!Array.isArray(row.stops)) {
      unreadable.push(row.id);
    } else {
      const derived = savedDayCountries(row.stops);
      const same =
        derived.length === countries.length && derived.every((code, i) => code === countries[i]);
      // An empty derivation over a populated column is refused for the cities
      // backfill's reason (malformed stops derive nothing) — and here for one
      // more: a re-import of bundles that LOST their codes must not silently
      // empty the filter.
      if (!same && derived.length === 0 && countries.length > 0) {
        refused.push(row.id);
      } else if (!same) {
        await db.update(savedDays).set({ countries: derived }).where(eq(savedDays.id, row.id));
        countries = derived;
        updated += 1;
      }
    }

    // Counted after the write, so the number is what the column now holds.
    // "Published" is the set `searchPlaces` and a Discover country filter read:
    // public, not deleted, not moderated — `publishedCountries`' own filter, so
    // a hidden day cannot lift the number the gate box is judged on.
    const covered = countries.length > 0 ? 1 : 0;
    all.total += 1;
    all.withCountry += covered;
    if (row.visibility === "public" && row.deletedAt === null && row.moderatedAt === null) {
      published.total += 1;
      published.withCountry += covered;
    }
  }

  return { scanned: rows.length, updated, unreadable, refused, coverage: { all, published } };
}

/** @param {Coverage} c */
function percent(c) {
  return c.total === 0 ? "n/a" : `${((100 * c.withCountry) / c.total).toFixed(1)}%`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required (local: postgres://postgres:postgres@localhost:5433/travel)");
    process.exit(1);
  }
  const pool = new pg.Pool({ connectionString: url });
  const result = await backfillSavedDayCountries(drizzle(pool));
  await pool.end();

  const current = result.scanned - result.updated - result.unreadable.length - result.refused.length;
  console.log(
    `saved_days.countries: scanned ${result.scanned}, updated ${result.updated}, already current ${current}`,
  );
  const { all, published } = result.coverage;
  console.log(`coverage (>= 1 country): all rows ${all.withCountry}/${all.total} (${percent(all)})`);
  console.log(
    `coverage (>= 1 country): published rows ${published.withCountry}/${published.total} (${percent(published)})`,
  );
  if (result.unreadable.length > 0) {
    console.error(`${result.unreadable.length} row(s) left alone — their stops are not an array:`);
    for (const id of result.unreadable) console.error(`  ${id}`);
  }
  if (result.refused.length > 0) {
    console.error(
      `${result.refused.length} row(s) left alone — their stops yield no country but the row already has some:`,
    );
    for (const id of result.refused) console.error(`  ${id}`);
  }
  if (result.unreadable.length > 0 || result.refused.length > 0) process.exit(1);
}
