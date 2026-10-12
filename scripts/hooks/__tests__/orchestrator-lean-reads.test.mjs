import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { makeOrchestratorRepo, runHook, runHookRaw } from "./fixture.mjs";

const HOOK = "orchestrator-lean-reads.mjs";
const bash = (cwd, command, extra = {}) =>
  runHook(HOOK, { hook_event_name: "PreToolUse", tool_name: "Bash", cwd, tool_input: { command }, ...extra });
const jobLogs = (cwd, extra = {}) =>
  runHook(HOOK, {
    hook_event_name: "PreToolUse",
    tool_name: "mcp__github__get_job_logs",
    cwd,
    tool_input: { owner: "o", repo: "r", run_id: 1, failed_only: true },
    ...extra,
  });

test("the orchestrator's get_job_logs is denied and pointed at ci-triage and get_check_runs", () => {
  const { root } = makeOrchestratorRepo();
  const res = jobLogs(root);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /does not read CI logs \(get_job_logs\)/);
  assert.match(res.stderr, /subagent with the `ci-triage` skill and ask for the root cause in under 200 words/);
  assert.match(res.stderr, /one `pull_request_read get_check_runs` call/);
});

test("the orchestrator's `gh run view` with a log flag is denied, wherever it sits in the command", () => {
  const { root } = makeOrchestratorRepo();
  for (const command of [
    "gh run view 38184850349 --log-failed",
    "gh run view --log 38184850349 | tail -200",
    "cd apps/web && gh run view 1 --job 2 --log-failed 2>&1",
    "/opt/homebrew/bin/gh -R o/r run view 1 --log",
  ]) {
    const res = bash(root, command);
    assert.equal(res.status, 2, command);
    assert.match(res.stderr, /does not read CI logs \(`gh run view --log`\)/, command);
  }
});

test("a run's job list, other gh calls, and the words inside a quoted string pass", () => {
  const { root } = makeOrchestratorRepo();
  for (const command of [
    "gh run view 38184850349",
    "gh run list --limit 5",
    "gh pr view 404 --json statusCheckRollup",
    "git commit -m 'never gh run view --log in the orchestrator'",
    "git log --oneline",
  ]) {
    const res = bash(root, command);
    assert.equal(res.status, 0, command);
    assert.equal(res.stderr, "", command);
  }
  assert.equal(runHook(HOOK, { tool_name: "mcp__github__pull_request_read", cwd: root, tool_input: {} }).status, 0);
});

test("a subagent (the ci-triage agent) reads logs either way", () => {
  const { root } = makeOrchestratorRepo();
  const sub = { agent_id: "a1", agent_type: "general-purpose" };
  assert.equal(jobLogs(root, sub).status, 0);
  assert.equal(bash(root, "gh run view 1 --log-failed", sub).status, 0);
});

test("a session without the orchestrator marker reads logs either way", () => {
  const { root, marker } = makeOrchestratorRepo();
  rmSync(marker);
  assert.equal(jobLogs(root).status, 0);
  assert.equal(bash(root, "gh run view 1 --log-failed").status, 0);
});

test("garbage stdin fails open", () => {
  const res = runHookRaw(HOOK, "{not json");
  assert.equal(res.status, 0);
  assert.equal(res.stderr, "");
});

test("each denial appends a guard-log line in the contract's shape", () => {
  const { root, guardLog } = makeOrchestratorRepo();
  jobLogs(root);
  bash(root, "gh run view 1 --log");
  bash(root, "gh run view 1");
  const lines = readFileSync(guardLog, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(lines.length, 2);
  for (const line of lines) {
    assert.deepEqual(Object.keys(line), ["t", "hook", "decision"]);
    assert.equal(line.hook, "orchestrator-lean-reads");
    assert.equal(line.decision, "deny");
  }
});
