import { test } from "node:test";
import assert from "node:assert/strict";
import { runHook } from "./fixture.mjs";

const GOOD = `- **Pushed:** claude/m41-part2-drawer-is-cards, 6c92e9a, PR 401
- **Red first:**

| edit | failure |
|---|---|
| dropped the card key | expected 3 cards, got 0 |

- **Checks run:** eslint, vitest (1 file) — passed
- **Judgement calls:** none
- **Left:** none
- **Closed:** this agent takes no follow-ups; unsubscribe from PR 401`;

const run = (payload) =>
  runHook("implementer-report-check.mjs", {
    hook_event_name: "SubagentStop",
    stop_hook_active: false,
    agent_type: "phase-implementer",
    ...payload,
  });

test("a report missing the sha or the red-first table blocks the stop", () => {
  for (const text of [
    GOOD.replace("6c92e9a, ", ""),
    GOOD.replace("**Red first:**", "**Tests:**"),
  ]) {
    const res = run({ last_assistant_message: text });
    assert.equal(res.status, 2);
    assert.match(res.stderr, /^finish: report the pushed sha and the red-first table \(edit → failure text\)/);
  }
});

test("a report with no Closed line blocks the stop and says what the line is for", () => {
  for (const text of [GOOD.replace(/\n- \*\*Closed:.*/, ""), GOOD.replace("**Closed:**", "This agent is closed:")]) {
    const res = run({ last_assistant_message: text });
    assert.equal(res.status, 2, text);
    assert.match(
      res.stderr,
      /a `Closed:` line: this agent takes no follow-ups; the orchestrator unsubscribes from PR <n>\. Missing: a `Closed:` line\.$/m,
    );
  }
  assert.match(run({ last_assistant_message: "done" }).stderr, /Missing: the pushed sha, a Red first table, a `Closed:` line\./);
});

test("a complete report, a retry, another agent type or no agent type passes", () => {
  const bad = GOOD.replace("6c92e9a, ", "");
  assert.equal(run({ last_assistant_message: GOOD }).status, 0);
  assert.equal(run({ last_assistant_message: `Pushed ${"a".repeat(40)}\n## Red first\nx\nClosed: yes` }).status, 0);
  assert.equal(run({ last_assistant_message: bad, stop_hook_active: true }).status, 0);
  assert.equal(run({ last_assistant_message: bad, agent_type: "part-reviewer" }).status, 0);
  assert.equal(run({ last_assistant_message: bad, agent_type: undefined }).status, 0);
  assert.equal(run({ last_assistant_message: `## Exit: BLOCKED\n${bad}` }).status, 0);
});

test("a long run of blank lines or asterisks is read in linear time", () => {
  // `^[\s#>*-]*\**red` overlapped `*` in both parts and let `\s` span lines,
  // so every line start rescanned the rest of the report.
  for (const filler of ["\n".repeat(60000), "*".repeat(60000)]) {
    const started = Date.now();
    const payload = {
      hook_event_name: "SubagentStop",
      stop_hook_active: false,
      agent_type: "phase-implementer",
      last_assistant_message: `${filler}\n${GOOD}`,
    };
    const res = runHook("implementer-report-check.mjs", payload, { timeout: 10000 });
    assert.equal(res.signal, null, "was killed");
    assert.equal(res.status, 0);
    assert.ok(Date.now() - started < 2000, `took ${Date.now() - started}ms`);
  }
});
