import { test } from "node:test";
import assert from "node:assert/strict";
import { runHook } from "./fixture.mjs";

const CREATE = "mcp__github__create_pull_request";
const UPDATE = "mcp__github__update_pull_request";
const BODY =
  "## Summary\n\nx\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)\n\n" +
  "https://claude.ai/code/session_01GgJXTL8yQerp6fidYaYqWV";

const run = (tool_name, tool_input) => runHook("pr-tool-guard.mjs", { tool_name, tool_input });

test("creating a draft PR blocks", () => {
  const res = run(CREATE, { title: "feat: x", body: BODY, draft: true, base: "main", head: "b" });
  assert.equal(res.status, 2);
  assert.match(res.stderr, /ready for review, never draft/);
});

test("a model id in the title or body blocks, on create and update", () => {
  for (const [tool, input] of [
    [CREATE, { title: "feat: x (claude-opus-5-5)", body: BODY }],
    [UPDATE, { pullNumber: 3, body: `${BODY}\nModel: claude-sonnet-4-6` }],
  ]) {
    const res = run(tool, input);
    assert.equal(res.status, 2, JSON.stringify(input));
    assert.match(res.stderr, /contains a model id/);
  }
});

test("a ready PR with the standard attribution passes, and update may set draft", () => {
  assert.equal(run(CREATE, { title: "feat: x", body: BODY, draft: false }).status, 0);
  assert.equal(run(CREATE, { title: "feat: x", body: BODY }).status, 0);
  assert.equal(run(CREATE, { title: "M42 part 0: decisions and gate", body: BODY, draft: true }).status, 0);
  const res = run(UPDATE, { pullNumber: 3, title: "feat: y", draft: true });
  assert.equal(res.status, 0);
  assert.equal(res.stderr, "");
});
