// What `scripts/preview-migrate.mjs` decides, apart from the database, so the
// test can import it. The entry's header says why the preview build migrates
// through it rather than `drizzle-kit migrate` (KI-2026-10-17-c).

/**
 * Reads the applied rows of `drizzle.__drizzle_migrations` against the journal
 * the way drizzle's migrator does (`drizzle-orm/pg-core/dialect`): it applies
 * every entry whose `when` is newer than the newest row's `created_at`, and
 * matches nothing by name or hash.
 *
 * `entries` are `{ tag, when, hash }`, `hash` being drizzle's sha256 of the
 * file. `rows` are `{ id, hash, created_at }` as node-postgres returns them, so
 * `created_at` (a bigint) may be a string.
 *
 * - `toApply`: what the migrator is about to run.
 * - `orphans`: applied rows whose `created_at` is no entry's `when`, and older
 *   than something in `toApply`. On the shared preview branch that is either
 *   another open PR's migration (harmless) or one this tree renumbered.
 * - `renumbered`: orphans whose hash IS an entry in `toApply`: the same SQL,
 *   applied once under an old number, about to run again. Its DDL fails on
 *   objects that already exist. A row newer than every entry is never an
 *   orphan, which is why another PR's newer migration never trips this.
 */
export function diagnoseAppliedMigrations(entries, rows) {
  const newest = rows.reduce((max, row) => Math.max(max, Number(row.created_at)), -Infinity);
  const toApply = entries.filter((entry) => entry.when > newest);
  const known = new Set(entries.map((entry) => entry.when));
  const latestToApply = toApply.reduce((max, entry) => Math.max(max, entry.when), -Infinity);
  const orphans = rows.filter(
    (row) => !known.has(Number(row.created_at)) && Number(row.created_at) < latestToApply,
  );
  const renumbered = [];
  for (const row of orphans) {
    const entry = toApply.find((candidate) => candidate.hash === row.hash);
    if (entry) renumbered.push({ row, entry });
  }
  return { toApply, orphans, renumbered };
}

/** The recovery KI-2026-10-17-c records, as the build prints it. */
export function renumberedMessage(renumbered) {
  const lines = renumbered.map(
    ({ row, entry }) =>
      `  row id=${row.id} created_at=${row.created_at}: the same SQL as ${entry.tag} (when=${entry.when}), applied under an old number`,
  );
  return (
    "[preview-migrate] REFUSING to migrate: a migration this tree renumbered is already applied.\n" +
    `${lines.join("\n")}\n` +
    "\n" +
    "drizzle applies every journal entry newer than the newest applied row, so it would\n" +
    "run that SQL a second time and fail on objects that already exist. Every preview\n" +
    "build shares this database, so every branch's preview fails until it is repaired.\n" +
    "\n" +
    "Recovery (KI-2026-10-17-c; needs Mitchell's approval, the branch is shared):\n" +
    "  1. On the preview Neon branch, undo what the stale migration created\n" +
    "     (e.g. DROP TABLE <table>, or ALTER TABLE <t> DROP COLUMN <c>).\n" +
    `  2. DELETE FROM drizzle.__drizzle_migrations WHERE id IN (${renumbered.map(({ row }) => row.id).join(", ")});\n` +
    "  3. Redeploy one failing preview; the renumbered migration then applies once."
  );
}

/** Says which applied rows may be stale, for a migrate that failed anyway. */
export function orphansHint(orphans) {
  if (orphans.length === 0) return "";
  return (
    "[preview-migrate] Applied rows that match no journal entry and are older than what was\n" +
    "about to apply. If one is a migration this tree renumbered with changed SQL, it is the\n" +
    "cause, and KI-2026-10-17-c's recovery applies:\n" +
    orphans.map((row) => `  row id=${row.id} created_at=${row.created_at}`).join("\n")
  );
}

/**
 * The text of a failed migrate, with the Postgres error drizzle wraps in
 * `cause` (`DrizzleQueryError`). `drizzle-kit migrate` drew its spinner over
 * exactly this, so the build log said only that something failed.
 */
export function describeMigrateError(error) {
  const lines = [`[preview-migrate] migrate FAILED: ${error?.message ?? String(error)}`];
  const cause = error?.cause;
  if (cause) {
    lines.push(`  postgres: ${cause.message ?? String(cause)}`);
    for (const key of ["code", "detail", "hint", "table", "column", "constraint"]) {
      if (cause[key]) lines.push(`  ${key}: ${cause[key]}`);
    }
  }
  return lines.join("\n");
}
