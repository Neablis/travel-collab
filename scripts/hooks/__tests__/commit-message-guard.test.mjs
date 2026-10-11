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

test("only the commit's own message is scanned", () => {
  for (const command of [
    // A heredoc that writes a file is its body, not a command.
    "cat > notes.md <<'EOF'\ngit commit -m 'route to claude-haiku-4-5'\nEOF",
    // A later command in the same line is not the message.
    'git commit -m "x" && grep -rn "claude-haiku-4-5" apps/',
  ]) {
    const res = run(command);
    assert.equal(res.status, 0, `${command}\n${res.stderr}`);
  }
  // The message still counts when it arrives through `-F -` and a heredoc.
  const res = run("git commit -F - <<'EOF'\nfeat: x\n\nby claude-haiku-4-5\nEOF");
  assert.equal(res.status, 2);
  assert.match(res.stderr, /claude-haiku-4-5/);
});

test("ALLOW_MODEL_ID=1 lets a commit about the product's model routing through", () => {
  const res = run("ALLOW_MODEL_ID=1 git commit -m 'feat(ai): route classification to claude-haiku-4-5'");
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.stderr, "");
  // Only for the segment it prefixes.
  assert.equal(run("ALLOW_MODEL_ID=1 git add . && git commit -m 'x claude-haiku-4-5'").status, 2);
});

test("a pathological run of git options is matched in linear time", () => {
  // `git -C=! -C=! ... x` made the old option matcher backtrack exponentially
  // (CodeQL js/redos); 5000 repeats never finished.
  const opts = " -C=!".repeat(5000);
  for (const [command, status] of [
    [`git${opts} x`, 0],
    [`git${" -- -".repeat(5000)} x`, 0],
    [`git${opts} commit -m claude-opus-5-5`, 2],
  ]) {
    const started = Date.now();
    const res = runHook("commit-message-guard.mjs", { tool_input: { command } }, { timeout: 5000 });
    assert.equal(res.signal, null, `${command.slice(0, 40)}... was killed`);
    assert.equal(res.status, status);
    assert.ok(Date.now() - started < 2000, `took ${Date.now() - started}ms`);
  }
});

test("an unterminated `$(cat <<A` or a run of heredoc openers is read in linear time", () => {
  // lib/shell.mjs matched `$(cat <<A ... A)` with a lazy `[\s\S]*?` before
  // `\n\s*A`, which backtracked quadratically when the closing line never came.
  for (const command of [
    `git commit -m "$(cat <<A\n${"\n".repeat(40000)})"`,
    "<<A\n".repeat(40000),
  ]) {
    const started = Date.now();
    const res = runHook("commit-message-guard.mjs", { tool_input: { command } }, { timeout: 10000 });
    assert.equal(res.signal, null, `${JSON.stringify(command.slice(0, 20))}... was killed`);
    assert.ok(Date.now() - started < 2000, `took ${Date.now() - started}ms`);
  }
});

test("a hyphenated heredoc delimiter is a heredoc: a file write passes, a -F - message blocks", () => {
  const write = run("cat > notes.md <<'END-MSG'\ngit commit -m 'route to claude-haiku-4-5'\nEND-MSG");
  assert.equal(write.status, 0, write.stderr);
  const commit = run("git commit -F - <<'END-MSG'\nfeat: x\n\nby claude-haiku-4-5\nEND-MSG");
  assert.equal(commit.status, 2);
  assert.match(commit.stderr, /claude-haiku-4-5/);
});

test("a shift in $((...)) is not a heredoc that swallows the commit after it", () => {
  const res = run('echo $((1<<2)); git commit -m "claude-opus-5-5"');
  assert.equal(res.status, 2);
  assert.match(res.stderr, /claude-opus-5-5/);
});
