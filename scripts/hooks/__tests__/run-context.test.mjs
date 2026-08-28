import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeLooseDir, makeRepo, makeUnitDir, writeManifest } from "./fixture.mjs";
import {
  activeRuns, globToRegExp, inScope, mainCheckout, unitForCwd,
} from "../lib/run-context.mjs";

function manifestFor(unitDir, extra = {}) {
  return {
    runId: "r1",
    teardown: null,
    units: [{ id: "u1", worktree: unitDir, fileScope: ["src/**"], state: "open" }],
    resources: { postgres: "u1" },
    ...extra,
  };
}

test("mainCheckout resolves the repo root from a nested directory", () => {
  const root = makeRepo();
  assert.equal(mainCheckout(makeUnitDir(root, "u1")), root);
});

test("mainCheckout returns null outside a git repo", () => {
  assert.equal(mainCheckout(makeLooseDir()), null);
});

test("unitForCwd matches a unit whose worktree contains cwd", () => {
  const root = makeRepo();
  const unitDir = makeUnitDir(root, "u1");
  writeManifest(root, manifestFor(unitDir));

  const found = unitForCwd(unitDir);
  assert.ok(found, "expected a match");
  assert.equal(found.unit.id, "u1");
  assert.equal(found.manifest.runId, "r1");
});

test("unitForCwd ignores a cwd outside every unit worktree", () => {
  const root = makeRepo();
  const unitDir = makeUnitDir(root, "u1");
  writeManifest(root, manifestFor(unitDir));
  assert.equal(unitForCwd(makeUnitDir(root, "elsewhere")), null);
});

test("a torn-down run is invisible", () => {
  const root = makeRepo();
  const unitDir = makeUnitDir(root, "u1");
  writeManifest(root, manifestFor(unitDir, { teardown: "2026-08-28T12:00:00Z" }));
  assert.equal(activeRuns(unitDir).length, 0);
  assert.equal(unitForCwd(unitDir), null);
});

test("a malformed manifest is skipped, not thrown", () => {
  const root = makeRepo();
  const unitDir = makeUnitDir(root, "u1");
  const runDir = writeManifest(root, manifestFor(unitDir));
  writeFileSync(join(runDir, "manifest.json"), "{ not json");
  assert.deepEqual(activeRuns(unitDir), []);
});

test("globToRegExp handles ** and *", () => {
  assert.ok(globToRegExp("src/**").test("src/a/b.ts"));
  assert.ok(globToRegExp("src/*.ts").test("src/a.ts"));
  assert.ok(!globToRegExp("src/*.ts").test("src/a/b.ts"));
  assert.ok(globToRegExp("**/*.test.mjs").test("scripts/hooks/x.test.mjs"));
  assert.ok(!globToRegExp("src/**").test("docs/a.md"));
});

test("globToRegExp matches **/ as whole directory segments, not a substring", () => {
  assert.ok(globToRegExp("src/**/x.ts").test("src/a/x.ts"));
  assert.ok(globToRegExp("src/**/x.ts").test("src/a/b/x.ts"));
  assert.ok(globToRegExp("src/**/x.ts").test("src/x.ts")); // zero segments
  assert.ok(!globToRegExp("src/**/x.ts").test("src/a/bar-x.ts")); // the bug
});

test("inScope is false for an empty or missing glob list", () => {
  assert.equal(inScope("src/a.ts", []), false);
  assert.equal(inScope("src/a.ts", undefined), false);
});
