// Originally temporary scaffolding (M2 Task 0c, M1 retro follow-up); the
// "real seed/fixture story" it was waiting on is db-seed.ts, and `pnpm
// db:reseed` chains this + that for a one-command wipe-and-refill.
// Truncates the event log + projections on whatever DATABASE_URL points at.
// (Doesn't touch the `pages` table — Notebook content — a real gap if you
// need those cleared too; TRUNCATE it by hand until this script covers it.)
// Deliberately requires an explicit DATABASE_URL (no config default): pointing
// a destructive tool somewhere should never happen implicitly. `--env-file-
// if-exists=.env.local` (package.json) fills it in from the local dev file
// when present, same as db-seed.ts and the drizzle-kit scripts — it does
// NOT override an already-exported DATABASE_URL (Node's own precedence),
// so `DATABASE_URL=<preview-url> pnpm --filter web db:reset` still targets
// the value you gave it, not whatever .env.local happens to have.
import { createInterface } from "node:readline/promises";
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required (local: postgres://postgres:postgres@localhost:5433/travel)");
  process.exit(1);
}
const host = new URL(url).hostname;
const TABLES = ["events", "trip_details", "trip_summaries"];

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
await client.query(`TRUNCATE ${TABLES.join(", ")} RESTART IDENTITY`);
await client.end();
console.log(`reset ${TABLES.join(", ")} on ${host}`);
