import { execSync } from "node:child_process";

// PreToolUse hook (matcher: Bash). Warns before a history-rewriting git
// command runs while more than one worktree exists on this repo — see
// AGENTS.md (~line 138-143) for the incident this guards against: a
// `git reset --soft` in one worktree silently dropped a sibling worktree's
// already-committed work from the branch tip.

let input = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) input += chunk;

let parsed;
try {
  parsed = JSON.parse(input || "{}");
} catch {
  process.exit(0);
}

// Everything that can move a branch tip out from under a sibling worktree.
// The first version of this pattern matched only `reset --hard|--soft`,
// `rebase`, and a force flag sitting *immediately* after `push` — so plain
// `git reset HEAD~1`, `git reset --mixed HEAD~1`, `git commit --amend` and
// `git push origin --force` all walked straight through, and those move the
// tip exactly as far as the forms it did catch.
//
// `SEGMENT` keeps each flag search inside one command, so `git status && rm
// -rf --force x` can never read as `git push --force`.
const SEGMENT = "[^\n;|&]*?";

// Git's own global options sit BETWEEN `git` and the subcommand, and every arm
// below keys on the subcommand — so `git -C . reset --hard HEAD~1`,
// `git --no-pager push --force origin main` and `git -c core.pager=cat rebase
// main` all walked past a pattern that only knew `git reset`. They move a
// branch tip exactly as far as the bare forms do.
//
// An explicit allowlist rather than a generic `-\S+`: the prefix is the one
// place a wildcard could let an unrelated command read as a destructive one,
// and git's global option set is closed and rarely changes. Option arguments
// exclude the SEGMENT separators so a value can never swallow a `&&`.
const OPT_ARG = "[^\\s;|&]+";
const GIT_GLOBAL_OPT = [
  // Take a value, attached or as the next token: -c name=value, -C <path>.
  `-[cC]\\s*${OPT_ARG}`,
  `--(?:git-dir|work-tree|namespace|exec-path|config-env|attr-source)=${OPT_ARG}`,
  // `no-lazy-fetch` is here on documentation, not on observation: the git in
  // this container predates it and answers "unknown option", so the bypass it
  // opens is real only for a developer on a newer git — which is exactly the
  // person this hook cannot afford to miss.
  "--(?:no-pager|paginate|bare|no-lazy-fetch|no-replace-objects|no-optional-locks|no-advice|literal-pathspecs|glob-pathspecs|noglob-pathspecs|icase-pathspecs)\\b",
  "-[pP]\\b",
].join("|");
const GIT = `\\bgit\\b(?:\\s+(?:${GIT_GLOBAL_OPT}))*`;

const DESTRUCTIVE = new RegExp(
  [
    // A reset only rewrites history when it names a commit-ish or a mode.
    // Bare `git reset` and `git reset HEAD -- <path>` just touch the index,
    // and asking about those would train everyone to click through.
    `${GIT}\\s+reset\\b(?=${SEGMENT}(?:--(?:hard|soft|mixed|merge|keep)\\b|\\bHEAD[~^]|\\bHEAD@\\{|\\bORIG_HEAD\\b|\\b[0-9a-f]{7,40}\\b|\\borigin/))`,
    `${GIT}\\s+rebase\\b`,
    // --amend replaces the tip commit without the word "reset" appearing.
    `${GIT}\\s+commit\\b(?=${SEGMENT}\\s--amend\\b)`,
    `${GIT}\\s+push\\b(?=${SEGMENT}\\s(?:--force(?:-with-lease|-if-includes)?\\b|-f\\b))`,
  ].join("|"),
);

const command = parsed?.tool_input?.command ?? "";
const destructive = DESTRUCTIVE.test(command);

if (!destructive) {
  process.exit(0);
}

let worktreeCount = 0;
try {
  const list = execSync("git worktree list --porcelain", {
    encoding: "utf8",
  });
  worktreeCount = list
    .split("\n")
    .filter((line) => line.startsWith("worktree ")).length;
} catch {
  process.exit(0);
}

if (worktreeCount <= 1) {
  process.exit(0);
}

console.log(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "ask",
      permissionDecisionReason:
        `This looks like a history-rewriting git command ("${command}") while ${worktreeCount} ` +
        "git worktrees exist on this repo. A prior incident here (AGENTS.md ~line 138-143) had a " +
        "`git reset --soft` in one worktree silently drop a sibling worktree's already-committed work " +
        "from the branch tip. Confirm this only touches this worktree's own history before proceeding.",
    },
  }),
);
