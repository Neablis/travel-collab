// Tests for scripts/hooks/draft-pr-guard.mjs and scripts/tier3-stamp.mjs.
//
// Two failure modes matter, in opposite directions:
//
//   - Not firing when it should. The rule it enforces was already written in
//     AGENTS.md and followed on 4 of 15 branches; a guard that misses the
//     common spelling is the same as no guard.
//   - Firing when it should not. The repo's standing rule is that a hook
//     firing on something a person legitimately chose gets trained away,
//     after which it enforces nothing.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { verifyStamp } from "../tier3-stamp.mjs";

const HOOK = new URL("../hooks/draft-pr-guard.mjs", import.meta.url).pathname;

// Not a git repo, so no branch: the hook's answer must not depend on which
// branch the test runner happens to be on (a part branch steps the ask aside).
const NO_BRANCH = realpathSync(mkdtempSync(join(tmpdir(), "tc-draft-guard-")));

function repoOn(branch) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "tc-draft-guard-repo-")));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["checkout", "-q", "-b", branch], { cwd: dir });
  return dir;
}

function hook(command, cwd = NO_BRANCH) {
  const out = execFileSync(process.execPath, [HOOK], {
    input: JSON.stringify({ tool_input: { command }, cwd }),
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
  if (!out) return null;
  return JSON.parse(out).hookSpecificOutput;
}

// --- it must fire ------------------------------------------------------------

test("gh pr create without --draft asks, and says why", () => {
  const r = hook("gh pr create --title 'x' --body 'y'");
  assert.equal(r.permissionDecision, "ask");
  assert.match(r.permissionDecisionReason, /open that PR as a draft/);
  // The number is what makes it an argument rather than a preference.
  assert.match(r.permissionDecisionReason, /41 CI runs/);
  // `pnpm check` is denied locally (check-test-lane.mjs); prescribing it was a dead end.
  assert.doesNotMatch(r.permissionDecisionReason, /pnpm check/);
  assert.match(r.permissionDecisionReason, /CI on the PR runs the full suite/);
});

test("it fires through a compound command and past gh's global flags", () => {
  assert.equal(hook("git push && gh pr create --title x")?.permissionDecision, "ask");
  assert.equal(hook("gh --repo o/r pr create --title x")?.permissionDecision, "ask");
});

test("a milestone part branch may not open a draft, whether named by --head or checked out", () => {
  for (const [command, cwd] of [
    ["gh pr create --draft --head claude/m42-part1-trip-cards --title x", NO_BRANCH],
    ["gh pr create --head=claude/m42-part1-trip-cards -d --title x", NO_BRANCH],
    ["gh pr create --draft --title x", repoOn("claude/m42-part2-drawer")],
  ]) {
    const r = hook(command, cwd);
    assert.equal(r?.permissionDecision, "deny", command);
    assert.match(r.permissionDecisionReason, /open it ready \(build-a-part\)/, command);
  }
});

test("a model id in a gh PR title, body or body file is denied", () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "tc-draft-guard-body-")));
  writeFileSync(join(dir, "body.md"), "## Summary\n\nRan on claude-haiku-4-5.\n");
  for (const [command, cwd] of [
    ["gh pr create --draft --title 'feat: x (claude-opus-5-5)' --body y", NO_BRANCH],
    ["gh pr edit 3 --body \"$(cat <<'EOF'\n## Summary\n\nModel: claude-sonnet-4-6\nEOF\n)\"", NO_BRANCH],
    ["gh pr create --draft --title x --body-file body.md", dir],
    ["gh pr create --draft --title x -F - <<'EOF'\nby claude-opus-5-5\nEOF", NO_BRANCH],
  ]) {
    const r = hook(command, cwd);
    assert.equal(r?.permissionDecision, "deny", command);
    assert.match(r.permissionDecisionReason, /contains a model id \("claude-/, command);
  }
});

// --- it must NOT fire --------------------------------------------------------

test("a milestone part branch opens ready with no ask; part 0's branch keeps the old rules", () => {
  assert.equal(hook("gh pr create --head claude/m42-part1-trip-cards --title x --body y"), null);
  assert.equal(hook("gh pr create --title x --body y", repoOn("claude/m42-part3-palette")), null);
  // Part 0 lives on the session's branch, and `part0` is not a part branch.
  for (const branch of ["claude/build-a-milestone-abc", "claude/m42-part0-gate"]) {
    assert.equal(hook("gh pr create --draft --title x", repoOn(branch)), null, branch);
    assert.equal(hook("gh pr create --title x", repoOn(branch))?.permissionDecision, "ask", branch);
  }
});

test("the standard attribution and claude-code in a PR body pass", () => {
  const body =
    "## Summary\n\nSee claude-code docs.\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)";
  assert.equal(hook(`gh pr create --draft --title 'feat: x' --body '${body}'`), null);
  assert.equal(hook("gh pr edit 3 --title 'docs: trailer names Claude Opus 5.5'"), null);
});

test("--draft in any accepted spelling is silent", () => {
  assert.equal(hook("gh pr create --draft --title x"), null);
  assert.equal(hook("gh pr create --title x --draft"), null);
  assert.equal(hook("gh pr create -d --title x"), null);
});

test("unrelated gh and git commands are silent", () => {
  for (const c of [
    "gh pr list",
    "gh pr view 12",
    "gh pr checks 12 --watch",
    "git commit -m 'gh pr create'",
    "echo 'gh pr ready'",
  ]) {
    assert.equal(hook(c), null, c);
  }
});

test("a malformed payload or empty command is silent", () => {
  const out = execFileSync(process.execPath, [HOOK], {
    input: "not json at all", encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  }).trim();
  assert.equal(out, "", "a parse failure must fail open");
  assert.equal(hook(""), null);
});

// --- the stamp ---------------------------------------------------------------

test("no stamp, or a stamp for another commit, is not ok", () => {
  assert.equal(verifyStamp("abc123", null).ok, false);
  assert.match(verifyStamp("abc123", null).reason, /has not run in this clone/);

  const stale = verifyStamp("a".repeat(40), { sha: "b".repeat(40), lanes: {} });
  assert.equal(stale.ok, false);
  assert.match(stale.reason, /code changed since the last full check/);
});

test("a matching stamp is ok, and BLOCKED lanes are reported separately", () => {
  // This is the cloud-shaped case the whole design turns on: `pnpm check`
  // skips test:int SILENTLY with no database, so "ok" must never be read as
  // "everything was verified".
  const sha = "c".repeat(40);
  const res = verifyStamp(sha, {
    sha,
    lanes: {
      database: { status: "BLOCKED", note: "no database answered DATABASE_URL" },
      "pnpm --filter": { status: "OK", note: "fine" },
      egress: { status: "UNKNOWN", note: "not probed" },
    },
  });
  assert.equal(res.ok, true, "a blocked lane must not withhold the PR");
  assert.equal(res.blocked.length, 1, "only BLOCKED counts — UNKNOWN is not a failure");
  assert.match(res.blocked[0], /database/);
});

test("a stamp with every lane OK reports nothing not covered", () => {
  const sha = "d".repeat(40);
  const res = verifyStamp(sha, { sha, lanes: { database: { status: "OK", note: "up" } } });
  assert.equal(res.ok, true);
  assert.deepEqual(res.blocked, []);
});

// --- second-round review (PR 403) ------------------------------------------

test("--draft=false opens ready, so it asks; --draft=true and --draft=1 are drafts", () => {
  assert.equal(hook("gh pr create --draft=false --title x")?.permissionDecision, "ask");
  assert.equal(hook("gh pr create --draft=true --title x"), null);
  assert.equal(hook("gh pr create --draft=1 --title x"), null);
  const part = repoOn("claude/m42-part1-flags");
  assert.equal(hook("gh pr create --draft=true --title x", part)?.permissionDecision, "deny");
  assert.equal(hook("gh pr create --draft=false --title x", part), null);
});

test("gh pr ready passes: CI on the PR is the full-suite verdict, not a local stamp", () => {
  assert.equal(hook("gh pr ready 12"), null);
  assert.equal(hook("gh pr ready"), null);
});

test("a lettered milestone's part branch is a part branch", () => {
  assert.equal(hook("gh pr create --head claude/m48a-part1-x --title x"), null);
  assert.equal(
    hook("gh pr create --draft --head claude/m48a-part1-x --title x")?.permissionDecision,
    "deny",
  );
});

test("a parenthesis inside a quoted string in $(...) does not hide the gh call after it", () => {
  const r = hook('echo $(echo "(" ); gh pr create --draft', repoOn("claude/m42-part1-quotes"));
  assert.equal(r?.permissionDecision, "deny");
  assert.match(r.permissionDecisionReason, /open it ready/);
});
