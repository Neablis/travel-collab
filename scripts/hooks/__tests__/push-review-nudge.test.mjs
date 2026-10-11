import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { makeLooseDir, makeRepo, runHook } from "./fixture.mjs";

const OK = { stdout: "", stderr: "To github.com:o/r.git\n   a..b  x -> x\n", interrupted: false };
// Not a repo, so a push with no refspec has no branch to fall back on, whatever
// branch the test runner is on.
const NO_BRANCH = makeLooseDir();
const run = (command, tool_response = OK, cwd = NO_BRANCH) =>
  runHook("push-review-nudge.mjs", { tool_name: "Bash", tool_input: { command }, tool_response, cwd });

function repoOn(branch) {
  const dir = makeRepo();
  execFileSync("git", ["checkout", "-q", "-b", branch], { cwd: dir });
  return dir;
}

test("a push of a part branch adds the part-reviewer nudge as context", () => {
  const res = run("git push -u origin claude/m41-part2-drawer-is-cards");
  assert.equal(res.status, 0);
  assert.equal(res.json.hookSpecificOutput.hookEventName, "PostToolUse");
  assert.equal(
    res.json.hookSpecificOutput.additionalContext,
    "Pushed claude/m41-part2-drawer-is-cards. Report this push; the orchestrator dispatches part-reviewer (review-a-part).",
  );
  assert.match(run("git push origin HEAD:refs/heads/claude/m41-part3").json.hookSpecificOutput.additionalContext, /^Pushed claude\/m41-part3\./);
});

test("a redirection is not the branch; with no refspec the checked-out branch is", () => {
  const nudge = (r) => r.json?.hookSpecificOutput?.additionalContext ?? "";
  assert.match(nudge(run("git push -u origin claude/m41-part2-x 2>&1")), /^Pushed claude\/m41-part2-x\./);
  assert.match(nudge(run("git push -u origin claude/m41-part2-x > /tmp/push.log")), /^Pushed claude\/m41-part2-x\./);
  assert.match(nudge(run("git push 2>&1 | tail -3", OK, repoOn("claude/m41-part4-y"))), /^Pushed claude\/m41-part4-y\./);
});

test("main, a non-part branch, a rejected push, a tag push and non-push commands add nothing", () => {
  for (const [command, response] of [
    ["git push origin main", OK],
    ["git push -u origin claude/fix-something", OK],
    ["git push -u origin claude/build-a-milestone-abc", OK],
    ["git push 2>&1", OK],
    ["git push -u origin claude/x", { stdout: "", stderr: " ! [rejected]  claude/x -> claude/x (fetch first)\nerror: failed to push" }],
    ["git push --tags", OK],
    ["git status", OK],
    ["git commit -m 'git push later'", OK],
  ]) {
    const res = run(command, response);
    assert.equal(res.status, 0, command);
    assert.equal(res.stdout, "", command);
  }
});

test("a pathological run of git options is matched in linear time", () => {
  // `git -C=! -C=! ... x` made the old option matcher backtrack exponentially
  // (CodeQL js/redos); 5000 repeats never finished.
  const opts = " -C=!".repeat(5000);
  for (const [command, nudged] of [
    [`git${opts} x`, false],
    [`git${" -- -".repeat(5000)} x`, false],
    [`git${opts} push -u origin claude/m41-part2-x`, true],
  ]) {
    const started = Date.now();
    const res = runHook(
      "push-review-nudge.mjs",
      { tool_name: "Bash", tool_input: { command }, tool_response: OK },
      { timeout: 5000 },
    );
    assert.equal(res.signal, null, `${command.slice(0, 40)}... was killed`);
    assert.equal(res.status, 0);
    assert.equal(res.stdout !== "", nudged);
    assert.ok(Date.now() - started < 2000, `took ${Date.now() - started}ms`);
  }
});
