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
