// PreToolUse hook (matcher: Bash). One ask and two refusals.
//
//   gh pr create   without --draft          -> ask
//   gh pr create --draft  from a milestone part branch -> deny (it opens ready)
//   gh pr create|edit  with a model id in --title/--body/--body-file -> deny
//
// On a milestone part branch (`claude/m<N>-part<K>-...`, lib/part-branch.mjs)
// the ask steps aside: build-a-part opens a part's PR ready for review,
// and the phase-implementer that does it has only `gh`. The head branch is
// `--head`/`-H` when given, else the branch checked out at the payload's cwd.
// The model-id rule is pr-tool-guard.mjs's, for the PRs `gh` opens.
//
// `gh pr ready` passes. It used to ask unless a Tier-3 stamp covered HEAD, but
// only `pnpm check` writes that stamp and check-test-lane.mjs denies it
// locally, so the ask fired on every call. Marking a PR ready is what makes
// CI run the full suite on it; that run is the verdict.
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
// FAILS OPEN. Any parse problem or missing git exits 0.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseShell } from "./lib/shell.mjs";
import { currentBranch, isPartBranch } from "./lib/part-branch.mjs";
import { findModelId } from "./lib/model-id.mjs";

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
const cwd = typeof parsed?.cwd === "string" && parsed.cwd ? parsed.cwd : process.cwd();

// `gh` must be the COMMAND WORD of a segment, not merely a substring. The
// first draft matched `\bgh…pr\s+create` anywhere, so
// `git commit -m 'gh pr create'` fired — a false positive, and this repo's
// standing rule is that a hook firing on something a person legitimately
// chose is a hook that gets trained away. lib/shell.mjs reads quotes and
// heredocs the way the shell does, so a body passed as
// `--body "$(cat <<'EOF' ... EOF)"` arrives as one word.
function ghCalls(command) {
  const calls = [];
  for (const seg of parseShell(command)) {
    if (seg.words[0]?.split("/").pop() !== "gh") continue;
    const pr = seg.words.indexOf("pr");
    if (pr === -1) continue;
    calls.push({ sub: seg.words[pr + 1] ?? "", args: seg.words.slice(pr + 2), heredocs: seg.heredocs });
  }
  return calls;
}

/** The values of `names` in `args`, in both `--x v` and `--x=v` spellings. */
function optionValues(args, names) {
  const out = [];
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (names.includes(a)) out.push(args[(i += 1)] ?? "");
    else {
      const eq = names.find((n) => n.startsWith("--") && a.startsWith(`${n}=`));
      if (eq) out.push(a.slice(eq.length + 1));
    }
  }
  return out;
}

// `--draft=false` is gh's boolean flag set off: the PR opens ready.
const DRAFT = new Set(["--draft", "-d", "--draft=true", "--draft=1"]);
const hasDraft = (args) => args.some((a) => DRAFT.has(a));

function respond(permissionDecision, reason) {
  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision,
        permissionDecisionReason: reason,
      },
    }),
  );
  process.exit(0);
}
const ask = (reason) => respond("ask", reason);

const calls = ghCalls(command);

for (const call of calls.filter((c) => c.sub === "create" || c.sub === "edit")) {
  const texts = [
    ...optionValues(call.args, ["--title", "-t", "--body", "-b"]),
    ...optionValues(call.args, ["--body-file", "-F"]).map((f) => {
      if (f === "-") return call.heredocs.join("\n");
      try {
        return readFileSync(resolve(cwd, f), "utf8");
      } catch {
        return ""; // an unreadable body file is gh's error to report
      }
    }),
  ];
  const found = texts.map(findModelId).find(Boolean);
  if (found) {
    respond(
      "deny",
      `The PR title or body contains a model id ("${found}"). Remove it; the body ends ` +
        "with the Claude Code attribution line and the session link, nothing more.",
    );
  }
}

const creates = calls.filter((c) => c.sub === "create");
const headOf = (call) => optionValues(call.args, ["--head", "-H"]).pop() ?? currentBranch(cwd);
const onPart = creates.filter((c) => isPartBranch(headOf(c)));

if (onPart.some((c) => hasDraft(c.args))) {
  respond(
    "deny",
    "This is a milestone part's branch: open it ready (build-a-part), not as a draft. " +
      "Drop --draft. A push while a PR is draft cancels its ready-for-review CI run.",
  );
}

if (creates.some((c) => !onPart.includes(c) && !hasDraft(c.args))) {
  ask(
    "This opens a PR ready rather than as a draft. AGENTS.md: \"open that PR as a " +
      "draft, and mark it ready only when you believe it is green.\" Measured over " +
      "2026-09-15..20: 11 of 15 branches opened ready, and PR #196 — opened ready — " +
      "spent 41 CI runs and 8 failures across 15 hours, its first run failing three " +
      "seconds in on `test:int`, a lane that runs locally in ~70s. " +
      "Add --draft, then `gh pr ready <n>` when you believe it is green: CI on the PR " +
      "runs the full suite. " +
      "Override deliberately for a prose fix, a revert, or a PR asked for right now.",
  );
}

process.exit(0);
