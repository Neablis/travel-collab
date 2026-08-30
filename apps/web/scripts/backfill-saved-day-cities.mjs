// One-shot backfill for M11b link 1: fill `saved_days.cities` on every row
// saved before migration 0012 added the column.
//
// Usage:
//   pnpm --filter web db:backfill-cities
//
// Run once per environment, right after 0012 is applied. Safe to run again —
// it compares before it writes, so a re-run after a partial failure is a no-op
// on the rows that already landed.
//
// --- A script, not SQL inside the migration ---
// The rule is `citiesOfStops`: TIME order not stored order, `location.city`
// only with no name/area fallback, duplicates collapsed to the first
// occurrence. Written a second time in SQL it could not share a line of code
// with the version every future save uses, and the two would be free to drift
// — which is precisely how a public profile's cities come to disagree with
// Discover's (M11b's own gate box). So the backfill imports the one rule.
//
// Reading the stored `stops` jsonb here does not contradict ADR-029's "a saved
// day is never queried into": that describes the steady state, and this reads
// each row exactly once, ever. `cities` exists so the steady state never has
// to.
//
// --- Why the deep import ---
// `import { citiesOfStops } from "@tc/domain"` does not work from a plain Node
// script: the package's entry point re-exports extensionless relative paths
// ("./trip/state"), which Node's ESM resolver will not resolve even with type
// stripping. Importing the one module by path is what makes the rule shareable
// at all, and it is the same move `db-reset.mjs` makes for `schema.ts`.

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { pathToFileURL } from "node:url";
import { citiesOfStops } from "../../../packages/domain/src/trip/cities.ts";
import { savedDays } from "../src/server/db/schema.ts";

/**
 * @param {ReturnType<typeof drizzle>} db
 * @returns {Promise<{ scanned: number; updated: number; unreadable: string[] }>}
 */
export async function backfillSavedDayCities(db) {
  const rows = await db.select().from(savedDays);
  /** @type {string[]} */
  const unreadable = [];
  let updated = 0;

  for (const row of rows) {
    // Reported, never guessed at. Writing `[]` for a row whose stops are not
    // an array would be indistinguishable from a day that genuinely visits
    // nowhere — the same reason `fromRow` drops such a row instead of
    // substituting an empty stop list (KI-71).
    if (!Array.isArray(row.stops)) {
      unreadable.push(row.id);
      continue;
    }
    const cities = citiesOfStops(row.stops);
    const current = row.cities ?? [];
    if (cities.length === current.length && cities.every((city, i) => city === current[i])) continue;
    await db.update(savedDays).set({ cities }).where(eq(savedDays.id, row.id));
    updated += 1;
  }

  return { scanned: rows.length, updated, unreadable };
}

// Only when run as a script. The export above is what the integration suite
// drives, so the backfill is covered by a test rather than by having been run
// once on one laptop.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required (local: postgres://postgres:postgres@localhost:5433/travel)");
    process.exit(1);
  }
  const pool = new pg.Pool({ connectionString: url });
  const result = await backfillSavedDayCities(drizzle(pool));
  await pool.end();

  const current = result.scanned - result.updated - result.unreadable.length;
  console.log(
    `saved_days.cities: scanned ${result.scanned}, updated ${result.updated}, already current ${current}`,
  );
  if (result.unreadable.length > 0) {
    console.error(`${result.unreadable.length} row(s) left alone — their stops are not an array:`);
    for (const id of result.unreadable) console.error(`  ${id}`);
    process.exit(1);
  }
}
