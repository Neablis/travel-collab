import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeLinkedWorktree, makeRepo, runHook } from "./fixture.mjs";

function orchestrating() {
  const root = makeRepo();
  const gitDir = execFileSync("git", ["rev-parse", "--absolute-git-dir"], { cwd: root, encoding: "utf8" }).trim();
  writeFileSync(join(gitDir, "tc-orchestrator"), "");
  return { root, marker: join(gitDir, "tc-orchestrator") };
}

const edit = (cwd, file_path, extra = {}) =>
  runHook("orchestrator-no-code.mjs", { tool_name: "Edit", cwd, tool_input: { file_path }, ...extra });

test("the orchestrating main session is blocked from apps/ and packages/", () => {
  const { root } = orchestrating();
  for (const file of ["apps/web/src/x.ts", join(root, "packages/domain/src/y.ts")]) {
    const res = edit(root, file);
    assert.equal(res.status, 2, file);
    assert.match(res.stderr, /Dispatch a phase-implementer/);
  }
});

test("the block names the marker and the command that removes it", () => {
  const { root, marker } = orchestrating();
  const res = edit(root, "apps/web/src/x.ts");
  assert.equal(res.status, 2);
  assert.ok(res.stderr.includes(`rm ${marker}`), res.stderr);
});

test("code under another worktree is code too", () => {
  const { root } = orchestrating();
  const linked = makeLinkedWorktree(root);
  for (const file of [".claude/worktrees/m42-part1/apps/web/src/x.ts", join(linked, "packages/domain/src/y.ts")]) {
    const res = edit(root, file);
    assert.equal(res.status, 2, file);
    assert.match(res.stderr, /Dispatch a phase-implementer/, file);
  }
  assert.equal(edit(root, ".claude/worktrees/m42-part1/docs/plan.md").status, 0);
});

test("a subagent, prose files, and a session without the marker pass", () => {
  const { root, marker } = orchestrating();
  assert.equal(edit(root, "apps/web/src/x.ts", { agent_id: "a1", agent_type: "phase-implementer" }).status, 0);
  assert.equal(edit(root, "docs/plans/m41.md").status, 0);
  assert.equal(edit(root, ".claude/skills/build-a-part/SKILL.md").status, 0);
  rmSync(marker);
  const res = edit(root, "apps/web/src/x.ts");
  assert.equal(res.status, 0);
  assert.equal(res.stderr, "");
});
