import { execFileSync } from "node:child_process";

// A milestone part's branch: `claude/m<N>-part<K>-<slug>`, with K >= 1
// (plan-a-milestone names them; M41's were `claude/m41-part3-parked-origin`).
// Part 0 is prose-only and lives on the session's own branch, which never
// matches. The milestone-only rules (a part opens ready, never draft; the
// review nudge after a push) apply on these branches and nowhere else.
export const PART_BRANCH = /^claude\/m\d+-part[1-9]\d*/;

/** True when `branch` (optionally `owner:branch` or `refs/heads/...`) is a part's. */
export function isPartBranch(branch) {
  if (typeof branch !== "string") return false;
  return PART_BRANCH.test(branch.replace(/^[^:/]+:/, "").replace(/^refs\/heads\//, ""));
}

/**
 * The branch checked out at `cwd`, or null (detached, not a repo, no git).
 * `symbolic-ref` rather than `rev-parse --abbrev-ref` so an unborn branch
 * still answers.
 */
export function currentBranch(cwd) {
  try {
    return (
      execFileSync("git", ["symbolic-ref", "--short", "-q", "HEAD"], {
        cwd: typeof cwd === "string" && cwd ? cwd : process.cwd(),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 3000,
      }).trim() || null
    );
  } catch {
    return null;
  }
}
