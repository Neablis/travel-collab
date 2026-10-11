// PreToolUse hook (matcher: Bash). Refuses the test commands this repo has
// measured to lie about what they ran, and the full local suites that
// build-a-part's recipe leaves to CI.
//
//   pnpm ... test:e2e            (not :ci-like)  -> deny, unless E2E_DEV_LANE=1
//   pnpm ... test -- --run <f>                   -> deny, always
//   pnpm check / pnpm test:unit                  -> deny  (full suite)
//   pnpm [--filter p] test, no test path         -> deny  (full suite)
//   vitest run, no test path                     -> deny  (full suite)
//   vitest run whose only path is `src/` or `.`  -> deny  (the package suite)
//   vitest run in apps/web without -c/--config   -> deny  (default config is
//                                                   the integration suite)
//   test:e2e[:ci-like] with no spec, or `-- spec` -> deny  (full e2e suite)
//   playwright test in apps/web, no spec         -> deny  (full e2e suite)
//
// "In apps/web" is decided by the package manager's `--filter`s when there are
// any, and otherwise by the cwd, re-evaluated at every `cd` in the command.
// `vitest list` and `vitest --version` run nothing and pass.
//
// The full-suite denials step aside for `ALLOW_FULL_SUITE=1` at the start of
// the command, which is for when Mitchell asks for a full run. `test:int` is
// left alone: minimal-check-subset sends a schema or projection change there
// on purpose, because cross-file state is the point of that lane.
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

import { parseShell, withoutRedirections } from "./lib/shell.mjs";

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
// `grep -rn "test -- --run" docs/` names the form without running it.
// lib/shell.mjs splits the command the way the shell would, so a quoted
// separator (`-m "b; pnpm check passed"`) stays text, a heredoc body is never
// read as commands, and an escaped quote (`echo \"; pnpm check`) does not open
// a string that hides the call after it. The regex splitter it replaces did
// all three wrong, and its heredoc pattern was quadratic.
const RUNNERS = new Set(["pnpm", "npm", "yarn", "npx", "node", "vitest", "playwright"]);

const DEV_LANE = /\btest:e2e(?!:ci-like\b)(?![\w:-])/;
const PASSTHROUGH = /\btest\s+--\s+--run\b/;
const OVERRIDE = "E2E_DEV_LANE=1";
const FULL_OK = "ALLOW_FULL_SUITE=1";

// Flags whose next token is a value, never a test path.
const VALUE_FLAGS = new Set([
  "--filter", "-F", "-C", "--dir", "--workspace", "--prefix",
  "-c", "--config", "-g", "--grep", "-t", "--testNamePattern", "--project",
  "--reporter", "--shard", "--workers", "-j", "--retries", "--repeat-each",
  "--root", "--environment", "--outputFile", "--timeout",
]);
// A token that names a test file or a directory of them. A bare word such as
// `dates` is a vitest name filter, not a path, and still runs a full collect.
const PATHLIKE = /\/|\.(?:test|spec)\b|\.m?[jt]sx?$/;

const UNIT = "pnpm --filter web exec vitest run -c vitest.unit.config.ts <test files>";
const INT = "pnpm --filter web exec node scripts/with-test-db.mjs vitest run <file>";
const E2E = "pnpm --filter web test:e2e:ci-like e2e/<spec>.ts (no `--` before the path)";
const ESCAPE =
  " `ALLOW_FULL_SUITE=1` in front of the command is only for when Mitchell asks for a full run.";

function positionals(args) {
  const out = [];
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--") continue;
    if (a.startsWith("-")) {
      if (VALUE_FLAGS.has(a)) i += 1;
      continue;
    }
    out.push(a);
  }
  return out;
}

const hasPath = (args) => positionals(args).some((a) => PATHLIKE.test(a));

// A package's whole source tree or root: `src`, `src/`, `.`, `./`, and the
// same under `apps/<p>/` or `packages/<p>/`. Naming one is the package suite
// with a path attached.
const WHOLE_PACKAGE = /^(?:(?:apps|packages)\/[^/]+(?:\/src)?|src|\.)?$/;
const isWholePackage = (a) => WHOLE_PACKAGE.test(a.replace(/^(?:\.\/)+/, "").replace(/\/+$/, ""));
const PACKAGE_WIDE =
  "A package-wide change is not a reason to run the package suite: run the tests " +
  "covering the files you changed, and let CI run the package suite on the PR " +
  "(minimal-check-subset).";

// A pnpm/npm/yarn call reduced to { script, filters, args }, skipping the
// package manager's own flags; `exec` is reported as the script name.
function scriptCall(words) {
  const filters = [];
  let i = 1;
  while (i < words.length && words[i].startsWith("-")) {
    const w = words[i];
    const eq = w.match(/^--(?:filter|dir|prefix|workspace)=(.*)$/);
    if (eq) filters.push(eq[1]);
    else if (VALUE_FLAGS.has(w)) {
      filters.push(words[i + 1] ?? "");
      i += 1;
    }
    i += 1;
  }
  if (words[i] === "run") i += 1;
  return { script: words[i] ?? "", filters, args: words.slice(i + 1) };
}

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

const IN_WEB = /(?:^|\/)apps\/web(?:\/|$)/;
const isWebFilter = (f) => /(?:^|\/)(?:apps\/)?web$/.test(f);
// Filters name the package outright, so they decide; the cwd only matters
// when there are none.
const targetsWeb = (filters, inWeb) => (filters.length > 0 ? filters.some(isWebFilter) : inWeb);

const cwd = String(parsed?.cwd ?? "");
const calls = [];
let inWeb = IN_WEB.test(cwd);
for (const seg of parseShell(command)) {
  const words = withoutRedirections(seg.words);
  if (words[0] === "cd") {
    // Every `cd` moves: into web, deeper inside it, or out of it. A path with
    // `..`, an absolute path, a bare `cd`, or one built from `$` (a variable
    // or `$(git rev-parse --show-toplevel)`) leaves unless it names apps/web.
    const to = words[1] ?? "";
    inWeb =
      IN_WEB.test(to) ||
      (inWeb && to !== "" && !to.includes("$") && !/^[/~-]/.test(to) && !to.split("/").includes(".."));
  }
  if (!RUNNERS.has(words[0]?.split("/").pop())) continue;
  calls.push({ env: seg.env, rest: words.join(" "), words, inWeb });
}

const pmCalls = calls.filter((c) => /^(?:pnpm|npm|yarn)$/.test(c.words[0]));

if (pmCalls.some((c) => PASSTHROUGH.test(c.rest))) {
  deny(
    "`test -- --run <file>` does not scope: pnpm swallows the passthrough and vitest " +
      "runs the whole suite (measured: one named file, `Test Files 103 passed (103)`). " +
      `Use \`${UNIT.replace("<test files>", "<file>")}\` for a unit test, or ` +
      "`node scripts/with-test-db.mjs vitest run <file>` from apps/web " +
      "for an integration test. See the minimal-check-subset skill " +
      "(.claude/skills/minimal-check-subset/SKILL.md).",
  );
}

if (pmCalls.some((c) => DEV_LANE.test(c.rest) && !c.env.includes(OVERRIDE))) {
  deny(
    "Plain `test:e2e` is the dev lane: it serves `pnpm dev`, which compiles routes on " +
      "first hit and times out where CI does not (KI-27). CLAUDE.md rule 1: an e2e " +
      "result only counts from `pnpm --filter web test:e2e:ci-like`. Run that for a " +
      "verdict. If you are iterating on a spec you are writing and know the result is " +
      "not a verdict, put `E2E_DEV_LANE=1` in front of the command. For which checks a " +
      "change needs at all, see the minimal-check-subset skill.",
  );
}

// --- full local suites -------------------------------------------------------

for (const c of calls) {
  if (c.env.includes(FULL_OK)) continue;
  const runner = c.words[0].split("/").pop();
  const web = c.inWeb;

  if (/^(?:pnpm|npm|yarn)$/.test(runner)) {
    const { script, filters, args } = scriptCall(c.words);
    const onWeb = targetsWeb(filters, web);
    if (script === "check" || script === "test:unit") {
      deny(
        `\`${runner} ${script}\` is the full local suite, a final-review cost CI pays on the ` +
          "PR. Run build-a-part's scoped recipe instead: `npx tsc --noEmit -p <touched " +
          "package>`, `pnpm --filter web exec eslint <changed files>`, and " +
          `\`${UNIT}\`. The minimal-check-subset skill covers anything else.${ESCAPE}`,
      );
    }
    if (script === "test" && !hasPath(args)) {
      deny(
        `\`${c.words.join(" ")}\` names no test file, so it runs the whole suite. ` +
          `Scope it: \`${onWeb ? UNIT : "pnpm --filter <pkg> exec vitest run <test files>"}\`.` +
          ESCAPE,
      );
    }
    if (/^test:e2e(?::ci-like)?$/.test(script)) {
      const dashed = args.indexOf("--");
      const before = dashed === -1 ? args : args.slice(0, dashed);
      if (dashed !== -1 && hasPath(args.slice(dashed + 1)) && !hasPath(before)) {
        deny(
          `\`-- <spec>\` drops the filter: \`${script} -- e2e/x.spec.ts\` ran the whole e2e ` +
            `suite (177 tests, 2026-09-25). Run \`${E2E}\`.`,
        );
      }
      if (!hasPath(before)) {
        deny(`\`${script}\` with no spec path runs the whole e2e suite. Run \`${E2E}\`.${ESCAPE}`);
      }
    }
  }

  const pmFilters = /^(?:pnpm|npm|yarn)$/.test(runner) ? scriptCall(c.words).filters : [];

  const pw = c.words.findIndex((w, i) => w.split("/").pop() === "playwright" && c.words[i + 1] === "test");
  if (pw !== -1 && targetsWeb(pmFilters, web) && !hasPath(c.words.slice(pw + 2))) {
    deny(`\`playwright test\` with no spec path runs the whole e2e suite. Run \`${E2E}\`.${ESCAPE}`);
  }

  const v = c.words.findIndex((w) => w.split("/").pop() === "vitest");
  if (v === -1) continue;
  const after = c.words.slice(v + 1);
  // Collecting or printing the version runs no test.
  if (after[0] === "list" || after.some((a) => /^(?:--version|-v|--help|-h)$/.test(a))) continue;
  const vargs = after.filter((w, i) => !(i === 0 && w === "run"));
  const viaDb = c.words.slice(0, v).some((w) => w.endsWith("with-test-db.mjs"));
  const paths = positionals(vargs).filter((a) => PATHLIKE.test(a) || isWholePackage(a));
  if (paths.length > 0 && paths.every(isWholePackage)) {
    deny(
      `\`${paths.join(" ")}\` is a package's whole tree, so this vitest run is the package ` +
        `suite. ${PACKAGE_WIDE}${ESCAPE}`,
    );
  }
  if (!hasPath(vargs)) {
    deny(
      "This vitest run names no test file or directory, so it runs the whole suite. " +
        `Name the files: \`${viaDb ? INT : UNIT}\`.${ESCAPE}`,
    );
  }
  const onWeb = targetsWeb(pmFilters, web);
  const hasConfig = vargs.some((a) => /^(?:-c|--config)(?:=|$)/.test(a));
  const intFiles = positionals(vargs).some((a) => /\.int\.test\./.test(a));
  if (onWeb && !viaDb && !hasConfig && !intFiles) {
    deny(
      "In apps/web, vitest without `-c vitest.unit.config.ts` uses the default config, " +
        "whose include is the integration suite (`src/**/*.int.test.ts`), so a unit file " +
        `matches nothing. Run \`${UNIT}\`, or for an integration test \`${INT}\`.`,
    );
  }
}

process.exit(0);
