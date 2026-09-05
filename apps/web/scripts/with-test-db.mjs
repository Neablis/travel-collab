// Runs a command against a private, throwaway Postgres database, so two
// worktrees can run the test lanes at the same time without corrupting each
// other's results.
//
// Usage (from apps/web):
//   node scripts/with-test-db.mjs <command> [args...]
//   node scripts/with-test-db.mjs --with-port <command> [args...]
//
// ## Why this exists, and why it is a wrapper rather than a code change
//
// KI-2026-08-30-e. `rebuildProjections()` does `readAll(tx)` over EVERY event
// row and re-projects the lot — deliberately, because invariant 2 says
// projections are disposable and rebuildable from the log, and that function
// is what proves it. Three integration suites call it, so any row another run
// left behind is inside their blast radius; KI-89 watched a malformed event
// from one suite fail two unrelated tests in another. The KI considered and
// REJECTED the obvious shortcut (a `tripIds` parameter used only by tests),
// because a scoped variant would make the golden test exercise something
// other than the real path. That rejection still stands. The fix is to give
// each run its own database, not to make the code smaller.
//
// It needs no application change at all: src/server/db/client.ts builds its
// pool from DATABASE_URL at import time, drizzle.config.ts reads the same
// value, and playwright.config.ts forwards it into webServer.env. So a parent
// process that rewrites DATABASE_URL isolates the whole lane — the code under
// test stays exactly the code that runs in production.
//
// ## Why a template database rather than a schema per run
//
// Measured on Postgres 16, 2026-09-04, on this repo's 16 migrations:
//   `drizzle-kit migrate` into an empty database   1578 ms
//   `CREATE DATABASE ... TEMPLATE <migrated db>`     81-93 ms   (7983 kB)
// A template is a file-level copy, so migrations are paid once per distinct
// migration set instead of once per run. Four concurrent clones of one
// template were verified to succeed.
//
// Two Postgres facts the flow is built around, both verified rather than
// assumed:
//   - Cloning a template that has a live connection fails with 55006
//     ("source database is being accessed by other users"). Nothing connects
//     to a finished template, but a concurrent run building one can, hence
//     the advisory lock and the retry.
//   - `DROP DATABASE` fails the same way while a connection is open; only
//     `DROP DATABASE ... WITH (FORCE)` (PG 13+) succeeds. Teardown runs after
//     the child exits, but a leaked pool would otherwise strand the database.
//
// ## Exit codes are the interface
//
//   <child's own code>  the command ran; its verdict is passed through
//   2                   the wrapper could not set up (no DATABASE_URL, a
//                       non-local host, an unreachable server, a migration
//                       that failed). Never reported as a test failure.
//
// Escape hatch: KEEP_TEST_DB=1 skips teardown and prints the URL, for when a
// run fails and you want to look at the rows it left.
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATIONS_DIR = path.join(WEB_DIR, "drizzle");

// How long an abandoned run database may sit before a later run sweeps it.
// Generous on purpose: the sweep must never reach a run that is merely slow.
// A full e2e suite is minutes, not hours, and the sweep additionally refuses
// anything with a live connection.
const STALE_MS = 2 * 60 * 60 * 1000;

// A clone can only collide with a template someone is still building, which
// is a sub-second window held under an advisory lock.
const CLONE_ATTEMPTS = 10;
const CLONE_RETRY_MS = 300;

/** Everything the migration state is made of: the SQL, and the journal that orders it. */
export function migrationsFingerprint(dir = MIGRATIONS_DIR) {
  const hash = createHash("sha256");
  const files = readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const name of files) {
    hash.update(name);
    hash.update(readFileSync(path.join(dir, name)));
  }
  // The journal is what drizzle-kit itself reads to decide what to apply, so
  // a change there is a change to the resulting schema even when no .sql file
  // moved. Absent in a checkout with no migrations at all, which is not this
  // repo but is cheap to tolerate.
  const journal = path.join(dir, "meta", "_journal.json");
  if (existsSync(journal)) hash.update(readFileSync(journal));
  return hash.digest("hex").slice(0, 12);
}

export const templateName = (fingerprint) => `tc_tmpl_${fingerprint}`;
// A half-migrated database must never be adopted as a template, so the
// migration runs into this name and is renamed on success. A leftover one is
// evidence of a crash, and is swept.
export const buildingName = (fingerprint) => `tc_tmpl_${fingerprint}_building`;

/** The fingerprint back out of a `_building` name, or null if it is not one. */
export function buildingFingerprint(name) {
  return /^tc_tmpl_([0-9a-f]+)_building$/.exec(name)?.[1] ?? null;
}

/**
 * The creation time is IN the name because Postgres does not record when a
 * database was created, and the sweep needs an age. `pg_database` has no
 * timestamp column and adding a marker table would put a stray table inside
 * every cloned database.
 */
export function runDbName(now = Date.now(), suffix = randomSuffix()) {
  return `tc_test_${now}_${suffix}`;
}

const randomSuffix = () => Math.random().toString(36).slice(2, 8).padEnd(6, "0");

/** Age of a run database from its name, or null if the name is not one of ours. */
export function runDbAgeMs(name, now = Date.now()) {
  const match = /^tc_test_(\d+)_[a-z0-9]+$/.exec(name);
  if (!match) return null;
  const created = Number(match[1]);
  if (!Number.isFinite(created)) return null;
  return now - created;
}

/** The same server, credentials and options, a different database name. */
export function withDatabase(url, dbName) {
  const parsed = new URL(url);
  parsed.pathname = `/${encodeURIComponent(dbName)}`;
  return parsed.toString();
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/**
 * The one safety rail that matters. This file issues CREATE DATABASE and DROP
 * DATABASE; pointed at the Neon preview or production branch it would be a
 * destructive tool aimed at real data. Preview and production are migrated by
 * automation against a URL nobody types (see
 * docs/guidelines/environments-and-deploys.md), so refusing every non-local
 * host costs nothing and removes the whole class of accident.
 */
export function assertLocalHost(url) {
  const { hostname } = new URL(url);
  if (!LOOPBACK.has(hostname)) {
    throw new Error(
      `with-test-db: refusing to provision databases on '${hostname}'.\n` +
        "           This creates and drops databases, so it runs against a local\n" +
        "           Postgres only — never a Neon preview or production branch.",
    );
  }
}

/**
 * A stable lock key for a fingerprint. Postgres advisory locks take a signed
 * 64-bit integer; 12 hex digits is 48 bits, which fits with room to spare and
 * needs no sign handling.
 */
export function advisoryKey(fingerprint) {
  return Number.parseInt(fingerprint.slice(0, 12), 16);
}

async function connect(pg, url) {
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 5000 });
  await client.connect();
  return client;
}

// Identifiers are interpolated, never parameterized — Postgres does not accept
// a bind parameter for a database name. Every name reaching this function is
// one this file generated from a hex fingerprint, a timestamp or a base-36
// suffix, and the sweep filters `pg_database` through the same regex, so no
// caller-supplied text ever gets here. Quoted anyway.
const quote = (name) => `"${name.replace(/"/g, '""')}"`;

async function databaseExists(admin, name) {
  const { rows } = await admin.query("select 1 from pg_database where datname = $1", [name]);
  return rows.length > 0;
}

/**
 * Build the template if this fingerprint has none yet, under an advisory lock
 * so that two worktrees starting together produce one template rather than a
 * race. The loser of the lock finds it already there and skips.
 */
async function ensureTemplate(pg, adminUrl, fingerprint) {
  const template = templateName(fingerprint);
  const admin = await connect(pg, adminUrl);
  try {
    if (await databaseExists(admin, template)) return template;

    await admin.query("select pg_advisory_lock($1)", [advisoryKey(fingerprint)]);
    try {
      if (await databaseExists(admin, template)) return template;

      const building = buildingName(fingerprint);
      await admin.query(`drop database if exists ${quote(building)} with (force)`);
      await admin.query(`create database ${quote(building)}`);
      process.stderr.write(`with-test-db: migrating a new template (${template})…\n`);
      await migrate(withDatabase(adminUrl, building));
      await admin.query(`alter database ${quote(building)} rename to ${quote(template)}`);
      return template;
    } finally {
      await admin.query("select pg_advisory_unlock($1)", [advisoryKey(fingerprint)]);
    }
  } finally {
    await admin.end().catch(() => {});
  }
}

function migrate(url) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["./node_modules/drizzle-kit/bin.cjs", "migrate"],
      { cwd: WEB_DIR, stdio: "inherit", env: { ...process.env, DATABASE_URL: url } },
    );
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`drizzle-kit migrate exited ${code}`)),
    );
  });
}

/**
 * Drop run databases old enough that no live run could own them. Covers the
 * one case teardown cannot: a run killed with SIGKILL, or a machine that went
 * to sleep mid-suite.
 *
 * Deliberately does NOT touch templates of other fingerprints. A second
 * worktree on another branch legitimately has a different migration set, and
 * dropping its template mid-run is precisely the cross-run interference this
 * whole file exists to end. They are ~8 MB each and bounded by the number of
 * distinct migration sets in play.
 */
async function sweepStale(admin, now = Date.now()) {
  const { rows } = await admin.query(
    "select d.datname, (select count(*) from pg_stat_activity a where a.datname = d.datname) as backends" +
      " from pg_database d where d.datname like 'tc\\_test\\_%' or d.datname like 'tc\\_tmpl\\_%\\_building'",
  );
  for (const { datname, backends } of rows) {
    if (Number(backends) > 0) continue;
    const age = runDbAgeMs(datname, now);

    // A `_building` database carries no timestamp, and "no connections" alone
    // does NOT mean abandoned: there is a window between `CREATE DATABASE` and
    // drizzle-kit's first connection where a live build looks exactly like a
    // corpse. Its builder holds the fingerprint's advisory lock for the whole
    // operation, so the lock — not the connection count — is what separates
    // the two. Taking it non-blocking means a sweeper never waits on a build
    // and never drops one out from under it.
    if (age === null) {
      const fingerprint = buildingFingerprint(datname);
      if (!fingerprint) continue;
      const key = advisoryKey(fingerprint);
      const { rows: locked } = await admin.query("select pg_try_advisory_lock($1) as got", [key]);
      if (!locked[0].got) continue;
      try {
        await admin.query(`drop database if exists ${quote(datname)} with (force)`);
        process.stderr.write(`with-test-db: swept abandoned ${datname}\n`);
      } finally {
        await admin.query("select pg_advisory_unlock($1)", [key]);
      }
      continue;
    }

    if (age <= STALE_MS) continue;
    await admin.query(`drop database if exists ${quote(datname)} with (force)`);
    process.stderr.write(`with-test-db: swept abandoned ${datname}\n`);
  }
}

async function createRunDatabase(pg, adminUrl, template) {
  const admin = await connect(pg, adminUrl);
  try {
    await sweepStale(admin);
    let lastError;
    for (let attempt = 0; attempt < CLONE_ATTEMPTS; attempt++) {
      const name = runDbName();
      try {
        await admin.query(`create database ${quote(name)} template ${quote(template)}`);
        return name;
      } catch (err) {
        // 55006 object_in_use: someone is attached to the template. The only
        // producer is a concurrent build of the same fingerprint, so waiting
        // is the whole fix.
        if (err?.code !== "55006") throw err;
        lastError = err;
        await new Promise((r) => setTimeout(r, CLONE_RETRY_MS));
      }
    }
    throw lastError;
  } finally {
    await admin.end().catch(() => {});
  }
}

async function dropRunDatabase(pg, adminUrl, name) {
  const admin = await connect(pg, adminUrl);
  try {
    await admin.query(`drop database if exists ${quote(name)} with (force)`);
  } finally {
    await admin.end().catch(() => {});
  }
}

/**
 * A free TCP port, for `--with-port`. The other half of running two worktrees
 * at once: the e2e lane starts a server, and ADAPTER.md's `dev-server`
 * exclusive resource exists because that server's port was fixed. WEB_PORT
 * already flows through src/config.ts's BASE_URL into both the dev command
 * and Playwright's baseURL, so choosing one here is all it takes.
 *
 * An explicit WEB_PORT always wins — someone who set it meant it.
 */
export function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function runChild(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: WEB_DIR, stdio: "inherit", env });
    child.on("error", reject);

    // Ctrl-C is the common way a suite ends, and it must still drop the
    // database. Node's default SIGINT action is to exit the process at once,
    // which would skip teardown and leave the run database for the sweep two
    // hours later. So: catch the signal, pass it on (the child already got it
    // from the terminal, but a `kill <wrapper pid>` reaches only us), and let
    // the child's own exit resume the normal path — including the `finally`
    // that drops the database.
    const forward = (signal) => () => child.kill(signal);
    const handlers = ["SIGINT", "SIGTERM", "SIGHUP"].map((signal) => [signal, forward(signal)]);
    for (const [signal, handler] of handlers) process.on(signal, handler);

    // A signal-killed child reports (null, "SIGINT"). Convert to the shell's
    // own 128+n convention rather than reporting success.
    child.on("exit", (code, signal) => {
      for (const [name, handler] of handlers) process.off(name, handler);
      resolve(signal ? 128 + (osSignalNumber(signal) ?? 0) : (code ?? 1));
    });
  });
}

const osSignalNumber = (signal) => ({ SIGINT: 2, SIGTERM: 15, SIGHUP: 1, SIGKILL: 9 })[signal];

async function main() {
  const argv = process.argv.slice(2);
  const withPort = argv[0] === "--with-port";
  const [command, ...args] = withPort ? argv.slice(1) : argv;
  if (!command) {
    process.stderr.write("usage: with-test-db.mjs [--with-port] <command> [args...]\n");
    return 2;
  }

  // Resolved exactly the way vitest.config.ts and preload-dotenv.mjs do:
  // .env.local when it exists, and an already-exported DATABASE_URL wins
  // (Node's own precedence, which process.loadEnvFile shares). That
  // precedence is load-bearing in the other direction too — it is why the
  // URL this wrapper exports survives the child's own .env.local load
  // instead of being overwritten back to the shared `travel` database.
  const envLocal = path.join(WEB_DIR, ".env.local");
  if (existsSync(envLocal)) process.loadEnvFile(envLocal);

  const baseUrl = process.env.DATABASE_URL;
  if (!baseUrl) {
    process.stderr.write(
      "with-test-db: DATABASE_URL is not set, so there is no server to create a test database on.\n" +
        "           Run `pnpm setup`, or export DATABASE_URL.\n",
    );
    return 2;
  }

  try {
    assertLocalHost(baseUrl);
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    return 2;
  }

  // `postgres` is the maintenance database every server has; CREATE DATABASE
  // cannot be issued from inside the database being created, and connecting
  // to the base URL's own database would make this wrapper depend on `travel`
  // existing, which under per-run databases it need not.
  const adminUrl = withDatabase(baseUrl, "postgres");
  const pg = (await import("pg")).default;

  let runDb;
  try {
    const fingerprint = migrationsFingerprint();
    const template = await ensureTemplate(pg, adminUrl, fingerprint);
    runDb = await createRunDatabase(pg, adminUrl, template);
  } catch (err) {
    process.stderr.write(
      `with-test-db: could not provision a test database.\n           ${err?.message ?? err}\n`,
    );
    if (runDb) await dropRunDatabase(pg, adminUrl, runDb).catch(() => {});
    return 2;
  }

  const env = { ...process.env, DATABASE_URL: withDatabase(baseUrl, runDb), TC_TEST_DB: runDb };
  if (withPort && !process.env.WEB_PORT) env.WEB_PORT = String(await freePort());

  try {
    return await runChild(command, args, env);
  } finally {
    if (process.env.KEEP_TEST_DB === "1") {
      process.stderr.write(
        `with-test-db: KEEP_TEST_DB=1, so ${runDb} was left behind.\n` +
          `           DATABASE_URL=${withDatabase(baseUrl, runDb)}\n`,
      );
    } else {
      await dropRunDatabase(pg, adminUrl, runDb).catch((err) => {
        process.stderr.write(`with-test-db: could not drop ${runDb}: ${err?.message ?? err}\n`);
      });
    }
  }
}

// Run only when this file IS the command, so with-test-db.test.ts can import
// the helpers without provisioning anything. Same idiom and same reasoning as
// geocode-japan-seed.mts — `import.meta.main` is newer than this repo's Node
// floor and is not defined under Vitest.
const invokedDirectly =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) process.exit(await main());
