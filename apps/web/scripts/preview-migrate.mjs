// The preview build's migrate step (`lib/vercel-build-steps.mjs`), in place of
// `pnpm drizzle-kit migrate`. It runs the same migrator — drizzle-orm's, which
// `drizzle-kit migrate` calls — against the same `drizzle` folder, and adds two
// things KI-2026-10-17-c needed:
//
// 1. **The real error.** `drizzle-kit migrate` draws a spinner over the failure,
//    so a preview build that failed to migrate logged a bare exit 1 and no
//    Postgres message. Reproduced 2026-10-28 on a scratch database: the log
//    ended `[⣷] applying migrations...` and nothing else. Here the failure is
//    caught and printed with its Postgres code and detail.
// 2. **A named refusal for a renumbered migration.** Every preview shares one
//    Neon branch. When a part's migration is applied by its preview and then
//    regenerated under a newer number, drizzle runs the same SQL again and every
//    preview build fails. Before migrating, this compares the applied rows with
//    the journal and refuses with the recovery steps when that is about to
//    happen. The comparison is `diagnoseAppliedMigrations`, tested in
//    `vercel-build-migrate.test.ts`.
//
// Preview only: `vercel-build-steps.mjs` decides whether this runs at all, and
// production is still migrated by dispatching `migrate-production.yml`.
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import {
  describeMigrateError,
  diagnoseAppliedMigrations,
  orphansHint,
  renumberedMessage,
} from "./lib/preview-migrate.mjs";

const migrationsFolder = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "drizzle");

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("[preview-migrate] DATABASE_URL is not set.");
  process.exit(1);
}

// drizzle's own reader, so each hash is exactly the one the migrator writes.
const { entries: journal } = JSON.parse(readFileSync(path.join(migrationsFolder, "meta", "_journal.json"), "utf8"));
const files = readMigrationFiles({ migrationsFolder });
const entries = journal.map((entry, index) => ({ tag: entry.tag, when: entry.when, hash: files[index].hash }));

const client = new pg.Client({ connectionString: url });
let code = 0;
let diagnosis = { orphans: [] };
try {
  await client.connect();
  const exists = await client.query(`select to_regclass('drizzle.__drizzle_migrations') as t`);
  const rows = exists.rows[0]?.t
    ? (await client.query(`select id, hash, created_at from drizzle.__drizzle_migrations`)).rows
    : [];
  diagnosis = diagnoseAppliedMigrations(entries, rows);
  if (diagnosis.renumbered.length > 0) {
    console.error(renumberedMessage(diagnosis.renumbered));
    code = 1;
  } else {
    console.log(`[preview-migrate] ${diagnosis.toApply.length} migration(s) to apply.`);
    await migrate(drizzle(client), { migrationsFolder });
    console.log("[preview-migrate] migrations applied.");
  }
} catch (error) {
  console.error(describeMigrateError(error));
  const hint = orphansHint(diagnosis.orphans);
  if (hint) console.error(hint);
  code = 1;
}
await client.end().catch(() => {});
process.exitCode = code;
