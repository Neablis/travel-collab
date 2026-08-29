// Decides whether the integration lane can run, for `pnpm test:int:if-db`.
//
// This exists because the guard it replaces was `pg_isready`, which ships with
// the Postgres *client* tools and need not be installed at all. Where Postgres
// runs in Docker and no client is on the host, the binary is absent, the
// shell's "command not found" went to /dev/null, and its non-zero exit was
// indistinguishable from "no database" — so `pnpm check` printed a SKIPPED
// banner and still exited 0 while the database was up and 242 integration
// tests were passing. See KI-76.
//
// So: probe the way the app does. Connect with the `pg` client the app already
// depends on, against the same DATABASE_URL the integration tests resolve, and
// say which of the three possible answers it is.
//
// Exit codes are the interface — package.json's `test:int:if-db` branches on
// them, so do not renumber them casually:
//
//   0  the database answered  -> run the integration tests
//   1  no database reachable  -> skip, and let `pnpm check` still pass
//   2  the probe itself could not run (no DATABASE_URL, no pg client, an
//      unparseable URL) -> fail loudly. This is the case the old guard could
//      not express, and the whole reason for this file: "I could not tell"
//      must never be reported as "there is no database".
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CONNECT_TIMEOUT_MS = 5000;

// A refused TCP connect arrives as an AggregateError whose own `message` is the
// empty string — Node tries every address the host resolves to (happy eyeballs)
// and nests one error per attempt. Reporting `err.message` alone printed a
// blank reason, which is the same "cannot tell you why" failure this file
// exists to end, so unwrap the nested causes.
function describe(err) {
  if (!(err instanceof Error)) return String(err);
  const nested = err instanceof AggregateError ? err.errors : [];
  const parts = nested.length
    ? [...new Set(nested.map((e) => (e instanceof Error ? e.message : String(e))))]
    : [err.message];
  const text = parts.filter(Boolean).join("; ");
  return text || err.code || err.constructor.name;
}

// Resolve DATABASE_URL exactly the way vitest.config.ts does, or the probe
// would be answering a question the tests never asked: load apps/web/.env.local
// when it exists, and let an already-exported DATABASE_URL win (that is Node's
// own --env-file precedence, which process.loadEnvFile shares — verified, not
// assumed). CI sets the variable directly and ships no .env.local.
const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envLocalPath = path.join(webDir, ".env.local");
if (existsSync(envLocalPath)) {
  process.loadEnvFile(envLocalPath);
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error(
    "db-probe: DATABASE_URL is not set, so whether a database exists is unknowable.\n" +
      `           Looked for ${envLocalPath} (absent) and the environment.\n` +
      "           Run `pnpm setup` to create it, or export DATABASE_URL.",
  );
  process.exit(2);
}

// Parsed rather than assumed: the old guard hardcoded `localhost` and read
// POSTGRES_PORT, so it probed a host nobody had configured the moment
// DATABASE_URL pointed anywhere else. Reported without credentials — this
// string is printed on the skip path and lands in CI logs.
let target;
try {
  const parsed = new URL(url);
  target = `${parsed.hostname}:${parsed.port || "5432"}${parsed.pathname}`;
} catch {
  console.error(`db-probe: DATABASE_URL is not a parseable URL, so it cannot be probed.`);
  process.exit(2);
}

let pg;
try {
  pg = (await import("pg")).default;
} catch (err) {
  console.error(
    "db-probe: could not load the `pg` client, so the database could not be probed.\n" +
      "           This is a broken checkout, NOT an absent database — run `pnpm install`.\n" +
      `           ${describe(err)}`,
  );
  process.exit(2);
}

const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: CONNECT_TIMEOUT_MS });
let code;
try {
  await client.connect();
  await client.query("select 1");
  console.log(`db-probe: ${target} answered — running the integration tests.`);
  code = 0;
} catch (err) {
  // A genuine "nothing is listening" / "database does not exist" / "auth
  // refused". Skipping is the intended behavior here, so exit 1 and let the
  // caller print the banner and keep `pnpm check` green — but say what was
  // tried and what it said, because the old banner named a host it had not
  // actually probed.
  console.error(
    `db-probe: no database answered at ${target}.\n` +
      `           ${describe(err)}`,
  );
  code = 1;
}
// Close before exiting rather than in a `finally`: process.exit() is immediate
// and would skip the cleanup, leaving the socket to be reaped by the OS.
await client.end().catch(() => {});
process.exit(code);
