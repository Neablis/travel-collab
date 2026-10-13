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

// Since 2026-10-13 the orchestrator watches no PR at all, part 0's included:
// it reads every PR's state in one `pnpm pr-digest` at a scheduled check-in.
test("the orchestrator is told to unsubscribe from every PR, part 0's too, as PostToolUse context", () => {
  const { root } = makeOrchestratorRepo();
  const res = read(root, "check_suite.completed");
  assert.equal(res.status, 0);
  assert.equal(res.json.hookSpecificOutput.hookEventName, "PostToolUse");
  assert.equal(
    note(res),
    "Call `unsubscribe_pr_activity` for every PR these events came from, part 0's included: PR state " +
      "comes from `pnpm -s pr-digest` at a `send_later` check-in.",
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



// The orchestrator's own transcript: one assistant call carrying `context` tokens.
function transcriptAt(root, context) {
  const file = join(root, "session.jsonl");
  const usage = { input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: context };
  writeFileSync(file, `${JSON.stringify({ type: "assistant", timestamp: new Date().toISOString(), message: { usage } })}\n`);
  return file;
}

test("past 250k of its own context the orchestrator hands off itself with create_session, with the figure", () => {
  const { root } = makeOrchestratorRepo();
  const over = note(read(root, "x", { transcript_path: transcriptAt(root, 251_000) }));
  assert.ok(
    over.endsWith(
      " Context 251k, over 250k: write the `/next-prompt` text, `create_session` with it (source_url " +
        "https://github.com/Neablis/travel-collab, same environment), delete this session's pending " +
        "`send_later` check-ins, re-arm them there.",
    ),
    over,
  );
  assert.doesNotMatch(over, /Mitchell/);
  const under = note(read(root, "x", { transcript_path: transcriptAt(root, 250_000) }));
  assert.doesNotMatch(under, /Your context/);
});

test("the note stays under 60 words with the most PRs it names and the handoff", () => {
  const { root } = makeOrchestratorRepo();
  const many = Array.from({ length: 30 }, (_, i) => `https://github.com/o/r/pull/${400 + i}`).join(" ");
  const text = note(read(root, many, { transcript_path: transcriptAt(root, 900_000) }));
  assert.match(text, /create_session/);
  const words = text.split(/\s+/).length;
  assert.ok(words > 20 && words < 60, `${words} words: ${text}`);
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
  assert.match(note(read(root, undefined)), /^Call `unsubscribe_pr_activity` for every PR/);
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
