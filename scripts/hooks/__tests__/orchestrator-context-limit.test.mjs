import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeOrchestratorRepo, runHook, runHookRaw } from "./fixture.mjs";

const HOOK = "orchestrator-context-limit.mjs";
const note = (res) => res.json?.hookSpecificOutput?.additionalContext ?? "";

// The orchestrator's own transcript: one assistant call carrying `context` tokens.
function transcriptAt(root, context) {
  const file = join(root, "session.jsonl");
  const usage = { input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: context };
  writeFileSync(file, `${JSON.stringify({ type: "assistant", timestamp: new Date().toISOString(), message: { usage } })}\n`);
  return file;
}

// A `send_later` check-in and a subagent's report both reach the session as a prompt.
const prompt = (root, context, extra = {}) =>
  runHook(HOOK, {
    hook_event_name: "UserPromptSubmit",
    cwd: root,
    prompt: "check-in: run pnpm -s pr-digest",
    transcript_path: transcriptAt(root, context),
    ...extra,
  });

const HANDOFF =
  "Context 251k, over 250k. If about 100 calls remain, hand off (building-a-milestone.md, Hand-off) once " +
  "no subagent is running: `session-metrics`, `/next-prompt` with its block, `create_session` with that " +
  "text, delete your `send_later` check-ins, tell Mitchell the new session's id, stop.";

test("past 250k a check-in prompt gets the whole hand-off, every step named, as UserPromptSubmit context", () => {
  const { root } = makeOrchestratorRepo();
  const res = prompt(root, 251_000);
  assert.equal(res.status, 0);
  assert.equal(res.json.hookSpecificOutput.hookEventName, "UserPromptSubmit");
  assert.equal(note(res), HANDOFF);
  assert.ok(note(prompt(root, 900_000)).split(/\s+/).length < 60);
});

test("at or under 250k nothing is added", () => {
  const { root } = makeOrchestratorRepo();
  const res = prompt(root, 250_000);
  assert.equal(res.status, 0);
  assert.equal(res.stdout, "");
});

test("a pr-digest run says it too; another Bash call does not", () => {
  const { root } = makeOrchestratorRepo();
  const bash = (command) =>
    runHook(HOOK, {
      hook_event_name: "PostToolUse",
      tool_name: "Bash",
      tool_input: { command },
      cwd: root,
      transcript_path: transcriptAt(root, 300_000),
    });
  const res = bash("pnpm -s pr-digest");
  assert.equal(res.json.hookSpecificOutput.hookEventName, "PostToolUse");
  assert.match(note(res), /^Context 300k, over 250k\./);
  assert.equal(bash("git status").stdout, "");
});

// The note was once wired only to ReadNotifications, which the orchestrator
// stopped getting when it stopped subscribing. Pin where it is wired.
test("settings.json runs it on every prompt and after Bash", () => {
  const { hooks } = JSON.parse(readFileSync(".claude/settings.json", "utf8"));
  const wired = (event, matcher) =>
    (hooks[event] ?? []).some(
      (g) => (g.matcher ?? "") === matcher && g.hooks.some((h) => h.command.includes(HOOK)),
    );
  assert.ok(wired("UserPromptSubmit", ""), "not on UserPromptSubmit");
  assert.ok(wired("PostToolUse", "Bash"), "not on PostToolUse Bash");
});

test("a subagent, a session without the marker, and garbage stdin add nothing", () => {
  const { root, marker } = makeOrchestratorRepo();
  assert.equal(prompt(root, 900_000, { agent_id: "a1" }).stdout, "");
  rmSync(marker);
  assert.equal(prompt(root, 900_000).stdout, "");
  const raw = runHookRaw(HOOK, "{not json");
  assert.equal(raw.status, 0);
  assert.equal(raw.stdout, "");
  assert.equal(raw.stderr, "");
});

test("a note appends one guard-log line; silence appends none", () => {
  const { root, guardLog } = makeOrchestratorRepo();
  prompt(root, 100_000);
  assert.equal(existsSync(guardLog), false);
  prompt(root, 400_000);
  const lines = readFileSync(guardLog, "utf8").trim().split("\n");
  assert.equal(lines.length, 1);
  assert.equal(JSON.parse(lines[0]).hook, "orchestrator-context-limit");
});
