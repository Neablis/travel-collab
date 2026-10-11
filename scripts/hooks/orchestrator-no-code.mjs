import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { parseStdin, readAll } from "./lib/run-context.mjs";

// PreToolUse hook (matcher: Edit|Write|MultiEdit). build-a-milestone's first
// rule: the orchestrating session never writes source code; every build and
// fix goes to a phase-implementer. This blocks an edit under apps/ or
// packages/ when BOTH hold:
//
//   - the call is the main session's: the payload has no `agent_id`, which
//     Claude Code sets on tool events fired inside a subagent;
//   - this worktree is orchestrating: `<git-dir>/tc-orchestrator` exists.
//     build-a-milestone creates it and close-a-milestone removes it. Without
//     the marker every ordinary main session would lose the right to edit code.
//
// "Code" is apps/ or packages/ under this worktree's root, under any other
// worktree of the repo (`git worktree list`), or under `.claude/worktrees/<x>/`
// inside this one, so the orchestrator cannot edit code by reaching into a
// worktree it made.
//
// It runs beside subagent-file-scope.mjs and does not overlap it: that hook
// only engages inside a protocol unit's worktree, this one never engages for a
// subagent. Exit 2 with the reason on stderr blocks; anything it cannot work
// out exits 0.

const payload = parseStdin(await readAll(process.stdin));
if (!payload || payload.agent_id) process.exit(0);
const target = payload?.tool_input?.file_path;
if (typeof target !== "string" || !target) process.exit(0);

const cwd = payload.cwd || process.cwd();
const git = (args) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 3000 }).trim();

let root;
let marker;
try {
  marker = join(git(["rev-parse", "--absolute-git-dir"]), "tc-orchestrator");
  if (!existsSync(marker)) process.exit(0);
  root = git(["rev-parse", "--show-toplevel"]);
} catch {
  process.exit(0);
}

let roots = [root];
try {
  roots = roots.concat(
    git(["worktree", "list", "--porcelain"])
      .split("\n")
      .filter((l) => l.startsWith("worktree "))
      .map((l) => l.slice(9)),
  );
} catch {
  // This worktree's own root is still checked.
}

const file = resolve(cwd, target);
const CODE = /^(?:\.claude\/worktrees\/[^/]+\/)?(?:apps|packages)\//;
const hit = roots
  .map((r) => relative(r, file).split(sep).join("/"))
  .find((rel) => !rel.startsWith("..") && CODE.test(rel));
if (hit) {
  console.error(
    `This session is orchestrating a milestone and does not edit code ("${hit}"). ` +
      "Dispatch a phase-implementer with a brief: the part, its branch, its file scope, " +
      "and what done means (build-a-milestone). The marker that makes this session the " +
      `orchestrator is ${marker}; when the milestone is over, \`rm ${marker}\` lifts this.`,
  );
  process.exit(2);
}
process.exit(0);
