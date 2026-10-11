import { test } from "node:test";
import assert from "node:assert/strict";
import { runHook } from "./fixture.mjs";

const OK = { stdout: "", stderr: "To github.com:o/r.git\n   a..b  x -> x\n", interrupted: false };
const run = (command, tool_response = OK) =>
  runHook("push-review-nudge.mjs", { tool_name: "Bash", tool_input: { command }, tool_response });

test("a push of a part branch adds the part-reviewer nudge as context", () => {
  const res = run("git push -u origin claude/m41-part2-drawer-is-cards");
  assert.equal(res.status, 0);
  assert.equal(res.json.hookSpecificOutput.hookEventName, "PostToolUse");
  assert.equal(
    res.json.hookSpecificOutput.additionalContext,
    "Pushed claude/m41-part2-drawer-is-cards. Next per review-a-part: dispatch the part-reviewer agent on this PR.",
  );
  assert.match(run("git push origin HEAD:refs/heads/claude/m41-part3").json.hookSpecificOutput.additionalContext, /^Pushed claude\/m41-part3\./);
});

test("main, a rejected push, a tag push and non-push commands add nothing", () => {
  for (const [command, response] of [
    ["git push origin main", OK],
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
    [`git${opts} push -u origin claude/x`, true],
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
