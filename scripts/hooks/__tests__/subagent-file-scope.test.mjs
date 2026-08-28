import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { decision, makeRepo, makeUnitDir, runHook, writeManifest } from "./fixture.mjs";

function setup() {
  const root = makeRepo();
  const unitDir = makeUnitDir(root, "u1");
  writeManifest(root, {
    runId: "r1",
    teardown: null,
    units: [{ id: "u1", worktree: unitDir, fileScope: ["src/**", "docs/notes.md"], state: "open" }],
    resources: {},
  });
  return { root, unitDir };
}

test("an in-scope edit passes silently", () => {
  const { unitDir } = setup();
  const res = runHook("subagent-file-scope.mjs", {
    cwd: unitDir,
    tool_name: "Edit",
    tool_input: { file_path: join(unitDir, "src/a.ts") },
  });
  assert.equal(res.status, 0);
  assert.equal(decision(res), null);
});

test("an out-of-scope edit asks, and names the declared scope", () => {
  const { unitDir } = setup();
  const res = runHook("subagent-file-scope.mjs", {
    cwd: unitDir,
    tool_name: "Edit",
    tool_input: { file_path: join(unitDir, "other/b.ts") },
  });
  assert.equal(decision(res), "ask");
  assert.match(res.json.hookSpecificOutput.permissionDecisionReason, /src\/\*\*/);
});

test("an edit outside the worktree entirely asks", () => {
  const { unitDir } = setup();
  const res = runHook("subagent-file-scope.mjs", {
    cwd: unitDir,
    tool_name: "Write",
    tool_input: { file_path: "/etc/hosts" },
  });
  assert.equal(decision(res), "ask");
});

test("no manifest means no opinion", () => {
  const root = makeRepo();
  const loose = makeUnitDir(root, "loose");
  const res = runHook("subagent-file-scope.mjs", {
    cwd: loose,
    tool_name: "Edit",
    tool_input: { file_path: join(loose, "anything.ts") },
  });
  assert.equal(res.status, 0);
  assert.equal(decision(res), null);
});

test("malformed stdin fails open", () => {
  const res = runHook("subagent-file-scope.mjs", "not-an-object");
  assert.equal(res.status, 0);
  assert.equal(decision(res), null);
});
