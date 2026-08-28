import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  makeLinkedWorktree, makeLooseDir, makeRepo, makeUnitDir, writeAdapter, writeManifest,
} from "./fixture.mjs";
import {
  activeRuns, globToRegExp, inScope, loadAdapter, mainCheckout, unitForCwd, worktreeRoot,
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

test("worktreeRoot returns null outside a git repo", () => {
  assert.equal(worktreeRoot(makeLooseDir()), null);
});

test("loadAdapter reads the calling worktree's own adapter.json, not the main checkout's", () => {
  const root = makeRepo();
  const linked = makeLinkedWorktree(root);

  // The adapter exists only in the linked worktree — exactly the pre-merge
  // shape in production, where a feature branch's adapter.json exists in
  // the worktree checked out on that branch but not yet in the main
  // checkout. `mainCheckout` and `worktreeRoot` both equal `root` for a
  // plain repo, so this case can only be told apart with a real linked
  // worktree (hence `makeLinkedWorktree` rather than two makeRepo() calls).
  writeAdapter(linked, { exclusiveCommands: ["from-linked-worktree"] });

  assert.equal(worktreeRoot(linked), linked);
  assert.equal(mainCheckout(linked), root);
  assert.deepEqual(loadAdapter(linked), { exclusiveCommands: ["from-linked-worktree"] });

  // The main checkout shares the linked worktree's git-common-dir but must
  // not see its adapter.json — this is the regression the fix closes.
  assert.equal(loadAdapter(root), null);
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

// The manifest is hand-authored JSON produced by an LLM, so every shape below
// has actually been written by mistake. Each one used to throw an uncaught
// TypeError out of unitForCwd — which, on a PreToolUse hook, means every
// Bash/Edit/Write call in the repo fails until someone finds the run
// directory. These pin the fail-open result instead.

test("unitForCwd fails open when units is an object rather than an array", () => {
  const root = makeRepo();
  const unitDir = makeUnitDir(root, "u1");
  writeManifest(root, {
    runId: "r1",
    teardown: null,
    units: { u1: { id: "u1", worktree: unitDir, fileScope: ["src/**"], state: "open" } },
    resources: {},
  });
  assert.equal(unitForCwd(unitDir), null);
});

test("unitForCwd skips a null unit entry and still matches a valid sibling", () => {
  const root = makeRepo();
  const unitDir = makeUnitDir(root, "u1");
  writeManifest(root, {
    runId: "r1",
    teardown: null,
    units: [null, { id: "u1", worktree: unitDir, fileScope: ["src/**"], state: "open" }],
    resources: {},
  });
  const found = unitForCwd(unitDir);
  assert.ok(found, "expected the valid sibling to still match");
  assert.equal(found.unit.id, "u1");
});

test("unitForCwd skips a unit whose worktree is not a string", () => {
  const root = makeRepo();
  const unitDir = makeUnitDir(root, "u1");
  writeManifest(root, {
    runId: "r1",
    teardown: null,
    units: [{ id: "u1", worktree: 5, fileScope: ["src/**"], state: "open" }],
    resources: {},
  });
  assert.equal(unitForCwd(unitDir), null);
});

test("unitForCwd skips a unit with no id, even when worktree and resources match", () => {
  // Verified against production: with a valid `worktree` but a missing `id`,
  // and `resources: {"postgres":"u2"}`, resource-lease.mjs's
  // `holder === found.unit.id` compares "u2" against `undefined` — false —
  // so the lease looks free and the hook fails open when it should have
  // recognized this manifest entry as malformed and no-opped instead.
  const root = makeRepo();
  const unitDir = makeUnitDir(root, "u1");
  writeManifest(root, {
    runId: "r1",
    teardown: null,
    units: [{ worktree: unitDir, fileScope: ["src/**"], state: "open" }],
    resources: { postgres: "u2" },
  });
  assert.equal(unitForCwd(unitDir), null);
});

test("unitForCwd skips a unit whose id is not a string", () => {
  const root = makeRepo();
  const unitDir = makeUnitDir(root, "u1");
  writeManifest(root, {
    runId: "r1",
    teardown: null,
    units: [{ id: 5, worktree: unitDir, fileScope: ["src/**"], state: "open" }],
    resources: {},
  });
  assert.equal(unitForCwd(unitDir), null);
});

test("unitForCwd returns null instead of throwing on a non-string cwd", () => {
  // `resolve(cwd)` throws a TypeError on a non-string argument. A hook
  // payload's `cwd` is attacker/mistake-controlled JSON, so a malformed
  // payload (a number, an object, `undefined` falling through a bad `??`)
  // must not crash a PreToolUse hook.
  assert.equal(unitForCwd(5), null);
  assert.equal(unitForCwd(undefined), null);
  assert.equal(unitForCwd({}), null);
});

test("inScope fails open when the glob list is a string rather than an array", () => {
  assert.equal(inScope("src/a.ts", "src/**"), false);
});

test("inScope skips a non-string glob entry rather than throwing on it", () => {
  assert.equal(inScope("src/a.ts", [null, 5]), false);
  assert.equal(inScope("src/a.ts", [null, "src/**"]), true);
});
