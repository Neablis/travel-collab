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
- **Left:** none`;

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

test("a complete report, a retry, another agent type or no agent type passes", () => {
  const bad = GOOD.replace("6c92e9a, ", "");
  assert.equal(run({ last_assistant_message: GOOD }).status, 0);
  assert.equal(run({ last_assistant_message: `Pushed ${"a".repeat(40)}\n## Red first\nx` }).status, 0);
  assert.equal(run({ last_assistant_message: bad, stop_hook_active: true }).status, 0);
  assert.equal(run({ last_assistant_message: bad, agent_type: "part-reviewer" }).status, 0);
  assert.equal(run({ last_assistant_message: bad, agent_type: undefined }).status, 0);
  assert.equal(run({ last_assistant_message: `## Exit: BLOCKED\n${bad}` }).status, 0);
});
