#!/usr/bin/env node
// Compare two Postgres databases before and after the M64 cutover (PR 794):
// every public table's row count, the migrations drizzle recorded, the
// `vector` extension, and the HNSW index on `day_embeddings`. Prints one line
// per difference and exits 1 if there is any, 0 if the two match. Exit 2 means
// it could not compare (bad usage, an unreachable or half-restored side): that
// is not a verdict on the copy, and must not read as one.
//
//   COMPARE_DB_A=<connection-string> COMPARE_DB_B=<connection-string> node scripts/compare-databases.mjs
//
// The strings come from the environment, not argv, which `ps` and shell
// history would show with the password in it.
//
// Read-only: each side runs in one REPEATABLE READ, READ ONLY transaction, so
// a mistyped URL cannot change anything and every count on a side comes from
// the same moment. The two sides are still read at different moments, so a
// database that keeps taking writes (the live source) will differ from its
// copy: expect equality only with maintenance mode on. Row counts are exact
// (`count(*)`), so a table that lost or gained a row shows. What a match proves
// is shape and volume only: not row contents (an updated or corrupted row keeps
// its count), not sequences, not indexes other than the HNSW one, not other
// extensions or constraints.

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

/** What the script learns about one database. Plain data, so `diff` is a pure function. */
export function emptySnapshot() {
  return { tables: {}, migrations: [], vector: false, hnsw: false };
}

/** Every way `a` and `b` differ, as lines for a person; empty when they match. */
export function diff(a, b) {
  const lines = [];
  for (const name of [...new Set([...Object.keys(a.tables), ...Object.keys(b.tables)])].sort()) {
    const [x, y] = [a.tables[name], b.tables[name]];
    if (x === undefined) lines.push(`table ${name}: only in B (${y} rows)`);
    else if (y === undefined) lines.push(`table ${name}: only in A (${x} rows)`);
    else if (x !== y) lines.push(`table ${name}: ${x} rows in A, ${y} in B`);
  }
  const [ma, mb] = [new Set(a.migrations), new Set(b.migrations)];
  for (const hash of a.migrations) if (!mb.has(hash)) lines.push(`migration ${hash}: only in A`);
  for (const hash of b.migrations) if (!ma.has(hash)) lines.push(`migration ${hash}: only in B`);
  if (a.vector !== b.vector) lines.push(`vector extension: ${a.vector ? "A" : "B"} has it, ${a.vector ? "B" : "A"} does not`);
  if (a.hnsw !== b.hnsw) lines.push(`day_embeddings HNSW index: ${a.hnsw ? "A" : "B"} has it, ${a.hnsw ? "B" : "A"} does not`);
  return lines;
}

// Quoted by hand: table names come from the catalogue, never from a caller.
const quote = (name) => `"${name.replaceAll('"', '""')}"`;

/** Read one database's snapshot over a connected `pg` client. */
export async function snapshot(client) {
  await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    const out = emptySnapshot();
    const { rows: tables } = await client.query(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
    );
    for (const { tablename } of tables) {
      const { rows } = await client.query(`SELECT count(*)::int AS n FROM public.${quote(tablename)}`);
      out.tables[tablename] = rows[0].n;
    }
    const { rows: ran } = await client.query("SELECT hash FROM drizzle.__drizzle_migrations ORDER BY id");
    out.migrations = ran.map((r) => r.hash);
    out.vector = (await client.query("SELECT 1 FROM pg_extension WHERE extname = 'vector'")).rowCount > 0;
    out.hnsw =
      (
        await client.query(
          "SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'day_embeddings' AND indexdef ILIKE '%USING hnsw%'",
        )
      ).rowCount > 0;
    return out;
  } finally {
    await client.query("ROLLBACK");
  }
}

async function snapshotOf(Client, url) {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return await snapshot(client);
  } finally {
    await client.end();
  }
}

async function main() {
  const { COMPARE_DB_A: urlA, COMPARE_DB_B: urlB } = process.env;
  if (!urlA || !urlB) {
    console.error("usage: COMPARE_DB_A=<connection-string> COMPARE_DB_B=<connection-string> node scripts/compare-databases.mjs");
    process.exit(2);
  }
  // `pg` is the web app's dependency, not the root's.
  const { Client } = createRequire(new URL("../apps/web/package.json", import.meta.url))("pg");
  const [a, b] = await Promise.all([snapshotOf(Client, urlA), snapshotOf(Client, urlB)]);
  const lines = diff(a, b);
  console.log(`A: ${Object.keys(a.tables).length} tables, ${a.migrations.length} migrations`);
  console.log(`B: ${Object.keys(b.tables).length} tables, ${b.migrations.length} migrations`);
  for (const line of lines) console.log(`DIFF  ${line}`);
  if (lines.length > 0) process.exit(1);
  console.log("The two databases match.");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (err) {
    console.error(`could not compare: ${err instanceof Error ? err.message : err}`);
    process.exit(2);
  }
}
