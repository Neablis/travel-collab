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
