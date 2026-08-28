import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { decision, makeRepo, makeUnitDir, runHook, runHookRaw, writeManifest } from "./fixture.mjs";

function setup() {
  const root = makeRepo();
  const unitDir = makeUnitDir(root, "u1");
  const runDir = writeManifest(root, {
    runId: "r1",
    teardown: null,
    units: [{ id: "u1", worktree: unitDir, fileScope: ["src/**", "docs/notes.md"], state: "open" }],
    resources: {},
  });
  return { root, unitDir, runDir };
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

test("a dotdot-prefixed directory name inside the worktree is not mistaken for an escape", () => {
  // relative(root, ".../..hidden/a.ts") is the string "..hidden/a.ts", which
  // *starts with* ".." without being an actual ".." segment. A boundary
  // check that does plain startsWith("..") would misfile this as outside
  // the worktree; it must instead land on the file-scope reason.
  const { unitDir } = setup();
  const res = runHook("subagent-file-scope.mjs", {
    cwd: unitDir,
    tool_name: "Edit",
    tool_input: { file_path: join(unitDir, "..hidden/a.ts") },
  });
  assert.equal(decision(res), "ask");
  assert.match(res.json.hookSpecificOutput.permissionDecisionReason, /declared file scope/);
  assert.doesNotMatch(
    res.json.hookSpecificOutput.permissionDecisionReason,
    /outside its own worktree/,
  );
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

test("a non-object payload fails open", () => {
  // runHook always JSON.stringifies its payload, so this sends the valid
  // JSON document "not-an-object" (a string), exercising the
  // `typeof payload !== "object"` guard rather than parseStdin's own catch.
  const res = runHook("subagent-file-scope.mjs", "not-an-object");
  assert.equal(res.status, 0);
  assert.equal(decision(res), null);
});

test("genuinely unparseable stdin fails open", () => {
  // parseStdin's JSON.parse catch, not the typeof guard above: this is raw
  // text no JSON parser accepts.
  const res = runHookRaw("subagent-file-scope.mjs", "{ not json");
  assert.equal(res.status, 0);
  assert.equal(decision(res), null);
});

// The contract MANDATES two writes that land outside the unit's worktree:
// the report at <run-dir>/reports/<unit-id>.md and board entries at
// <run-dir>/notes/<ts>-<slug>.md. The run directory lives in the main
// checkout while units live in worktrees, so both used to trip the
// worktree-boundary branch and stall every unit on a permission prompt for
// the file it was ordered to produce. Silence here is the feature.

test("the mandated report write into the active run's reports/ passes silently", () => {
  const { unitDir, runDir } = setup();
  const res = runHook("subagent-file-scope.mjs", {
    cwd: unitDir,
    tool_name: "Write",
    tool_input: { file_path: join(runDir, "reports/u1.md") },
  });
  assert.equal(res.status, 0);
  assert.equal(decision(res), null);
});

test("the mandated board write into the active run's notes/ passes silently", () => {
  const { unitDir, runDir } = setup();
  const res = runHook("subagent-file-scope.mjs", {
    cwd: unitDir,
    tool_name: "Write",
    tool_input: { file_path: join(runDir, "notes/2026-08-28T12:00:00Z-pg-port.md") },
  });
  assert.equal(res.status, 0);
  assert.equal(decision(res), null);
});

test("the run-directory allowance is scoped: another path outside the worktree still asks", () => {
  const { unitDir, root } = setup();
  const res = runHook("subagent-file-scope.mjs", {
    cwd: unitDir,
    tool_name: "Write",
    tool_input: { file_path: join(root, "somewhere-else/x.md") },
  });
  assert.equal(decision(res), "ask");
  assert.match(res.json.hookSpecificOutput.permissionDecisionReason, /outside its own worktree/);
});

test("the run-directory allowance is boundary-safe, not a string prefix", () => {
  // "<runDir>-evil" starts with the run directory's path as a string but is
  // a sibling directory, not a child. A bare startsWith(runDir) would let it
  // through; the sep-terminated check must not.
  const { unitDir, runDir } = setup();
  const res = runHook("subagent-file-scope.mjs", {
    cwd: unitDir,
    tool_name: "Write",
    tool_input: { file_path: `${runDir}-evil/reports/u1.md` },
  });
  assert.equal(decision(res), "ask");
  assert.match(res.json.hookSpecificOutput.permissionDecisionReason, /outside its own worktree/);
});
