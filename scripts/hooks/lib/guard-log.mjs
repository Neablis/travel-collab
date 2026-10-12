import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { join } from "node:path";

// One line per time a token-spend guard denied a call or injected a note, so
// the next milestone's retro can count what the guards did instead of guessing
// (docs/retros/2026-10-12-m42-token-spend-retro.md §6, "How to check it
// worked"). The file sits in the git COMMON dir: every worktree of the repo,
// and so every subagent, appends to the same log.
//
// The line's shape is a contract with the script that reads it:
//   {"t": "<ISO time>", "hook": "<hook name>", "decision": "deny" | "note"}
// Do not add, rename or reorder fields without changing that reader.

export const GUARD_LOG = "tc-guard-log.jsonl";

/** Appends one line for `hook`. Never throws: a log is worth less than the call it describes. */
export function recordGuard(cwd, hook, decision) {
  try {
    // No fallback to process.cwd(): a payload without a cwd must not write
    // into whichever repo the hook happened to be started from.
    if (typeof cwd !== "string" || !cwd) return;
    const common = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 3000,
    }).trim();
    if (!common) return;
    appendFileSync(
      join(common, GUARD_LOG),
      `${JSON.stringify({ t: new Date().toISOString(), hook, decision })}\n`,
    );
  } catch {
    // Not a repo, a read-only git dir, no git: the guard still did its job.
  }
}
