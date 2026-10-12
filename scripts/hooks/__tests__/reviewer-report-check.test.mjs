import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { makeRepo, runHook, runHookRaw } from "./fixture.mjs";

const HOOK = "reviewer-report-check.mjs";
const GOOD = `Verdict: changes requested (PR 420 at 6c92e9a)

- high, apps/web/src/drawer.tsx:41, card key collides across days
- low, apps/web/src/drawer.test.tsx:12, assertion cannot fail

Full review: /repo/.git/tc-reviews/pr-420-6c92e9a.md`;

const run = (payload) =>
  runHook(HOOK, { hook_event_name: "SubagentStop", stop_hook_active: false, agent_type: "part-reviewer", ...payload });

test("a hand-back with no Full review path blocks the stop and says where to write the review", () => {
  for (const text of [
    GOOD.replace(/\nFull review: .*/, ""),
    GOOD.replace(/Full review: .*/, "Full review: posted"),
    GOOD.replace("Full review:", "The full review is at"),
  ]) {
    const res = run({ last_assistant_message: text });
    assert.equal(res.status, 2, text);
    assert.match(res.stderr, /^finish: write the full review to a file and hand back only its outline\./);
    assert.match(res.stderr, /no `Full review:` line with the file's path/);
    assert.match(res.stderr, /\$\(git rev-parse --git-common-dir\)\/tc-reviews\/pr-<n>-<short sha>\.md" with a shell heredoc/);
    assert.match(res.stderr, /the verdict; one line per finding \(severity, file:line, six words\); and a `Full review:` line/);
  }
});

test("a hand-back over 4,000 characters blocks even with the path, and states its length", () => {
  const text = `${"x".repeat(4001 - GOOD.length - 1)}\n${GOOD}`;
  assert.equal(text.length, 4001);
  const res = run({ last_assistant_message: text });
  assert.equal(res.status, 2);
  assert.match(res.stderr, /the hand-back is 4001 characters \(limit 4000\)/);
  assert.doesNotMatch(res.stderr, /no `Full review:` line/);
  assert.equal(run({ last_assistant_message: text.slice(1) }).status, 0);
});

test("a short hand-back with the path passes, bold or bulleted", () => {
  for (const text of [GOOD, GOOD.replace("Full review:", "- **Full review:**"), GOOD.replace(/Full review: (.*)/, "full review: `$1`")]) {
    const res = run({ last_assistant_message: text });
    assert.equal(res.status, 0, text);
    assert.equal(res.stderr, "");
  }
});

test("a retry, another agent type, no agent type and an empty message pass", () => {
  const bad = "x".repeat(9000);
  assert.equal(run({ last_assistant_message: bad, stop_hook_active: true }).status, 0);
  assert.equal(run({ last_assistant_message: bad, agent_type: "phase-implementer" }).status, 0);
  assert.equal(run({ last_assistant_message: bad, agent_type: undefined }).status, 0);
  assert.equal(run({ last_assistant_message: "  " }).status, 0);
});

test("a reviewer that stops BLOCKED or DESCOPED owes no review file", () => {
  for (const exit of ["## Exit: BLOCKED", "## Exit: DESCOPED"]) {
    const res = runHook(HOOK, { agent_type: "part-reviewer", last_assistant_message: `${exit}\n\ngh pr diff failed: no network.` });
    assert.equal(res.status, 0, exit);
  }
});

test("garbage stdin fails open", () => {
  const res = runHookRaw(HOOK, "{not json");
  assert.equal(res.status, 0);
  assert.equal(res.stderr, "");
});

test("a block appends one guard-log line in the contract's shape", () => {
  const root = makeRepo();
  assert.equal(run({ last_assistant_message: "long story", cwd: root }).status, 2);
  const lines = readFileSync(join(root, ".git", "tc-guard-log.jsonl"), "utf8").trim().split("\n");
  assert.equal(lines.length, 1);
  const line = JSON.parse(lines[0]);
  assert.deepEqual(Object.keys(line), ["t", "hook", "decision"]);
  assert.equal(line.hook, "reviewer-report-check");
  assert.equal(line.decision, "deny");
});
