// Originally temporary scaffolding (M2 Task 0c, M1 retro follow-up); the
// "real seed/fixture story" it was waiting on is db-seed.ts, and `pnpm
// db:reseed` chains this + that for a one-command wipe-and-refill.
// Truncates every table the application declares, on whatever DATABASE_URL
// points at.
//
// The list is DERIVED from the Drizzle schema, not written down here (KI-68).
// It used to be `const TABLES = ["events", "trip_details", "trip_summaries"]`,
// written when the schema had four tables; by the time it was noticed the
// schema declared ten, so seven were never cleared and a "clean" database
// still held memberships, invites, shares, saved days and rate-limit counters
// pointing at trips that no longer existed. `rate_limit_counters` was the
// sharpest: a reset that leaves it behind leaves a developer throttled with no
// visible cause. A hardcoded array cannot track a schema — it had already
// fallen behind twice — so the fix is the shape, not five more literals. A new
// pgTable in schema.ts is covered here the day it lands, with no edit.
// Deliberately requires an explicit DATABASE_URL (no config default): pointing
// a destructive tool somewhere should never happen implicitly. `--env-file-
// if-exists=.env.local` (package.json) fills it in from the local dev file
// when present, same as db-seed.ts and the drizzle-kit scripts — it does
// NOT override an already-exported DATABASE_URL (Node's own precedence),
// so `DATABASE_URL=<preview-url> pnpm --filter web db:reset` still targets
// the value you gave it, not whatever .env.local happens to have.
import { createInterface } from "node:readline/promises";
import { is } from "drizzle-orm";
import { PgTable, getTableConfig } from "drizzle-orm/pg-core";
import pg from "pg";
import * as schema from "../src/server/db/schema.ts";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required (local: postgres://postgres:postgres@localhost:5433/travel)");
  process.exit(1);
}
const host = new URL(url).hostname;

// Every exported pgTable, by its real SQL name. `is(v, PgTable)` is Drizzle's
// own brand check, so non-table exports (relations, enums, types) are ignored
// rather than needing a naming convention. Drizzle's migrations bookkeeping
// lives in a separate `drizzle` schema and is not exported here, so it cannot
// be caught by this — a reset must never delete the migration history.
const TABLES = Object.values(schema)
  .filter((value) => is(value, PgTable))
  .map((table) => getTableConfig(table).name)
  .sort();

if (TABLES.length === 0) {
  console.error("db-reset: derived zero tables from the schema — refusing to run.");
  process.exit(1);
}

if (!process.argv.includes("--yes")) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(
    `About to TRUNCATE ${TABLES.join(", ")} on ${host}.\nType the hostname to confirm: `,
  );
  rl.close();
  if (answer.trim() !== host) {
    console.error("aborted (hostname mismatch)");
    process.exit(1);
  }
}

const client = new pg.Client({ connectionString: url });
await client.connect();
// One statement naming every table, so there is no order to get wrong, plus
// CASCADE for any future foreign key. Identifiers are quoted because they come
// from the schema rather than from this file's own literals.
const quoted = TABLES.map((t) => `"${t}"`).join(", ");
await client.query(`TRUNCATE ${quoted} RESTART IDENTITY CASCADE`);
await client.end();
console.log(`reset ${TABLES.length} tables on ${host}: ${TABLES.join(", ")}`);
