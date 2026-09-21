#!/usr/bin/env node
// The Tier-3 stamp: what verification actually ran, for which commit.
//
//   node scripts/tier3-stamp.mjs record    (the last step of `pnpm check`)
//   node scripts/tier3-stamp.mjs verify    (what the draft-PR guard reads)
//
// WHY A STAMP AND NOT A CHECKBOX
//
// AGENTS.md's Definition of Done says Tier 3 — the single full-suite run a
// branch pays for — happens once, when the branch leaves draft. It is
// recorded by the author ticking a PR template box. docs/reviews/
// 2026-09-21-development-loop-review.md measured what that buys: over five
// days, 11 of 15 branches opened READY rather than draft, and PR #196's first
// CI run fired three seconds after the PR opened and failed on `test:int` — a
// lane that runs here in about seventy seconds. 41 runs and 15 hours followed.
//
// A box you tick is a claim. A stamp is a record.
//
// WHY IT RECORDS THE LANES AND NOT JUST "PASSED"
//
// This is the part a laptop-shaped design gets wrong. In a cloud container the
// local lane is CONDITIONALLY available, and four open known issues are each a
// session finding that out mid-task: KI-2026-09-08-b (`pnpm --filter` aborts
// on a pnpm-major skew), KI-2026-09-12-b (a worktree with no node_modules),
// KI-2026-09-02-a (Node 26 breaks the jsdom unit lane), KI-49 (the egress
// proxy blocks the map tile host).
//
// `pnpm check` ends in `test:int:if-db`, which SKIPS SILENTLY when no database
// answers — and prints, in its own words, "A green `pnpm check` here is NOT a
// green CI". So a stamp saying only "check passed" would assert exactly the
// thing that was not verified. It records which lanes were live, and `verify`
// says plainly which ones were not.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();

function git(args) {
  return execFileSync("git", args, {
    cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 10000,
  }).trim();
}

/** The stamp lives in .git/, so it is per-clone and never committed. */
export function stampPath(base = root) {
  let gitDir;
  try {
    gitDir = execFileSync("git", ["rev-parse", "--git-dir"], {
      cwd: base, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
  // resolve(), not join(): in a LINKED WORKTREE `git rev-parse --git-dir`
  // returns an ABSOLUTE path (/repo/.git/worktrees/<name>), and join() would
  // still prefix `base`, producing /worktree/repo/.git/worktrees/<name>/… —
  // a path that does not exist, so record() fails with ENOENT and the guard
  // reads a stamp that is never there. Reproduced 2026-09-21 in a real linked
  // worktree; this repo runs subagents in them by design. CodeRabbit, PR #199.
  return resolve(base, gitDir, "tc-tier3.json");
}

export function readStamp(base = root) {
  const p = stampPath(base);
  if (!p || !existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Does the stamp cover this commit, and what did it NOT cover?
 *
 * `ok` means only "a full check ran on this exact tree". Blocked lanes are
 * returned separately and are never folded into `ok`: the point is to say
 * what was not proven, not to withhold the PR.
 */
export function verifyStamp(headSha, stamp) {
  if (!stamp) return { ok: false, reason: "no Tier-3 stamp — `pnpm check` has not run in this clone" };
  if (stamp.sha !== headSha) {
    return {
      ok: false,
      reason:
        `the Tier-3 stamp is for ${stamp.sha?.slice(0, 10)}, HEAD is ${headSha.slice(0, 10)} — ` +
        `code changed since the last full check`,
      stamp,
    };
  }
  const blocked = Object.entries(stamp.lanes ?? {})
    .filter(([, v]) => v.status === "BLOCKED")
    .map(([k, v]) => `${k} (${v.note})`);
  return { ok: true, blocked, stamp };
}

async function record() {
  const { collectLanes } = await import("./lane-probe.mjs");
  const lanes = Object.fromEntries(
    collectLanes().map(([name, v]) => [name, { status: v.status, note: v.note, ki: v.ki ?? null }]),
  );
  const stamp = {
    schema: 1,
    sha: git(["rev-parse", "HEAD"]),
    branch: git(["rev-parse", "--abbrev-ref", "HEAD"]),
    at: new Date().toISOString(),
    // The tree must be clean, or the stamp describes a commit that is not what
    // was checked. An uncommitted edit after `pnpm check` is exactly the case
    // that makes a green check a lie about the pushed head.
    dirty: git(["status", "--porcelain"]).length > 0,
    lanes,
  };
  const p = stampPath();
  if (!p) {
    console.error("tier3-stamp: not a git repo; nothing recorded.");
    return;
  }
  writeFileSync(p, JSON.stringify(stamp, null, 2));
  const blocked = Object.entries(lanes).filter(([, v]) => v.status === "BLOCKED");
  console.log(`tier3 stamp recorded for ${stamp.sha.slice(0, 10)}${stamp.dirty ? " (TREE DIRTY)" : ""}`);
  for (const [name, v] of blocked) {
    console.log(`  lane NOT covered: ${name} — ${v.note}`);
  }
}

function verify() {
  const head = git(["rev-parse", "HEAD"]);
  const res = verifyStamp(head, readStamp());
  if (!res.ok) {
    console.error(`tier3: ${res.reason}`);
    process.exit(1);
  }
  console.log(`tier3 stamp OK for ${head.slice(0, 10)}`);
  for (const b of res.blocked ?? []) console.log(`  not covered: ${b}`);
  if (res.stamp?.dirty) console.log("  NOTE: the tree was dirty when stamped");
}

function main() {
  const cmd = process.argv[2];
  if (cmd === "record") return record();
  if (cmd === "verify") return verify();
  console.error("usage: node scripts/tier3-stamp.mjs record|verify");
  process.exit(1);
}

// pathToFileURL, not string interpolation: on Windows, or when the path holds
// a space or a URL-reserved character, `file://${argv[1]}` never equals
// import.meta.url, main() is skipped and the script exits 0 having done
// NOTHING. For surface-size that means `pnpm surface --check` — a lint wall —
// passing silently, which is the exact silent-success class this branch spent
// its time hunting. CodeRabbit, PR #199.
// The argv[1] guard is not decoration: pathToFileURL(undefined) THROWS, so
// without it merely IMPORTING this module (as the tests do, and as
// `node -e "import(...)"` does) crashes before any export is reachable.
// Found by running it immediately after applying the fix above.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
