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

import { verifyStamp } from "../tier3-stamp.mjs";

const HOOK = new URL("../hooks/draft-pr-guard.mjs", import.meta.url).pathname;

function hook(command) {
  const out = execFileSync(process.execPath, [HOOK], {
    input: JSON.stringify({ tool_input: { command } }),
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
});

test("it fires through a compound command and past gh's global flags", () => {
  assert.equal(hook("git push && gh pr create --title x")?.permissionDecision, "ask");
  assert.equal(hook("gh --repo o/r pr create --title x")?.permissionDecision, "ask");
});

// --- it must NOT fire --------------------------------------------------------

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
