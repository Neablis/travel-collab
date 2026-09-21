// PreToolUse hook (matcher: Bash). Two asks, both about the same measurement.
//
//   gh pr create   without --draft          -> ask
//   gh pr ready    without a Tier-3 stamp   -> ask
//
// WHY
//
// AGENTS.md already says it: "open that PR as a draft, and mark it ready only
// when you believe it is green." docs/reviews/2026-09-21-development-loop-
// review.md measured the adherence over five days — 4 of 15 branches opened as
// a draft, 11 opened ready. The rule is written down and followed 27% of the
// time, which puts it in the review's most interesting category: documented
// and ignored.
//
// The cost is not CI minutes. This repo went public on 2026-08-31 and its
// runners are free. The cost is the agent's wall clock and tokens: 100 CI runs
// across 15 branches, median 6.6 minutes each, and PR #196 alone took 41 runs
// and 8 failures across 15 hours. Its FIRST run fired three seconds after the
// PR opened — so it was not a draft — and failed on `test:int`, a lane that
// runs locally in about seventy seconds.
//
// WHY "ask" AND NOT "deny"
//
// Matching check-destructive-git.mjs, the repo's other PreToolUse guard. There
// are legitimate reasons to open a PR ready — a one-line prose fix, a revert,
// a PR Mitchell asked for right now. A guard that cannot be overridden gets
// worked around; one that states the cost and steps aside is read. The repo's
// standing rule is that a hook firing on something a person legitimately chose
// is a hook that gets trained away.
//
// FAILS OPEN. Any parse problem, any missing git, any unreadable stamp exits 0.

import { execFileSync } from "node:child_process";

let input = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) input += chunk;

let parsed;
try {
  parsed = JSON.parse(input || "{}");
} catch {
  process.exit(0);
}

const command = String(parsed?.tool_input?.command ?? "");
if (!command) process.exit(0);

// `gh` must be the COMMAND WORD of a segment, not merely a substring. The
// first draft matched `\bgh…pr\s+create` anywhere, so
// `git commit -m 'gh pr create'` fired — a false positive, and this repo's
// standing rule is that a hook firing on something a person legitimately
// chose is a hook that gets trained away.
//
// Splitting on shell separators is imperfect inside quotes, and that is the
// SAFE direction for an advisory guard: a missed ask costs one CI round trip,
// a spurious one costs the guard's credibility.
const SEGMENTS = (cmd) => cmd.split(/[\n;|&]+/);
const GH_CALL = /^\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*gh\b(.*)$/;

function ghArgs(command) {
  const calls = [];
  for (const seg of SEGMENTS(command)) {
    const m = GH_CALL.exec(seg);
    if (m) calls.push(m[1]);
  }
  return calls;
}

const CREATE = /\bpr\s+create\b/;
const READY = /\bpr\s+ready\b/;
const HAS_DRAFT = /(^|\s)(--draft|-d)(\s|=|$)/;

function ask(reason) {
  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "ask",
        permissionDecisionReason: reason,
      },
    }),
  );
  process.exit(0);
}

const calls = ghArgs(command);

if (calls.some((a) => CREATE.test(a) && !HAS_DRAFT.test(a))) {
  ask(
    "This opens a PR ready rather than as a draft. AGENTS.md: \"open that PR as a " +
      "draft, and mark it ready only when you believe it is green.\" Measured over " +
      "2026-09-15..20: 11 of 15 branches opened ready, and PR #196 — opened ready — " +
      "spent 41 CI runs and 8 failures across 15 hours, its first run failing three " +
      "seconds in on `test:int`, a lane that runs locally in ~70s. " +
      "Add --draft, then `pnpm check` and `gh pr ready <n>`. " +
      "Override deliberately for a prose fix, a revert, or a PR asked for right now.",
  );
}

if (calls.some((a) => READY.test(a))) {
  let head;
  try {
    head = execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 10000,
    }).trim();
  } catch {
    process.exit(0); // no git, no opinion
  }

  let verify;
  try {
    const mod = await import("../tier3-stamp.mjs");
    verify = mod.verifyStamp(head, mod.readStamp());
  } catch {
    process.exit(0); // the stamp module is advisory; never block on its absence
  }

  if (!verify.ok) {
    ask(
      `Marking this PR ready, but ${verify.reason}. Tier 3 is the single ` +
        "full-suite run a branch pays for, and it is what `ready_for_review` tells CI " +
        "to start paying attention to. Run `pnpm check` first — it records the stamp — " +
        "or say in the PR body which tier you ran and why. A silent skip is the thing " +
        "AGENTS.md calls out; an unchecked box is a fine outcome.",
    );
  }

  const notCovered = verify.blocked ?? [];
  if (notCovered.length > 0 || verify.stamp?.dirty) {
    const bits = [];
    if (notCovered.length) {
      bits.push(
        `the local check ran with ${notCovered.length} lane(s) BLOCKED, so they were ` +
          `never verified here: ${notCovered.join("; ")}`,
      );
    }
    if (verify.stamp?.dirty) {
      bits.push("the tree was dirty when stamped, so the stamp may not describe this commit");
    }
    ask(
      `Tier-3 stamp matches HEAD, but ${bits.join(", and ")}. ` +
        "In a cloud container the local lane is conditional — see KI-2026-09-08-b, " +
        "KI-2026-09-12-b, KI-2026-09-02-a, KI-49. `pnpm check` skips `test:int` " +
        "SILENTLY when no database answers, and says so itself: \"A green `pnpm check` " +
        "here is NOT a green CI.\" Fine to proceed — record it on the PR's " +
        "\"Not run, and why\" line rather than letting CI be the first to find out.",
    );
  }
}

process.exit(0);
