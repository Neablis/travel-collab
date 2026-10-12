import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeOrchestratorRepo, runHook, runHookRaw } from "./fixture.mjs";

const HOOK = "closed-agent-guard.mjs";

// A session transcript with one subagent whose last call was `ageSeconds` ago
// and carried `context` tokens, split over the three usage fields the way the
// API reports them.
function session(root, { id = "a1b2c3", ageSeconds = 20, context = 60_000 } = {}) {
  const transcript = join(root, "sess.jsonl");
  mkdirSync(join(root, "sess", "subagents"), { recursive: true });
  const at = (s) => new Date(Date.now() - s * 1000).toISOString();
  const records = [
    { type: "assistant", timestamp: at(ageSeconds + 600), message: { usage: { input_tokens: 5, cache_read_input_tokens: 999_000 } } },
    { type: "user", timestamp: at(ageSeconds + 30), message: { content: "go" } },
    {
      type: "assistant",
      timestamp: at(ageSeconds + 1),
      message: { usage: { input_tokens: 1000, cache_creation_input_tokens: 4000, cache_read_input_tokens: context - 5000 } },
    },
    { type: "user", timestamp: at(ageSeconds), message: { content: "tool result" } },
  ];
  writeFileSync(join(root, "sess", "subagents", `agent-${id}.jsonl`), `${records.map((r) => JSON.stringify(r)).join("\n")}\n`);
  return transcript;
}

const send = (root, transcript_path, extra = {}) =>
  runHook(HOOK, {
    hook_event_name: "PreToolUse",
    tool_name: "SendMessage",
    cwd: root,
    transcript_path,
    tool_input: { to: "a1b2c3", message: "one more thing" },
    ...extra,
  });

test("a message to an agent idle past the cache TTL is denied, with the idle minutes and what to do", () => {
  const { root } = makeOrchestratorRepo();
  const res = send(root, session(root, { ageSeconds: 600, context: 60_000 }));
  assert.equal(res.status, 2);
  assert.match(res.stderr, /idle 10\.0 min, context at its last call 60k tokens/);
  assert.match(res.stderr, /prompt cache has expired/);
  assert.doesNotMatch(res.stderr, /would re-read/);
  assert.match(res.stderr, /Dispatch a NEW agent of the same type with a brief/);
  assert.match(res.stderr, /branch, its head sha, the findings or asks verbatim, the files, and what done means/);
});

test("a message to a deep agent is denied even when it is warm, with its context in k", () => {
  const { root } = makeOrchestratorRepo();
  const res = send(root, session(root, { ageSeconds: 20, context: 151_000 }));
  assert.equal(res.status, 2);
  assert.match(res.stderr, /idle 0\.3 min, context at its last call 151k tokens/);
  assert.match(res.stderr, /would re-read that context \(limit 150k\)/);
  assert.doesNotMatch(res.stderr, /prompt cache has expired/);
});

test("a warm, small agent still takes a message: just inside both limits", () => {
  const { root } = makeOrchestratorRepo();
  const res = send(root, session(root, { ageSeconds: 240, context: 150_000 }));
  assert.equal(res.status, 0);
  assert.equal(res.stderr, "");
});

test("a subagent's own SendMessage passes", () => {
  const { root } = makeOrchestratorRepo();
  const transcript = session(root, { ageSeconds: 600, context: 400_000 });
  assert.equal(send(root, transcript, { agent_id: "zz", agent_type: "phase-implementer" }).status, 0);
});

test("a session without the orchestrator marker passes", () => {
  const { root, marker } = makeOrchestratorRepo();
  const transcript = session(root, { ageSeconds: 600, context: 400_000 });
  rmSync(marker);
  assert.equal(send(root, transcript).status, 0);
});

test("a `to` that is a name, has no transcript, or is not one path segment passes", () => {
  const { root } = makeOrchestratorRepo();
  const transcript = session(root, { ageSeconds: 600, context: 400_000 });
  for (const to of ["part-4-builder", "ffff00", "x/../agent-a1b2c3", "", undefined, 7]) {
    const res = send(root, transcript, { tool_input: { to } });
    assert.equal(res.status, 0, String(to));
    assert.equal(res.stderr, "", String(to));
  }
  assert.equal(send(root, undefined).status, 0);
});

test("the `agent-` prefix on an id resolves to the same transcript", () => {
  const { root } = makeOrchestratorRepo();
  const res = send(root, session(root, { ageSeconds: 600 }), { tool_input: { to: "agent-a1b2c3" } });
  assert.equal(res.status, 2);
});

test("garbage stdin and an unparseable transcript fail open", () => {
  const { root } = makeOrchestratorRepo();
  const res = runHookRaw(HOOK, "{not json");
  assert.equal(res.status, 0);
  assert.equal(res.stderr, "");
  const transcript = session(root);
  writeFileSync(join(root, "sess", "subagents", "agent-a1b2c3.jsonl"), "not json\n{\"timestamp\":\"never\"}\n");
  assert.equal(send(root, transcript).status, 0);
});

test("a denial appends one guard-log line in the contract's shape; an allow appends none", () => {
  const { root, guardLog } = makeOrchestratorRepo();
  assert.equal(send(root, session(root, { ageSeconds: 20, context: 60_000 })).status, 0);
  assert.equal(existsSync(guardLog), false);
  assert.equal(send(root, session(root, { ageSeconds: 600 })).status, 2);
  const lines = readFileSync(guardLog, "utf8").trim().split("\n");
  assert.equal(lines.length, 1);
  const line = JSON.parse(lines[0]);
  assert.deepEqual(Object.keys(line), ["t", "hook", "decision"]);
  assert.equal(line.hook, "closed-agent-guard");
  assert.equal(line.decision, "deny");
  assert.equal(new Date(line.t).toISOString(), line.t);
});
