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

// "Nothing is listening" — the one failure the SKIPPED banner is for. These are
// transport-level: the socket never reached a Postgres that could answer. A
// PostgreSQL *server* error (`28P01` bad password, `3D000` no such database,
// `28000` no such role) arrives with a five-character SQLSTATE in `code`
// instead, and is deliberately NOT in this set — see the catch block below.
const UNREACHABLE = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ECONNRESET",
  "EAI_AGAIN",
  "EPIPE",
]);

function isUnreachable(err) {
  if (!(err instanceof Error)) return false;
  // pg's own connect-timeout rejection carries no code at all.
  if (/timeout expired/i.test(err.message)) return true;
  const codes = [err.code, ...(err instanceof AggregateError ? err.errors.map((e) => e?.code) : [])];
  return codes.some((c) => typeof c === "string" && UNREACHABLE.has(c));
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
  // Say which of the two it actually is: a missing file and a file that simply
  // does not define DATABASE_URL need different fixes, and claiming "absent"
  // for both sends you looking for the wrong one. (CodeRabbit, PR #86.)
  const envLocalStatus = existsSync(envLocalPath)
    ? `${envLocalPath} exists but defines no DATABASE_URL`
    : `${envLocalPath} does not exist`;
  console.error(
    "db-probe: DATABASE_URL is not set, so whether a database exists is unknowable.\n" +
      `           ${envLocalStatus}, and the environment does not set it either.\n` +
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
  // Only "nothing is listening" is a skip. The banner exists for one case —
  // a developer who has not started Postgres — and stretching it to cover
  // every connect failure would rebuild the bug this file was written to fix,
  // one layer up: a *misconfiguration* silently reported as "no database",
  // with `pnpm check` green. A server that answers and then rejects us (bad
  // password, missing database, no such role) is configuration to fix, not
  // absence to tolerate, so it exits 2 and fails loudly. (CodeRabbit, PR #86.)
  if (isUnreachable(err)) {
    console.error(
      `db-probe: no database answered at ${target}.\n` +
        `           ${describe(err)}`,
    );
    code = 1;
  } else {
    console.error(
      `db-probe: ${target} refused the connection — this is a CONFIGURATION problem, not an absent database.\n` +
        `           ${describe(err)}\n` +
        "           Fix DATABASE_URL (or the role/database it names) rather than skipping the tests.",
    );
    code = 2;
  }
}
// Close before exiting rather than in a `finally`: process.exit() is immediate
// and would skip the cleanup, leaving the socket to be reaped by the OS.
await client.end().catch(() => {});
process.exit(code);
