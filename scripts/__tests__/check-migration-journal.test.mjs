import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const WALL = join(dirname(fileURLToPath(import.meta.url)), "..", "check-migration-journal.mjs");

/** `["0001_b=2000", …]` → a journal object, idx assigned by position. */
function journal(specs) {
  return {
    version: "7",
    dialect: "postgresql",
    entries: specs.map((spec, idx) => {
      const [tag, when] = spec.split("=");
      return { idx, version: "7", when: Number(when), tag, breakpoints: true };
    }),
  };
}

/**
 * Writes a drizzle directory (journal + one .sql per entry, unless `sql`
 * overrides the file list) and runs the wall against `baseline`.
 *
 * The baseline goes in as a file rather than a git ref on purpose: the wall's
 * git lookup is a way of FINDING main's journal, not the rule being tested,
 * and a test that has to build a git repo to assert an ordering rule tests
 * git.
 */
function runWall({ entries, baseline, sql, sqlBody, snapshots }) {
  const dir = mkdtempSync(join(tmpdir(), "tc-migration-wall-"));
  const drizzle = join(dir, "drizzle");
  mkdirSync(join(drizzle, "meta"), { recursive: true });
  const journalUnderTest = journal(entries);
  writeFileSync(join(drizzle, "meta", "_journal.json"), JSON.stringify(journalUnderTest, null, 2));
  for (const tag of sql ?? journalUnderTest.entries.map((e) => e.tag)) {
    // Default body is a COMMENT, i.e. no DDL — so the snapshot rule is silent
    // for every test that is not about it. `sqlBody` opts a tag into real DDL.
    writeFileSync(join(drizzle, `${tag}.sql`), sqlBody?.[tag] ?? "-- SELECT 1;\n");
  }
  for (const idx of snapshots ?? []) {
    writeFileSync(
      join(drizzle, "meta", `${String(idx).padStart(4, "0")}_snapshot.json`),
      JSON.stringify({ id: `id-${idx}`, prevId: `id-${idx - 1}` }),
    );
  }
  const args = [WALL, drizzle];
  if (baseline) {
    const baselinePath = join(dir, "baseline.json");
    writeFileSync(baselinePath, JSON.stringify(journal(baseline), null, 2));
    args.push("--baseline", baselinePath);
  }
  const result = spawnSync(process.execPath, args, { encoding: "utf8" });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

// THE CASE THE WALL EXISTS FOR (KI-2026-09-05-k / F-D03). A branch cut before a
// colleague's migration landed generates its own; its `when` is earlier, so
// `drizzle-kit migrate` — which applies only entries newer than the newest row
// already applied — skips it and still reports success.
test("rejects a new migration that is not newer than the baseline's newest", () => {
  const { status, stderr } = runWall({
    entries: ["0000_a=1000", "0001_b=2000", "0002_mine=2500"],
    baseline: ["0000_a=1000", "0001_b=2000", "0002_theirs=3000"],
  });
  assert.equal(status, 1);
  assert.match(stderr, /0002_mine \(when=2500\) is NOT newer than the baseline's newest migration 0002_theirs \(when=3000\)/);
  // The message has to carry the fix, because "renumber it" is the wrong one:
  // `when` is what the migrator compares, not the 0016_ prefix.
  assert.match(stderr, /re-run `pnpm --filter web db:generate`/);
});

test("accepts a new migration generated after the baseline's newest", () => {
  const { status, stdout } = runWall({
    entries: ["0000_a=1000", "0001_b=2000", "0002_theirs=3000", "0003_mine=4000"],
    baseline: ["0000_a=1000", "0001_b=2000", "0002_theirs=3000"],
  });
  assert.equal(status, 0, stdout);
  assert.match(stdout, /4 entries/);
});

// Internal monotonicity is NOT the production check, but it is the one that
// catches two agents generating in parallel — and `drizzle-kit check` does not:
// measured 2026-09-07, a journal with two `idx: 18` entries printed
// "Everything's fine 🐶🔥" and exited 0.
test("rejects two entries sharing one idx, which drizzle-kit check does not read", () => {
  const dir = mkdtempSync(join(tmpdir(), "tc-migration-wall-"));
  const drizzle = join(dir, "drizzle");
  mkdirSync(join(drizzle, "meta"), { recursive: true });
  const both = journal(["0000_a=1000", "0001_one=2000", "0002_two=3000"]);
  both.entries[2].idx = 1; // the shape a bad merge resolution leaves behind
  writeFileSync(join(drizzle, "meta", "_journal.json"), JSON.stringify(both, null, 2));
  for (const entry of both.entries) writeFileSync(join(drizzle, `${entry.tag}.sql`), "-- SELECT 1;\n");
  const { status, stderr } = spawnSync(process.execPath, [WALL, drizzle], { encoding: "utf8" });
  assert.equal(status, 1);
  assert.match(stderr, /0002_two: idx is 1 but it sits at position 2/);
});

test("rejects a journal whose `when` values go backwards", () => {
  const { status, stderr } = runWall({ entries: ["0000_a=3000", "0001_b=2000"] });
  assert.equal(status, 1);
  assert.match(stderr, /0001_b: when=2000 is not after 0000_a's 3000/);
});

test("rejects a .sql file no journal entry names, and an entry with no .sql", () => {
  const orphanFile = runWall({
    entries: ["0000_a=1000"],
    sql: ["0000_a", "0001_never_applied"],
  });
  assert.equal(orphanFile.status, 1);
  assert.match(orphanFile.stderr, /0001_never_applied\.sql: is not in the journal/);

  const orphanEntry = runWall({ entries: ["0000_a=1000", "0001_b=2000"], sql: ["0000_a"] });
  assert.equal(orphanEntry.status, 1);
  assert.match(orphanEntry.stderr, /0001_b: journal entry has no 0001_b\.sql/);
});

// `when` is the value drizzle writes into `drizzle.__drizzle_migrations`, so
// regenerating an already-merged migration makes an applied one look pending.
test("rejects rewriting the `when` of a migration the baseline already carries", () => {
  const { status, stderr } = runWall({
    entries: ["0000_a=1000", "0001_b=2500"],
    baseline: ["0000_a=1000", "0001_b=2000"],
  });
  assert.equal(status, 1);
  assert.match(stderr, /0001_b: when=2500 here, 2000 on the baseline/);
});

test("rejects dropping a migration the baseline carries — migrations are forward-only", () => {
  const { status, stderr } = runWall({
    entries: ["0000_a=1000"],
    baseline: ["0000_a=1000", "0001_b=2000"],
  });
  assert.equal(status, 1);
  assert.match(stderr, /0001_b: on the baseline and gone here/);
});

// The degradation that keeps this wall usable in `lint` everywhere. A CI
// runner checks out one ref, so `origin/main` is usually absent there; the wall
// must say what it could not compare rather than fail, or `pnpm lint` breaks on
// every runner. Silence would be worse than either — it would read as a pass.
test("says so, and still passes, when no baseline ref can be resolved", () => {
  const { status, stdout } = runWall({ entries: ["0000_a=1000", "0001_b=2000"] });
  assert.equal(status, 0, stdout);
  assert.match(stdout, /baseline NOT compared/);
});

// KI-2026-09-07-a. `0018_saved_day_source_bundle`'s snapshot was never
// committed, so `drizzle-kit generate` diffed `schema.ts` against `0017` and
// re-emitted 0018's own ALTER as a brand-new migration — which then fails on
// apply with "column already exists" against every current database. The next
// person to write a migration inherits a broken artefact before writing a line.
// `drizzle-kit check` does not catch this: it reads the snapshots it HAS and
// never opens `_journal.json`.
test("rejects a schema migration whose snapshot was never committed", () => {
  const { status, stderr } = runWall({
    entries: ["0000_a=1000", "0001_adds_a_column=2000"],
    sqlBody: { "0001_adds_a_column": 'ALTER TABLE "saved_days" ADD COLUMN "source_bundle" text;\n' },
    snapshots: [0],
  });
  assert.equal(status, 1);
  assert.match(stderr, /0001_adds_a_column: changes schema but has no meta\/0001_snapshot\.json/);
  assert.match(stderr, /re-emit this migration's own change/);
});

test("accepts a schema migration that has its snapshot", () => {
  const { status, stdout } = runWall({
    entries: ["0000_a=1000", "0001_adds_a_column=2000"],
    sqlBody: { "0001_adds_a_column": 'ALTER TABLE "saved_days" ADD COLUMN "source_bundle" text;\n' },
    snapshots: [0, 1],
  });
  assert.equal(status, 0);
  assert.match(stdout, /migration journal wall OK/);
});

// THE EXEMPTION, and it is load-bearing. `0016_demo_visitor_orphans` is a
// hand-written `DELETE FROM` — it moves no schema, drizzle-kit never made a
// snapshot for it, and the previous snapshot still describes the schema
// correctly. A blanket "one snapshot per journal entry" rule fails on this and
// gets deleted for crying wolf, which is why the rule reads the SQL.
test("stays silent for a data-only migration with no snapshot", () => {
  const { status, stdout } = runWall({
    entries: ["0000_a=1000", "0001_deletes_rows=2000"],
    sqlBody: { "0001_deletes_rows": 'DELETE FROM "saved_days" WHERE "owner_id" = \'demo-visitor\';\n' },
    snapshots: [0],
  });
  assert.equal(status, 0);
  assert.match(stdout, /migration journal wall OK/);
});
