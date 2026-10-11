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
// Each command is checked one segment at a time (split on `\n ; | &`), so
// `git status && rm -rf --force x` can never read as `git push --force`. The
// split used to be a lazy `[^\n;|&]*?` inside a lookahead after every
// `git <sub>`, which rescanned the rest of the segment from each occurrence:
// quadratic, 12s for `"git reset ".repeat(20000)`.
const SEGMENTS = /[\n;|&]/;

// Git's own global options sit BETWEEN `git` and the subcommand, and every arm
// below keys on the subcommand — so `git -C . reset --hard HEAD~1`,
// `git --no-pager push --force origin main` and `git -c core.pager=cat rebase
// main` all walked past a pattern that only knew `git reset`. They move a
// branch tip exactly as far as the bare forms do.
//
// An explicit allowlist rather than a generic `-\S+`: the prefix is the one
// place a wildcard could let an unrelated command read as a destructive one,
// and git's global option set is closed and rarely changes.
//
// Matched a token at a time rather than as `\bgit\b(?:\s+(?:opt))*\s+reset`:
// that regex, tried from every `git` in a segment, rescanned the option chain
// from each one, and `"git -C ".repeat(20000)` took 23s.
const TAKES_VALUE = /^-[cC]$/; // -c name=value, -C <path>, value as the next token
const WHOLE_OPT = new RegExp(
  "^(?:" +
    [
      "-[cC].+", // the value attached: -ccore.pager=cat
      "--(?:git-dir|work-tree|namespace|exec-path|config-env|attr-source)=.+",
      // `no-lazy-fetch` is here on documentation, not on observation: the git in
      // this container predates it and answers "unknown option", so the bypass it
      // opens is real only for a developer on a newer git — which is exactly the
      // person this hook cannot afford to miss.
      "--(?:no-pager|paginate|bare|no-lazy-fetch|no-replace-objects|no-optional-locks|no-advice|literal-pathspecs|glob-pathspecs|noglob-pathspecs|icase-pathspecs)",
      "-[pP]",
    ].join("|") +
    ")$",
);
const GIT_WORD = /(?:^|\W)git$/; // `git`, `/usr/bin/git`

// Each arm: the subcommand, and the flags that make it move a tip, searched
// for in the rest of the segment after the subcommand. `null` means the
// subcommand alone is enough.
const ARMS = new Map([
  // A reset only rewrites history when it names a commit-ish or a mode.
  // Bare `git reset` and `git reset HEAD -- <path>` just touch the index,
  // and asking about those would train everyone to click through.
  [
    "reset",
    /--(?:hard|soft|mixed|merge|keep)\b|\bHEAD[~^]|\bHEAD@\{|\bORIG_HEAD\b|\b[0-9a-f]{7,40}\b|\borigin\//,
  ],
  ["rebase", null],
  // --amend replaces the tip commit without the word "reset" appearing.
  ["commit", /\s--amend\b/],
  ["push", /\s(?:--force(?:-with-lease|-if-includes)?\b|-f\b)/],
]);

/**
 * True when one segment runs `git [global options] <sub>` with a tip-moving
 * flag after it. The option chain is followed as a two-state machine (expect
 * an option, or expect an option's value) so every alignment is tracked in
 * one pass: `git -C git reset` is a reset whichever `git` it starts from.
 */
function segmentIsDestructive(segment) {
  const tried = new Set(); // a later hit's rest is a suffix of the first's
  let expectOpt = false;
  let expectValue = false;
  for (const tok of segment.matchAll(/\S+/g)) {
    const t = tok[0];
    let nextOpt = false;
    let nextValue = false;
    if (expectOpt) {
      const sub = /^[a-z]+/.exec(t)?.[0];
      if (sub && ARMS.has(sub) && !tried.has(sub) && !/\w/.test(t[sub.length] ?? "")) {
        tried.add(sub);
        const flags = ARMS.get(sub);
        if (flags === null || flags.test(segment.slice(tok.index + sub.length))) return true;
      }
      if (TAKES_VALUE.test(t)) nextValue = true;
      else if (WHOLE_OPT.test(t)) nextOpt = true;
    }
    if (expectValue) nextOpt = true;
    if (GIT_WORD.test(t)) nextOpt = true;
    expectOpt = nextOpt;
    expectValue = nextValue;
  }
  return false;
}

const isDestructive = (command) => String(command).split(SEGMENTS).some(segmentIsDestructive);

const command = parsed?.tool_input?.command ?? "";
const destructive = isDestructive(command);

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
