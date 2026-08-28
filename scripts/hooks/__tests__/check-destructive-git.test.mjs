import { test } from "node:test";
import assert from "node:assert/strict";
import { decision, makeLinkedWorktree, makeLooseDir, makeRepo, runHook } from "./fixture.mjs";

// The hook only speaks up when a sibling worktree exists, so every command
// case needs a repo that has one. Built once and shared: `git worktree add`
// costs a commit and a checkout, and these cases differ only in the string.
let shared;
function twoWorktreeRepo() {
  if (!shared) {
    shared = makeRepo();
    makeLinkedWorktree(shared);
  }
  return shared;
}

function verdict(command, cwd = twoWorktreeRepo()) {
  return decision(runHook("check-destructive-git.mjs", { tool_input: { command } }, { cwd }));
}

// Every one of these moves a branch tip, which is the entire incident class
// (AGENTS.md ~138-143). The four marked below walked straight through the
// original pattern: it required `--hard`/`--soft` on a reset and a force flag
// sitting immediately after `push`, and knew nothing about `--amend`.
const TIP_MOVING = [
  "git reset --hard origin/main",
  "git reset --soft HEAD~1",
  "git reset --mixed HEAD~1", // was missed
  "git reset HEAD~1", // was missed
  "git reset HEAD^",
  "git reset ORIG_HEAD",
  "git reset 1a2b3c4d5e6f",
  'git reset "HEAD@{1}"',
  "git rebase -i main",
  "git commit --amend --no-edit", // was missed
  "git commit -a --amend", // was missed
  "git push --force",
  "git push -f origin main",
  "git push origin --force", // was missed
  "git push origin main --force-with-lease",
];

for (const command of TIP_MOVING) {
  test(`asks before \`${command}\``, () => {
    assert.equal(verdict(command), "ask");
  });
}

// The counterweight, and the reason the reset arm looks for a commit-ish
// rather than just `git reset`: a hook that asks about everything gets
// clicked through, and then it guards nothing. None of these move a tip.
const HARMLESS = [
  "git status",
  "git log --oneline -5",
  "git reset", // unstages everything; the tip does not move
  "git reset -- apps/web/src/app/page.tsx",
  "git reset HEAD -- apps/web/src/app/page.tsx",
  "git push origin claude/my-branch",
  "git push -u origin claude/my-branch",
  "git push --follow-tags origin main",
  'git commit -m "fix: leave the tip alone"',
  "git diff --name-only main...HEAD",
  "pnpm --filter web test",
];

for (const command of HARMLESS) {
  test(`lets \`${command}\` through`, () => {
    assert.equal(verdict(command), null);
  });
}

test("the reason names the command and the worktree count", () => {
  const res = runHook(
    "check-destructive-git.mjs",
    { tool_input: { command: "git reset HEAD~1" } },
    { cwd: twoWorktreeRepo() },
  );
  const reason = res.json.hookSpecificOutput.permissionDecisionReason;
  assert.match(reason, /git reset HEAD~1/);
  assert.match(reason, /2 git worktrees/);
});

test("stays silent when this checkout is the only worktree", () => {
  assert.equal(verdict("git reset --hard origin/main", makeRepo()), null);
});

test("fails open outside a git repo", () => {
  assert.equal(verdict("git push --force", makeLooseDir()), null);
});
