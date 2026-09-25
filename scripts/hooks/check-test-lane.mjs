// PreToolUse hook (matcher: Bash). Refuses the two test commands this repo has
// measured to lie about what they ran.
//
//   pnpm ... test:e2e            (not :ci-like)  -> deny, unless E2E_DEV_LANE=1
//   pnpm ... test -- --run <f>                   -> deny, always
//
// WHY
//
// CLAUDE.md rule 1: an e2e result only counts from `test:e2e:ci-like`. Plain
// `test:e2e` serves `pnpm dev`, which compiles each route on first hit and
// times out where CI does not (KI-27). The rule has been broken twice with the
// KI already written, then again by the repo's own ci-triage skill and a plan
// file (docs/reviews/2026-08-28-project-review.md, section 4 F1/F2 and section
// 7 item 1: "prose rules regress; mechanical gates don't").
//
// `pnpm --filter web test -- --run <file>` reads as one file and runs all of
// them: pnpm swallows the passthrough, and the measured result was
// `Test Files 103 passed (103)` for a single named file
// (.claude/skills/minimal-check-subset/SKILL.md). Five of those at once on one
// machine is the load KI-13 is about.
//
// WHY "deny" AND NOT "ask", UNLIKE THE OTHER TWO GUARDS
//
// Neither command has a caller who needs a human to decide. The passthrough
// form never does what it says, so there is nothing to approve. The dev lane
// has one honest use, iterating on a spec being written, and the caller can
// say so itself with `E2E_DEV_LANE=1` in front of the command. An "ask" would
// stall an unattended agent on a prompt nobody is there to answer; a deny hands
// it the right command in the reason and lets it carry on.
//
// FAILS OPEN. A payload that does not parse, or a command with no pnpm/npm
// call in it, exits 0 with no output.

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

// The package manager must be the COMMAND WORD of a segment, as in
// draft-pr-guard.mjs: `git commit -m 'use test:e2e:ci-like, not test:e2e'` or
// `grep -rn "test -- --run" docs/` names the form without running it. Splitting
// on separators is imperfect inside quotes; a missed deny costs one slow run, a
// spurious one costs the guard its credibility.
const SEGMENTS = (cmd) => cmd.split(/[\n;|&]+/);
const PM_CALL = /^\s*((?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*)(?:pnpm|npm|yarn)\b(.*)$/;

const DEV_LANE = /\btest:e2e(?!:ci-like\b)(?![\w:-])/;
const PASSTHROUGH = /\btest\s+--\s+--run\b/;
const OVERRIDE = /(?:^|\s)E2E_DEV_LANE=1(?:\s|$)/;

function deny(reason) {
  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    }),
  );
  process.exit(0);
}

const calls = [];
for (const seg of SEGMENTS(command)) {
  const m = PM_CALL.exec(seg);
  if (m) calls.push({ env: m[1], args: m[2] });
}

if (calls.some((c) => PASSTHROUGH.test(c.args))) {
  deny(
    "`test -- --run <file>` does not scope: pnpm swallows the passthrough and vitest " +
      "runs the whole suite (measured: one named file, `Test Files 103 passed (103)`). " +
      "Use `pnpm --filter web exec vitest run -c vitest.unit.config.ts <file>` for a " +
      "unit test, or `node scripts/with-test-db.mjs vitest run <file>` from apps/web " +
      "for an integration test. See the minimal-check-subset skill " +
      "(.claude/skills/minimal-check-subset/SKILL.md).",
  );
}

if (calls.some((c) => DEV_LANE.test(c.args) && !OVERRIDE.test(c.env))) {
  deny(
    "Plain `test:e2e` is the dev lane: it serves `pnpm dev`, which compiles routes on " +
      "first hit and times out where CI does not (KI-27). CLAUDE.md rule 1: an e2e " +
      "result only counts from `pnpm --filter web test:e2e:ci-like`. Run that for a " +
      "verdict. If you are iterating on a spec you are writing and know the result is " +
      "not a verdict, put `E2E_DEV_LANE=1` in front of the command. For which checks a " +
      "change needs at all, see the minimal-check-subset skill.",
  );
}

process.exit(0);
