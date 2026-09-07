// Says whether the database at DATABASE_URL has actually had this tree's
// migrations applied — the detector KI-2026-09-05-k was filed for.
//
// WHY THIS EXISTS. Production deploys on merge; production migrations are
// applied only when someone dispatches `.github/workflows/migrate-production.yml`
// (ADR-004, decided 2026-08-27 for CI cost — deliberate, and not the problem).
// The problem was that between those two moments NOTHING said so. Code reading
// a column the migration adds 500s, and users find out first. This script is
// what `.github/workflows/migration-pending.yml` runs on every push to `main`
// that touches `apps/web/drizzle/**`, and it is what a human runs (via the same
// workflow's `workflow_dispatch`) to answer "is production actually at 0018?".
//
// It is read-only. It issues one SELECT and applies nothing, so it is safe to
// point at production and safe to run while a migration is in flight.
//
// THE SECOND THING IT REPORTS, and the reason "pending" is not the whole story:
// drizzle's migrator applies an entry only when it is newer than the newest row
// already applied (drizzle-orm/pg-core/dialect.cjs) — not the set difference. A
// pending migration whose `when` is OLDER than something already applied can
// therefore never be applied by `drizzle-kit migrate` at all; it needs a human
// with SQL. `scripts/check-migration-journal.mjs` is the wall that stops that
// state being created; this is what notices it if one ever exists.
//
// Exit codes are the interface — the workflow branches on them:
//
//   0  every migration in the journal is applied
//   1  at least one is pending (or unreachable) -> dispatch migrate-production
//   2  the check itself could not run (no DATABASE_URL, no pg client, no
//      connection). "I could not tell" must never be reported as "up to date",
//      which is the same rule db-probe.mjs is built around.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CONNECT_TIMEOUT_MS = 15_000;

const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const journalPath = path.join(webDir, "drizzle", "meta", "_journal.json");

/**
 * Splits the journal against the `created_at` values a database has recorded.
 * `applied` holds them as strings because `created_at` is a bigint and
 * node-postgres hands those back as strings.
 */
export function classify(entries, applied) {
  const newestApplied = [...applied].reduce((a, b) => (Number(b) > Number(a ?? -1) ? b : a), null);
  const pending = entries.filter((e) => !applied.has(String(e.when)));
  return {
    applied: entries.filter((e) => applied.has(String(e.when))),
    pending,
    // Not merely late: past the point drizzle's migrator will ever look again.
    unreachable: newestApplied === null ? [] : pending.filter((e) => e.when < Number(newestApplied)),
  };
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error(
    "check-migration-state: DATABASE_URL is not set, so whether the schema is current is unknowable.\n" +
      "           In the migration-pending workflow this means the PRODUCTION_DATABASE_URL secret is missing.",
  );
  process.exit(2);
}

let target;
try {
  const parsed = new URL(url);
  target = `${parsed.hostname}:${parsed.port || "5432"}${parsed.pathname}`;
} catch {
  console.error("check-migration-state: DATABASE_URL is not a parseable URL.");
  process.exit(2);
}

const entries = JSON.parse(readFileSync(journalPath, "utf8")).entries;

let pg;
try {
  pg = (await import("pg")).default;
} catch (err) {
  console.error(
    "check-migration-state: could not load the `pg` client — a broken checkout, NOT an up-to-date database.\n" +
      `           ${err instanceof Error ? err.message : String(err)}`,
  );
  process.exit(2);
}

const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: CONNECT_TIMEOUT_MS });
let code;
try {
  await client.connect();
  // A database that has never been migrated has no `drizzle` schema at all, so
  // ask for the rows in a way that survives its absence: to_regclass returns
  // NULL rather than raising, and every migration is then pending.
  const exists = await client.query(`select to_regclass('drizzle.__drizzle_migrations') as t`);
  const rows = exists.rows[0]?.t
    ? (await client.query(`select created_at from drizzle.__drizzle_migrations`)).rows
    : [];
  const applied = new Set(rows.map((r) => String(r.created_at)));
  const state = classify(entries, applied);

  console.log(`check-migration-state: ${target} — ${state.applied.length}/${entries.length} migrations applied.`);
  if (state.pending.length === 0) {
    console.log("Every migration in this tree is applied. Nothing to dispatch.");
    code = 0;
  } else {
    console.error(
      `\nPENDING (${state.pending.length}): merged into this tree, absent from the database.\n` +
        state.pending.map((e) => `  ${e.tag} (when=${e.when})`).join("\n") +
        "\n\nApply them by dispatching the migrate-production workflow from main:\n" +
        "  gh workflow run migrate-production.yml -f confirm=migrate\n" +
        "Until then, any code reading a column these add returns a 500.",
    );
    if (state.unreachable.length > 0) {
      console.error(
        `\nUNREACHABLE (${state.unreachable.length}): older than a migration already applied, so\n` +
          "`drizzle-kit migrate` will SKIP these and still report success —\n" +
          "dispatching the workflow will NOT fix them (drizzle-orm/pg-core/dialect.cjs):\n" +
          state.unreachable.map((e) => `  ${e.tag} (when=${e.when})`).join("\n") +
          "\nThese need their SQL applied by hand, and a row inserted into drizzle.__drizzle_migrations.",
      );
    }
    code = 1;
  }
} catch (err) {
  console.error(
    `check-migration-state: could not read the migration state of ${target}.\n` +
      `           ${err instanceof Error ? err.message : String(err)}\n` +
      "           This is 'could not tell', not 'up to date'.",
  );
  code = 2;
}
await client.end().catch(() => {});
process.exit(code);
