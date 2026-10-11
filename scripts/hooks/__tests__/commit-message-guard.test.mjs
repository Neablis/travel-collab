import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runHook } from "./fixture.mjs";

const TRAILERS =
  "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\n" +
  "Claude-Session: https://claude.ai/code/session_01GgJXTL8yQerp6fidYaYqWV";

const run = (command, cwd) => runHook("commit-message-guard.mjs", { tool_input: { command }, cwd });

test("a model id in -m or a heredoc message blocks, naming the id", () => {
  for (const command of [
    "git commit -m 'feat: x (claude-opus-5-5)'",
    `git commit -m "$(cat <<'EOF'\nfeat: x\n\nWritten by claude-sonnet-4-6\n\n${TRAILERS}\nEOF\n)"`,
    "git -C . commit -q -m 'fix: y, claude-3-5-sonnet'",
  ]) {
    const res = run(command);
    assert.equal(res.status, 2, command);
    assert.match(res.stderr, /contains a model id \("claude-/, command);
  }
});

test("a model id in an -F message file blocks", () => {
  const dir = mkdtempSync(join(tmpdir(), "tc-commit-msg-"));
  writeFileSync(join(dir, "msg.txt"), "feat: x\n\nby claude-haiku-4-5\n");
  const res = run("git commit -F msg.txt", dir);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /claude-haiku-4-5/);
});

test("the required trailers, claude-code and non-commit commands pass", () => {
  for (const command of [
    `git commit -m "$(cat <<'EOF'\nfeat(hooks): x\n\nSee claude-code docs.\n\n${TRAILERS}\nEOF\n)"`,
    "git commit -m 'docs: trailer is Claude Opus 5.5, never hyphenated'",
    "grep -rn claude-opus-5 docs/",
    "git log --grep claude-opus-5",
  ]) {
    const res = run(command);
    assert.equal(res.status, 0, `${command}\n${res.stderr}`);
    assert.equal(res.stderr, "");
  }
});

test("naming git commit without running it passes", () => {
  assert.equal(run("echo 'git commit -m claude-opus-5-5'").status, 0);
});
