import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { diff, snapshot } from "../compare-databases.mjs";

const base = () => ({ tables: { trips: 3, days: 9 }, migrations: ["h1", "h2"], vector: true, hnsw: true });

test("two matching snapshots have no differences", () => {
  assert.deepEqual(diff(base(), base()), []);
});

test("a row count that differs names the table and both counts", () => {
  const b = base();
  b.tables.days = 8;
  assert.deepEqual(diff(base(), b), ["table days: 9 rows in A, 8 in B"]);
});

test("a table on one side only is named", () => {
  const b = base();
  b.tables.extra = 1;
  assert.deepEqual(diff(base(), b), ["table extra: only in B (1 rows)"]);
});

test("a migration missing from one side is named", () => {
  const b = base();
  b.migrations = ["h1"];
  assert.deepEqual(diff(base(), b), ["migration h2: only in A"]);
});

test("a missing vector extension or HNSW index is named", () => {
  const b = base();
  b.vector = false;
  b.hnsw = false;
  assert.deepEqual(diff(base(), b), [
    "vector extension: A has it, B does not",
    "day_embeddings HNSW index: A has it, B does not",
  ]);
});

// One snapshot per side: under READ COMMITTED each count(*) sees a different
// moment, so a live database would differ from itself between two tables.
test("a snapshot reads in one repeatable-read, read-only transaction", async () => {
  const sent = [];
  const client = {
    async query(sql) {
      sent.push(sql);
      return { rows: [], rowCount: 0 };
    },
  };
  await snapshot(client);
  assert.match(sent[0], /^BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY$/);
  assert.equal(sent.at(-1), "ROLLBACK");
});

// A side that could not be read is not a side that differs: the cutover gate
// reads exit 1 as "the copy is wrong".
test("a database that cannot be reached exits 2, not 1", () => {
  const script = fileURLToPath(new URL("../compare-databases.mjs", import.meta.url));
  const dead = "postgres://nobody@127.0.0.1:1/none";
  const run = spawnSync(process.execPath, [script, dead, dead], { encoding: "utf8" });
  assert.equal(run.status, 2);
  assert.match(run.stderr, /could not compare/);
});
