import { test } from "node:test";
import assert from "node:assert/strict";
import { decision, makeRepo, makeUnitDir, runHook, writeManifest, writeAdapter } from "./fixture.mjs";

const ADAPTER = {
  exclusiveCommands: [
    { resource: "postgres", pattern: "\\btest:int\\b", symptom: "Shared Postgres; results corrupt each other." },
  ],
};

function setup(holder) {
  const root = makeRepo();
  const unitDir = makeUnitDir(root, "u1");
  writeAdapter(root, ADAPTER);
  writeManifest(root, {
    runId: "r1",
    teardown: null,
    units: [{ id: "u1", worktree: unitDir, fileScope: ["**"], state: "open" }],
    resources: { postgres: holder },
  });
  return unitDir;
}

test("a unit holding the lease runs freely", () => {
  const unitDir = setup("u1");
  const res = runHook("resource-lease.mjs", {
    cwd: unitDir, tool_name: "Bash", tool_input: { command: "pnpm --filter web test:int" },
  });
  assert.equal(decision(res), null);
});

test("a unit without the lease is asked, and told who holds it", () => {
  const unitDir = setup("u2");
  const res = runHook("resource-lease.mjs", {
    cwd: unitDir, tool_name: "Bash", tool_input: { command: "pnpm --filter web test:int" },
  });
  assert.equal(decision(res), "ask");
  const reason = res.json.hookSpecificOutput.permissionDecisionReason;
  assert.match(reason, /u2/);
  assert.match(reason, /corrupt each other/);
});

test("an unrelated command is ignored", () => {
  const unitDir = setup("u2");
  const res = runHook("resource-lease.mjs", {
    cwd: unitDir, tool_name: "Bash", tool_input: { command: "git status" },
  });
  assert.equal(decision(res), null);
});

test("an unleased resource is free", () => {
  const unitDir = setup(undefined);
  const res = runHook("resource-lease.mjs", {
    cwd: unitDir, tool_name: "Bash", tool_input: { command: "pnpm --filter web test:int" },
  });
  assert.equal(decision(res), null);
});

test("a unit with no id in the manifest fails open rather than false-positive-asking", () => {
  // Verified: with worktree valid but `id` missing, `holder === found.unit.id`
  // compared "u2" against `undefined` and returned true for "not the holder",
  // producing an ask from a malformed manifest instead of a no-op.
  const root = makeRepo();
  const unitDir = makeUnitDir(root, "u1");
  writeAdapter(root, ADAPTER);
  writeManifest(root, {
    runId: "r1",
    teardown: null,
    units: [{ worktree: unitDir, fileScope: ["**"], state: "open" }],
    resources: { postgres: "u2" },
  });
  const res = runHook("resource-lease.mjs", {
    cwd: unitDir, tool_name: "Bash", tool_input: { command: "pnpm --filter web test:int" },
  });
  assert.equal(res.status, 0);
  assert.equal(decision(res), null);
});

// KI-63: `resource` and `symptom` reach a template literal (and `resource`
// also indexes `leases`), and neither was type-checked. An object whose
// `toString` AND `valueOf` are shadowed with non-callables — expressible in
// plain JSON — throws "Cannot convert object to primitive value" out of a
// PreToolUse hook, which breaks every Bash command in the repo until someone
// finds the adapter file. A merely MISSING field coerces to "undefined"
// harmlessly, which is why this needed a deliberately pathological input and
// was judged safe to leave.
const UNCOERCIBLE = { toString: null, valueOf: null };

test("an adapter entry with an uncoercible resource fails open, not with a crash", () => {
  const root = makeRepo();
  const unitDir = makeUnitDir(root, "u1");
  writeAdapter(root, {
    exclusiveCommands: [
      { resource: UNCOERCIBLE, pattern: "\\btest:int\\b", symptom: "boom" },
    ],
  });
  writeManifest(root, {
    runId: "r1", teardown: null,
    units: [{ id: "u1", worktree: unitDir, fileScope: ["**"], state: "open" }],
    resources: { postgres: "u2" },
  });
  const res = runHook("resource-lease.mjs", {
    cwd: unitDir, tool_name: "Bash", tool_input: { command: "pnpm --filter web test:int" },
  });
  assert.equal(res.status, 0);
  assert.equal(decision(res), null);
});

test("an adapter entry with an uncoercible symptom fails open, not with a crash", () => {
  const root = makeRepo();
  const unitDir = makeUnitDir(root, "u1");
  writeAdapter(root, {
    exclusiveCommands: [
      { resource: "postgres", pattern: "\\btest:int\\b", symptom: UNCOERCIBLE },
    ],
  });
  writeManifest(root, {
    runId: "r1", teardown: null,
    units: [{ id: "u1", worktree: unitDir, fileScope: ["**"], state: "open" }],
    resources: { postgres: "u2" },
  });
  const res = runHook("resource-lease.mjs", {
    cwd: unitDir, tool_name: "Bash", tool_input: { command: "pnpm --filter web test:int" },
  });
  assert.equal(res.status, 0);
  assert.equal(decision(res), null);
});

test("a well-formed sibling entry is still enforced after a malformed one is skipped", () => {
  // Failing open on a bad entry must not disarm the rest of the list.
  const root = makeRepo();
  const unitDir = makeUnitDir(root, "u1");
  writeAdapter(root, {
    exclusiveCommands: [
      { resource: UNCOERCIBLE, pattern: "\\btest:int\\b", symptom: "boom" },
      { resource: "postgres", pattern: "\\btest:int\\b", symptom: "Shared Postgres; results corrupt each other." },
    ],
  });
  writeManifest(root, {
    runId: "r1", teardown: null,
    units: [{ id: "u1", worktree: unitDir, fileScope: ["**"], state: "open" }],
    resources: { postgres: "u2" },
  });
  const res = runHook("resource-lease.mjs", {
    cwd: unitDir, tool_name: "Bash", tool_input: { command: "pnpm --filter web test:int" },
  });
  assert.equal(decision(res), "ask");
  assert.match(res.json.hookSpecificOutput.permissionDecisionReason, /corrupt each other/);
});

test("a missing adapter fails open", () => {
  const root = makeRepo();
  const unitDir = makeUnitDir(root, "u1");
  writeManifest(root, {
    runId: "r1", teardown: null,
    units: [{ id: "u1", worktree: unitDir, fileScope: ["**"], state: "open" }],
    resources: { postgres: "u2" },
  });
  const res = runHook("resource-lease.mjs", {
    cwd: unitDir, tool_name: "Bash", tool_input: { command: "pnpm --filter web test:int" },
  });
  assert.equal(res.status, 0);
  assert.equal(decision(res), null);
});
