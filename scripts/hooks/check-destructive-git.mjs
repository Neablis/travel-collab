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

const command = parsed?.tool_input?.command ?? "";
const destructive =
  /\bgit\s+(reset\s+--(hard|soft)\b|rebase\b|push\s+(--force\b|-f\b))/.test(
    command,
  );

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
