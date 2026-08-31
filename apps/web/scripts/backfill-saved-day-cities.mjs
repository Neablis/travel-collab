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
// The city rule comes from `src/server/savedDayCities.ts`, not from
// `packages/domain` directly. AGENTS.md's architecture map makes `src/server`
// the ONLY code that may import the domain, and `scripts/**` sits outside the
// CI-enforced lint wall (`eslint.config.mjs` scopes it to `src/**`) — so a
// direct import here passes lint and still breaks the rule the wall holds.
// Flagged in review on PR #100.
//
// The path import (rather than `@/server/...` or `@tc/domain`) is what a plain
// Node script can actually resolve: Node's ESM resolver handles neither the
// alias nor the extensionless re-exports in the domain's entry point. Same
// move `db-reset.mjs` makes for `schema.ts`.

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { pathToFileURL } from "node:url";
import { savedDayCities } from "../src/server/savedDayCities.ts";
import { savedDays } from "../src/server/db/schema.ts";

/**
 * @param {ReturnType<typeof drizzle>} db
 * @returns {Promise<{ scanned: number; updated: number; unreadable: string[]; refused: string[] }>}
 */
export async function backfillSavedDayCities(db) {
  const rows = await db.select().from(savedDays);
  /** @type {string[]} */
  const unreadable = [];
  /** @type {string[]} */
  const refused = [];
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
    const cities = savedDayCities(row.stops);
    const current = row.cities ?? [];
    if (cities.length === current.length && cities.every((city, i) => city === current[i])) continue;

    // `Array.isArray` above admits an array of malformed stops — `[{}]` passes
    // it, while `SavedStop.array().safeParse` (what `fromRow` uses on this same
    // column) would reject it. The script cannot run that parse: plain Node
    // resolves neither `@tc/contracts` nor its source by path, because the
    // package's internal re-exports are extensionless. Measured, not assumed —
    // both fail with ERR_MODULE_NOT_FOUND.
    //
    // So bound the harm instead of pretending to validate. A malformed stop
    // derives no city, and this backfill exists to FILL an empty `cities`, never
    // to clear a populated one: every row it targets was written before 0012 and
    // carries the column default. An empty derivation over a non-empty stored
    // value is therefore always wrong, whatever made the stops unreadable.
    // Reported for a person to look at, on the same terms as a non-array.
    //
    // Raised by review on pull request 100.
    if (cities.length === 0 && current.length > 0) {
      refused.push(row.id);
      continue;
    }

    await db.update(savedDays).set({ cities }).where(eq(savedDays.id, row.id));
    updated += 1;
  }

  return { scanned: rows.length, updated, unreadable, refused };
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

  const current = result.scanned - result.updated - result.unreadable.length - result.refused.length;
  console.log(
    `saved_days.cities: scanned ${result.scanned}, updated ${result.updated}, already current ${current}`,
  );
  if (result.unreadable.length > 0) {
    console.error(`${result.unreadable.length} row(s) left alone — their stops are not an array:`);
    for (const id of result.unreadable) console.error(`  ${id}`);
  }
  if (result.refused.length > 0) {
    console.error(
      `${result.refused.length} row(s) left alone — their stops yield no city but the row already has some:`,
    );
    for (const id of result.refused) console.error(`  ${id}`);
  }
  if (result.unreadable.length > 0 || result.refused.length > 0) process.exit(1);
}
