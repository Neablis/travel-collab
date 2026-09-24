// Fails when the Next build in `.next/` would report to Sentry.
//
// **No automated test talks to a real third party** (Mitchell, 2026-09-24), and
// the e2e lane serves a real build with `next start`. `NEXT_PUBLIC_*` values
// are inlined into the bundles at BUILD time, so the served app's Sentry DSN is
// whatever the build saw, and `sentry.shared.ts` falls back to the production
// DSN when the variable is unset. The e2e build sets it to `""` (`ci.yml`'s
// build step and `test:e2e:ci-like`); this is the check that it stayed that
// way. Without it, dropping the variable from either place would pass every
// test while each e2e page load reported to production Sentry. The page-level
// `offHostRequests()` assertion cannot catch that reliably: the SDK batches for
// seconds, and most specs never ask.
//
// **The DSN is read from `sentry.shared.ts`, not written here twice.** A
// project rename changes the literal there, and a copy here would go on
// passing against a DSN nobody uses any more.
//
// Usage (from apps/web, after `pnpm build`):
//   node scripts/check-build-has-no-sentry-dsn.mjs [buildDir]    # default .next
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const buildDir = path.resolve(appDir, process.argv[2] ?? ".next");

const shared = readFileSync(path.join(appDir, "sentry.shared.ts"), "utf8");
const literal = shared.match(/"(https:\/\/[0-9a-f]+@[^"/]+\.sentry\.io\/\d+)"/)?.[1];
if (!literal) {
  console.error(
    "check-build-has-no-sentry-dsn: could not find the DSN literal in sentry.shared.ts. " +
      "If its shape changed, update the pattern here rather than deleting the check.",
  );
  process.exit(2);
}
const dsn = new URL(literal);
// Either half gives the DSN away: the public key is what authenticates an
// envelope, and the host is where it goes. A bundle could split or re-encode
// the URL, but it has no reason to split these two.
const needles = [dsn.username, dsn.host];

/** Every emitted JavaScript file under `dir`. Source maps are skipped: they
 * quote the source, fallback literal included, and are never executed. */
function* scripts(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "cache") continue;
      yield* scripts(full);
    } else if (/\.(c|m)?js$/.test(entry.name)) {
      yield full;
    }
  }
}

if (!existsSync(path.join(buildDir, "static"))) {
  console.error(`check-build-has-no-sentry-dsn: no build at ${buildDir} (expected ${buildDir}/static). Run \`pnpm build\` first.`);
  process.exit(2);
}

// The client chunks are what a browser runs; the server bundles are what
// `next start` runs, and its Node transport would post from there.
const roots = ["static", "server"].map((name) => path.join(buildDir, name)).filter((dir) => existsSync(dir));
let scanned = 0;
const offenders = [];
for (const root of roots) {
  for (const file of scripts(root)) {
    scanned += 1;
    const text = readFileSync(file, "utf8");
    const found = needles.filter((needle) => text.includes(needle));
    if (found.length > 0) offenders.push(`${path.relative(appDir, file)} (${found.join(", ")})`);
  }
}

if (scanned === 0) {
  console.error(`check-build-has-no-sentry-dsn: ${buildDir} holds no JavaScript to check.`);
  process.exit(2);
}

if (offenders.length > 0) {
  console.error(
    `check-build-has-no-sentry-dsn: ${offenders.length} built file(s) carry the Sentry DSN from sentry.shared.ts, ` +
      `so the app this build serves would report to Sentry:\n` +
      offenders.map((line) => `  ${line}`).join("\n") +
      `\nBuild with NEXT_PUBLIC_SENTRY_DSN='' (the empty string, not unset) for any build a test serves.`,
  );
  process.exit(1);
}

console.log(`check-build-has-no-sentry-dsn: OK, no Sentry DSN in ${scanned} built file(s) under ${path.relative(appDir, buildDir)}.`);
