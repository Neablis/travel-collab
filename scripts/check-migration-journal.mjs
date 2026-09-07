import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

// THE MIGRATION JOURNAL WALL: a migration this branch adds must sort AFTER
// every migration already on `main`.
//
// WHY THIS IS THE CHECK, and not internal monotonicity. Drizzle's migrator
// applies an entry only when it is newer than the newest row already in
// `drizzle.__drizzle_migrations` — one comparison, no set difference
// (drizzle-orm/pg-core/dialect.cjs):
//
//     const lastDbMigration = dbMigrations[0];   // order by created_at desc limit 1
//     for await (const migration of migrations) {
//       if (!lastDbMigration || Number(lastDbMigration.created_at) < migration.folderMillis) {
//
// So a migration whose `when` is OLDER than one already applied is not
// "applied later" — it is skipped, forever, and `drizzle-kit migrate` prints
// success over the top of it. Two branches make that happen without anybody
// doing anything strange:
//
//   * Preview. PR A's Vercel build migrates the one shared Neon `preview`
//     branch. PR B was generated before A and does not contain it; B's build
//     runs next, B's migration is skipped, and B's preview 500s on exactly the
//     feature under review — reading as a code bug (KI-2026-09-05-k, F-D03).
//   * Production. B merges and is dispatched (ADR-004: production migrations
//     are dispatched by hand, so merge order and apply order are independent),
//     then A merges. A's migration can never be applied by the migrator again.
//
// The fix, for either, is to regenerate: rebase onto `main` and re-run
// `pnpm --filter web db:generate` so the new migration gets a fresh `when`.
// Renumbering by hand is not enough — `when` is what the migrator compares,
// and the `0016_`/`0017_` prefix is not.
//
// WHAT THIS WALL IS NOT. It does not talk to a database, so it cannot tell you
// whether production is behind the journal; that is what the
// `migration-pending` workflow and `apps/web/scripts/check-migration-state.mjs`
// are for. And it is not `drizzle-kit check`, which reads the SNAPSHOTS and
// ignores `_journal.json` entirely — measured 2026-09-07: an entry duplicated
// into the journal with a colliding `idx` still printed "Everything's fine".
// The two checks overlap nowhere, which is why CI runs both.
//
// BASELINE AVAILABILITY. The comparison needs `main`'s journal, which means a
// git ref, and `actions/checkout` fetches only the ref under test — so
// `origin/main` does NOT exist on a runner by default. This file used to say
// that was fine because "locally is the moment this catches things". It is
// not fine, and Copilot's review of PR #155 said so: the wall printed
// `shape only — baseline NOT compared` in CI and exited 0, which makes the
// headline rule advice rather than a gate. Reproduced on a CI-like shallow
// clone 2026-09-07, then fixed at the other end: `.github/workflows/ci.yml`
// fetches `main` (depth 1, ~1s) before `pnpm lint`.
//
// The degraded path still exists and still must not break a build — a fork PR,
// a first push, or a checkout with no reachable `main` all land here. But it is
// now the exception it was always described as, rather than what CI did every
// single run. If you see `baseline NOT compared` in a CI log, that fetch step
// is missing or failed; do not read it as normal.

const JOURNAL_IN_DRIZZLE_DIR = join("meta", "_journal.json");

/** `git ...` from `cwd`, or null if git could not answer (no repo, no ref). */
function git(args, cwd) {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
}

/**
 * The journal as `ref` has it, or a reason it could not be read. Never throws:
 * an unavailable baseline downgrades the wall, it does not break the build.
 */
export function baselineFromGit(drizzleDir, ref) {
  const top = git(["rev-parse", "--show-toplevel"], drizzleDir)?.trim();
  if (!top) return { skipped: `not a git checkout (${drizzleDir})` };
  const relPath = relative(top, resolve(drizzleDir, JOURNAL_IN_DRIZZLE_DIR)).split("\\").join("/");
  const raw = git(["show", `${ref}:${relPath}`], top);
  if (raw === null) return { skipped: `\`git show ${ref}:${relPath}\` failed — no such ref or path` };
  try {
    return { entries: parseJournal(raw).entries };
  } catch (err) {
    return { skipped: `${ref}'s journal did not parse: ${err.message}` };
  }
}

/** Parses a journal, rejecting the shapes the rest of this file assumes away. */
export function parseJournal(raw) {
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed?.entries)) throw new Error("no `entries` array");
  for (const entry of parsed.entries) {
    if (typeof entry?.tag !== "string" || !Number.isFinite(entry?.when) || !Number.isInteger(entry?.idx)) {
      throw new Error(`entry is missing idx/tag/when: ${JSON.stringify(entry)}`);
    }
  }
  return parsed;
}

/**
 * Shape problems inside one journal, and between the journal and the .sql
 * files beside it. These are the parallel-generation cases: two agents each
 * run `db:generate`, both get `0016`, and a merge that keeps both halves
 * produces a journal git never conflicted on.
 */
export function shapeViolations(entries, sqlTags) {
  const problems = [];
  const seenTag = new Set();
  entries.forEach((entry, position) => {
    const { idx, tag, when } = entry;
    if (idx !== position) problems.push(`${tag}: idx is ${idx} but it sits at position ${position} — two entries share a number, or one is missing`);
    if (!tag.startsWith(String(position).padStart(4, "0"))) {
      problems.push(`${tag}: tag does not start with ${String(position).padStart(4, "0")}, the position it occupies`);
    }
    if (seenTag.has(tag)) problems.push(`${tag}: appears in the journal twice`);
    seenTag.add(tag);
    const previous = entries[position - 1];
    if (previous && when <= previous.when) {
      problems.push(`${tag}: when=${when} is not after ${previous.tag}'s ${previous.when} — the migrator applies in \`when\` order, so this entry is unreachable`);
    }
    if (sqlTags && !sqlTags.has(tag)) problems.push(`${tag}: journal entry has no ${tag}.sql beside it`);
  });
  if (sqlTags) {
    for (const tag of [...sqlTags].sort()) {
      if (!seenTag.has(tag)) problems.push(`${tag}.sql: is not in the journal, so nothing will ever apply it`);
    }
  }
  return problems;
}

/**
 * Every migration that CHANGES SCHEMA must have left a snapshot behind.
 *
 * `drizzle-kit generate` diffs `schema.ts` against the NEWEST snapshot it can
 * find. A schema migration whose snapshot was never committed is therefore
 * invisible to it, and the next `generate` re-emits that migration's own
 * change as a new one — which then fails on apply with "column already exists"
 * against every database that is current. The next person to write a migration
 * inherits a broken artefact before they have written a line of it.
 *
 * Not hypothetical: `0018_saved_day_source_bundle`'s snapshot was missing and
 * `generate` on an untouched tree emitted a duplicate `ALTER TABLE
 * "saved_days" ADD COLUMN "source_bundle" text` (KI-2026-09-07-a, fixed
 * 2026-09-07). `drizzle-kit check` does not catch it — it reads the snapshots
 * it HAS and never reads `_journal.json`.
 *
 * DATA-ONLY MIGRATIONS ARE EXEMPT, and that exemption is why this rule reads
 * the SQL rather than counting files. `0016_demo_visitor_orphans` is a
 * hand-written `DELETE FROM`; it changes no schema, drizzle-kit never made a
 * snapshot for it, and it needs none — the previous snapshot still describes
 * the schema correctly. A blanket "one snapshot per journal entry" rule would
 * fail on it and be deleted within the week for crying wolf.
 */
export function snapshotViolations(entries, sqlFor, hasSnapshot) {
  const problems = [];
  for (const { idx, tag } of entries) {
    const sql = sqlFor(tag);
    if (sql === null) continue; // already reported by shapeViolations
    if (!DDL.test(sql)) continue; // data-only: no snapshot is correct
    if (hasSnapshot(idx)) continue;
    problems.push(
      `${tag}: changes schema but has no meta/${String(idx).padStart(4, "0")}_snapshot.json — ` +
        `\`drizzle-kit generate\` will diff against an older snapshot and re-emit this migration's own change`,
    );
  }
  return problems;
}

/** Statements that move the schema, and so must be reflected in a snapshot. */
const DDL =
  /\b(?:CREATE|ALTER|DROP)\s+(?:TABLE|TYPE|SCHEMA|SEQUENCE|MATERIALIZED\s+VIEW|VIEW)\b/i;

/**
 * The production check. Every migration this branch ADDS must be newer than
 * every migration already on the baseline ref, or the migrator will skip it on
 * any database that is already at the baseline.
 */
export function baselineViolations(entries, baselineEntries) {
  const problems = [];
  const baselineByTag = new Map(baselineEntries.map((e) => [e.tag, e]));
  const newestBaseline = baselineEntries.reduce((a, b) => (b.when > (a?.when ?? -1) ? b : a), null);

  for (const entry of entries) {
    const existing = baselineByTag.get(entry.tag);
    if (!existing) {
      if (newestBaseline && entry.when <= newestBaseline.when) {
        problems.push(
          `${entry.tag} (when=${entry.when}) is NOT newer than the baseline's newest migration ` +
            `${newestBaseline.tag} (when=${newestBaseline.when}).\n` +
            `    Drizzle applies only entries newer than the last applied row, so on any database ` +
            `already at ${newestBaseline.tag} this one is skipped in silence and \`drizzle-kit migrate\` reports success.\n` +
            `    Fix: rebase onto the baseline and re-run \`pnpm --filter web db:generate\` so it gets a fresh \`when\`.`,
        );
      }
      continue;
    }
    if (existing.when !== entry.when) {
      problems.push(
        `${entry.tag}: when=${entry.when} here, ${existing.when} on the baseline. ` +
          `A migration's \`when\` is its identity in \`drizzle.__drizzle_migrations\` — rewriting it makes an applied migration look pending.`,
      );
    }
  }
  for (const entry of baselineEntries) {
    if (!entries.some((e) => e.tag === entry.tag)) {
      problems.push(`${entry.tag}: on the baseline and gone here. Migrations are forward-only; a database that applied it cannot un-apply it.`);
    }
  }
  return problems;
}

const args = process.argv.slice(2);
const flag = (name) => {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
};
const positional = args.filter((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));

const drizzleDir = resolve(positional[0] ?? "apps/web/drizzle");
const baselineRef = flag("--ref") ?? process.env.MIGRATION_JOURNAL_BASELINE_REF ?? "origin/main";
const baselineFile = flag("--baseline");
const journalPath = join(drizzleDir, JOURNAL_IN_DRIZZLE_DIR);

if (!existsSync(journalPath)) {
  console.error(`MIGRATION JOURNAL WALL: no journal at ${journalPath}.`);
  process.exit(1);
}

let entries;
try {
  entries = parseJournal(readFileSync(journalPath, "utf8")).entries;
} catch (err) {
  console.error(`MIGRATION JOURNAL WALL: ${journalPath} is unusable — ${err.message}`);
  process.exit(1);
}

const sqlTags = new Set(
  readdirSync(drizzleDir)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => f.slice(0, -4)),
);

const baseline = baselineFile
  ? { entries: parseJournal(readFileSync(baselineFile, "utf8")).entries }
  : baselineFromGit(drizzleDir, baselineRef);

const snapshotIdx = new Set(
  readdirSync(join(drizzleDir, "meta"))
    .map((f) => /^(\d+)_snapshot\.json$/.exec(f))
    .filter((m) => m !== null)
    .map((m) => Number(m[1])),
);
const sqlFor = (tag) => {
  const at = join(drizzleDir, `${tag}.sql`);
  return existsSync(at) ? readFileSync(at, "utf8") : null;
};

const violations = [
  ...shapeViolations(entries, sqlTags),
  ...snapshotViolations(entries, sqlFor, (idx) => snapshotIdx.has(idx)),
  ...(baseline.entries ? baselineViolations(entries, baseline.entries) : []),
];

if (violations.length > 0) {
  for (const line of violations) console.error(`  ${line}`);
  console.error(
    `\nMIGRATION JOURNAL WALL BREACHED: ${violations.length} problem(s) in ${relative(process.cwd(), journalPath) || journalPath}.\n` +
      "Drizzle applies a migration only if it is newer than the newest row already applied\n" +
      "(drizzle-orm/pg-core/dialect.cjs) — an out-of-order entry is skipped silently, on preview\n" +
      "and on production alike. See KI-2026-09-05-k and docs/guidelines/environments-and-deploys.md.",
  );
  process.exit(1);
}

const scope = baseline.entries
  ? `${entries.length} entries, newest-after-${baselineRef} enforced`
  : `${entries.length} entries, shape only — baseline NOT compared: ${baseline.skipped}`;
console.log(`migration journal wall OK (${scope})`);
