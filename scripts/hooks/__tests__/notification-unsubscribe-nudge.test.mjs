import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeOrchestratorRepo, runHook, runHookRaw } from "./fixture.mjs";

const HOOK = "notification-unsubscribe-nudge.mjs";
const read = (cwd, tool_response, extra = {}) =>
  runHook(HOOK, {
    hook_event_name: "PostToolUse",
    tool_name: "ReadNotifications",
    cwd,
    tool_input: {},
    tool_response,
    ...extra,
  });
const note = (res) => res.json?.hookSpecificOutput?.additionalContext ?? "";

test("the orchestrator is told to unsubscribe from a part's PR, as PostToolUse context", () => {
  const { root } = makeOrchestratorRepo();
  const res = read(root, "check_suite.completed");
  assert.equal(res.status, 0);
  assert.equal(res.json.hookSpecificOutput.hookEventName, "PostToolUse");
  assert.equal(
    note(res),
    "The orchestrator watches only part 0's PR. If these events came from a part's PR, call " +
      "`unsubscribe_pr_activity` for it now; CI state comes from implementer reports and review re-checks.",
  );
});

test("PR numbers in the response are named once each, however they are spelled", () => {
  const { root } = makeOrchestratorRepo();
  const response = {
    notifications: [
      { url: "https://github.com/o/r/pull/405#issuecomment-1", body: "preview" },
      { url: "https://github.com/o/r/pull/405", pullNumber: 407 },
      { raw: JSON.stringify({ pull_request: { number: 410 } }) },
      { pull_request: { number: 412 } },
    ],
  };
  assert.match(note(read(root, response)), / Seen here: PR 405, PR 407, PR 410, PR 412\.$/);
});

test("the note stays under 60 words even when many PRs are in the response", () => {
  const { root } = makeOrchestratorRepo();
  const many = Array.from({ length: 30 }, (_, i) => `https://github.com/o/r/pull/${400 + i}`).join(" ");
  const words = note(read(root, many)).split(/\s+/).length;
  assert.ok(words > 20 && words < 60, `${words} words`);
});

// The orchestrator's own transcript: one assistant call carrying `context` tokens.
function transcriptAt(root, context) {
  const file = join(root, "session.jsonl");
  const usage = { input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: context };
  writeFileSync(file, `${JSON.stringify({ type: "assistant", timestamp: new Date().toISOString(), message: { usage } })}\n`);
  return file;
}

test("past 250k of its own context the orchestrator is told to hand off, with the figure", () => {
  const { root } = makeOrchestratorRepo();
  const over = note(read(root, "x", { transcript_path: transcriptAt(root, 251_000) }));
  assert.match(over, / Your context is 251k \(limit 250k\): write the `\/next-prompt` handoff and ask Mitchell to start a fresh session\.$/);
  const under = note(read(root, "x", { transcript_path: transcriptAt(root, 250_000) }));
  assert.doesNotMatch(under, /Your context/);
});

test("a subagent's read adds nothing", () => {
  const { root } = makeOrchestratorRepo();
  const res = read(root, "x", { agent_id: "a1", agent_type: "phase-implementer" });
  assert.equal(res.status, 0);
  assert.equal(res.stdout, "");
});

test("a session without the orchestrator marker adds nothing", () => {
  const { root, marker } = makeOrchestratorRepo();
  rmSync(marker);
  const res = read(root, "x");
  assert.equal(res.status, 0);
  assert.equal(res.stdout, "");
});

test("garbage stdin fails open and a missing response still notes", () => {
  const raw = runHookRaw(HOOK, "{not json");
  assert.equal(raw.status, 0);
  assert.equal(raw.stdout, "");
  assert.equal(raw.stderr, "");
  const { root } = makeOrchestratorRepo();
  assert.match(note(read(root, undefined)), /^The orchestrator watches only part 0's PR\./);
});

test("a note appends one guard-log line in the contract's shape; silence appends none", () => {
  const { root, guardLog } = makeOrchestratorRepo();
  read(root, "x", { agent_id: "a1" });
  assert.equal(existsSync(guardLog), false);
  read(root, "x");
  const lines = readFileSync(guardLog, "utf8").trim().split("\n");
  assert.equal(lines.length, 1);
  const line = JSON.parse(lines[0]);
  assert.deepEqual(Object.keys(line), ["t", "hook", "decision"]);
  assert.equal(line.hook, "notification-unsubscribe-nudge");
  assert.equal(line.decision, "note");
});
