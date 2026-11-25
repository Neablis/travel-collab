import { test } from "node:test";
import assert from "node:assert/strict";
import { diff } from "../compare-databases.mjs";

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
