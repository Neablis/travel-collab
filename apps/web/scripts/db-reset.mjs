// TEMPORARY SCAFFOLDING (M2 Task 0c, M1 retro follow-up) — remove or fold into
// a real seed/fixture story before release (ADR-004: "DB resets are cheap").
// Truncates the event log + projections on whatever DATABASE_URL points at.
// Deliberately requires an explicit DATABASE_URL (no config default): pointing
// a destructive tool somewhere should never happen implicitly.
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
