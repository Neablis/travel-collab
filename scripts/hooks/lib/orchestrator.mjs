import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

// "This session is the milestone orchestrator", as orchestrator-no-code.mjs
// first defined it and as every orchestrator-only hook must agree:
//
//   - the call is the main session's: the payload has no `agent_id`, which
//     Claude Code sets on tool events fired inside a subagent;
//   - `<absolute git dir>/tc-orchestrator` exists. build-a-milestone creates
//     it and close-a-milestone removes it.
//
// The git dir is the calling worktree's own (not the common dir): a session in
// another worktree of the same repo is not orchestrating.

/** The marker's path when `payload` comes from the orchestrating main session, else null. */
export function orchestratorMarker(payload) {
  if (!payload || typeof payload !== "object" || payload.agent_id) return null;
  const cwd = typeof payload.cwd === "string" && payload.cwd ? payload.cwd : process.cwd();
  try {
    const gitDir = execFileSync("git", ["rev-parse", "--absolute-git-dir"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 3000,
    }).trim();
    const marker = join(gitDir, "tc-orchestrator");
    return gitDir && existsSync(marker) ? marker : null;
  } catch {
    return null; // not a repo, no git: nobody is orchestrating
  }
}
