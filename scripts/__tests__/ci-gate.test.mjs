import { test } from "node:test";
import assert from "node:assert/strict";
import { isProse, touchesCode, verdict } from "../ci-gate.mjs";

const run = (code, results) => ({
  changes: { result: "success", outputs: { code } },
  ...Object.fromEntries(Object.entries(results).map(([name, result]) => [name, { result, outputs: {} }])),
});

test("prose is docs, agent config and root or .github markdown", () => {
  for (const path of ["docs/STATUS.md", ".agents/skills/x/SKILL.md", ".claude/settings.json", "AGENTS.md", ".github/PULL_REQUEST_TEMPLATE.md"]) {
    assert.equal(isProse(path), true, path);
  }
});

test("markdown below the root is not prose, and neither is .github config", () => {
  // `.design-sync/**` is a build input; `*.md` in the old `paths-ignore` was
  // root-level for that reason.
  for (const path of [".design-sync/handoff/README.md", "apps/web/README.md", ".github/workflows/ci.yml", ".github/dependabot.yml", "pnpm-lock.yaml"]) {
    assert.equal(isProse(path), false, path);
  }
});

test("one code path among prose means the jobs run", () => {
  assert.equal(touchesCode(["docs/a.md", "README.md"]), false);
  assert.equal(touchesCode(["docs/a.md", "apps/web/src/x.ts"]), true);
});

test("code changed: passes only when every job succeeded", () => {
  assert.equal(verdict(run("true", { lint: "success", unit: "success" })).ok, true);
  assert.deepEqual(verdict(run("true", { lint: "success", unit: "failure" })), { ok: false, reason: "not passed: unit=failure" });
});

test("code changed: a skipped or cancelled job is a no", () => {
  assert.equal(verdict(run("true", { lint: "success", unit: "skipped" })).ok, false);
  assert.equal(verdict(run("true", { lint: "cancelled", unit: "success" })).ok, false);
});

test("prose only: skipped jobs pass, a failed one still does not", () => {
  assert.equal(verdict(run("false", { lint: "skipped", unit: "skipped" })).ok, true);
  assert.equal(verdict(run("false", { lint: "skipped", unit: "failure" })).ok, false);
});

test("no answer from changes is a no", () => {
  assert.equal(verdict({ changes: { result: "failure", outputs: {} }, lint: { result: "skipped" } }).ok, false);
  assert.equal(verdict({ changes: { result: "success", outputs: {} }, lint: { result: "skipped" } }).ok, false);
  assert.equal(verdict({ lint: { result: "success" } }).ok, false);
  assert.equal(verdict(run("true", {})).ok, false);
});
