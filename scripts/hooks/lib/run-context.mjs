import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";

// Shared plumbing for the subagent-protocol hooks
// (docs/specs/2026-08-28-subagent-operating-contract-design.md).
//
// Every export fails open. A hook that cannot work out the run context must
// no-op: blocking work it does not understand is worse than not running.
//
// Hooks locate the run by scanning rather than by a RUN_ID, because a hook
// payload carries only `cwd`, and an agent driven from a separate session
// inherits no environment from the orchestrator.

export async function readAll(stream) {
  let out = "";
  stream.setEncoding("utf8");
  try {
    for await (const chunk of stream) out += chunk;
  } catch {
    // EPIPE from a parent that closed early must not crash the hook's
    // entry point; return whatever was read before the stream broke.
  }
  return out;
}

export function parseStdin(raw) {
  try {
    return JSON.parse(raw || "{}");
  } catch {
    return null;
  }
}

// Resolves the MAIN checkout (git-common-dir), which is shared by every linked
// worktree — the right root for `.claude/run/` scratch. It is NOT
// interchangeable with `worktreeRoot` below, which resolves the calling
// worktree's own top level and is the right root for branch-versioned repo
// content like `.claude/protocol/adapter.json`. The two agree only when no
// linked worktree is in play. Read the comment above `worktreeRoot` before
// changing either: collapsing them has already caused two silent failures.
// (KI-63: that comment existed but had no pointer from this end, so the
// resolver you land on first told you nothing about the choice.)
export function mainCheckout(cwd) {
  try {
    const common = execSync(
      "git rev-parse --path-format=absolute --git-common-dir",
      { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    return common ? dirname(common) : null;
  } catch {
    return null;
  }
}

// `mainCheckout` and `worktreeRoot` resolve to the SAME directory for a repo
// with no linked worktrees, which is why this split is easy to "simplify"
// away — don't. They diverge exactly when a linked worktree is in play
// (every unit in this protocol runs in one), and each is right for a
// different kind of data:
//
//   - `.claude/run/` is cross-worktree shared scratch: every worktree
//     dispatched from one run must see the same manifest, so callers that
//     locate a run resolve via `mainCheckout` (git-common-dir).
//   - `.claude/protocol/adapter.json` is branch-versioned repo content: a
//     worktree must read the copy checked out on ITS OWN branch, not
//     whatever happens to be on disk in the main checkout. Resolve that via
//     `worktreeRoot` (--show-toplevel) instead.
//
// Collapsing these into one resolver made `loadAdapter` read the main
// checkout's copy regardless of which worktree asked — silently inert
// pre-merge (the main checkout has no adapter.json yet) and silently stale
// post-merge (a worktree that edits adapter.json is still governed by
// main's copy until it merges). Both failures are quiet: no error, no
// crash, just a hook that fails open when it shouldn't.
export function worktreeRoot(cwd) {
  try {
    const top = execSync("git rev-parse --show-toplevel", {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return top || null;
  } catch {
    return null;
  }
}

export function activeRuns(cwd) {
  const main = mainCheckout(cwd);
  if (!main) return [];
  const root = join(main, ".claude", "run");
  if (!existsSync(root)) return [];

  // `.claude/run` existing as a stray file (ENOTDIR) or being permission-denied
  // (EACCES) must not throw through unitForCwd into the calling hook — an
  // unreadable run directory is exactly the "cannot determine context" case
  // this library exists to no-op on.
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }

  const runs = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const file = join(root, entry.name, "manifest.json");
    try {
      if (!existsSync(file)) continue;
      const manifest = JSON.parse(readFileSync(file, "utf8"));
      if (manifest.teardown) continue;
      runs.push({ runDir: join(root, entry.name), manifest });
    } catch {
      // A malformed manifest, or a read failure on it, must not block work.
    }
  }
  return runs;
}

export function unitForCwd(cwd) {
  // A hook payload's `cwd` is untrusted JSON (a bad `??` fallback, an
  // attacker/mistake-supplied number or object). `resolve()` throws a
  // TypeError on anything but a string, which would crash a PreToolUse hook
  // instead of failing open.
  if (typeof cwd !== "string") return null;
  const here = resolve(cwd);
  for (const run of activeRuns(cwd)) {
    // Same reasoning as the guard in run-teardown-reminder.mjs: the manifest
    // is hand-authored JSON, so `units` arrives as an object, or carrying a
    // null entry, or with a non-string `worktree` — and each of those threw
    // an uncaught TypeError out of a PreToolUse hook, breaking every Bash,
    // Edit and Write in the repo until someone found the run directory.
    // Failing open on a shape we don't understand is the whole contract here.
    const units = Array.isArray(run.manifest.units) ? run.manifest.units : [];
    for (const unit of units) {
      if (!unit || typeof unit !== "object") continue;
      if (typeof unit.worktree !== "string" || !unit.worktree) continue;
      // A missing/non-string `id` used to slip through here: downstream,
      // `holder === found.unit.id` compares a lease holder string against
      // `undefined`, which is never equal, so a malformed manifest entry
      // made resource-lease.mjs report a false-positive "ask" instead of
      // failing open on a shape it can't understand.
      if (typeof unit.id !== "string" || !unit.id) continue;
      const root = resolve(unit.worktree);
      if (here === root || here.startsWith(root + sep)) {
        return { ...run, unit };
      }
    }
  }
  return null;
}

export function globToRegExp(glob) {
  let out = "";
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      if (glob[i + 2] === "/") {
        // "**/" matches zero or more whole directory segments — not a
        // substring of the final segment. Swallowing the "/" into ".*"
        // (the previous version) let "src/**/x.ts" match "src/foo/bar-x.ts",
        // silently under-blocking the out-of-scope edits inScope exists to catch.
        out += "(?:.*/)?";
        i += 2;
      } else {
        out += ".*";
        i += 1;
      }
    } else if (c === "*") {
      out += "[^/]*";
    } else if (c === "?") {
      out += "[^/]";
    } else {
      out += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${out}$`);
}

export function inScope(relPath, globs) {
  // A hand-authored `"fileScope": "src/**"` (string, not array) used to throw
  // `.some is not a function` straight out of the file-scope hook. False is
  // the fail-open answer for the caller: it asks rather than crashing.
  // The per-element check is the same defect one level down: a null inside
  // the array throws on `glob.length` just as fatally as the string did.
  if (!Array.isArray(globs)) return false;
  return globs.some((glob) => typeof glob === "string" && globToRegExp(glob).test(relPath));
}

export function loadAdapter(cwd) {
  // worktreeRoot, not mainCheckout — see the comment above worktreeRoot.
  const top = worktreeRoot(cwd);
  if (!top) return null;
  try {
    return JSON.parse(
      readFileSync(join(top, ".claude", "protocol", "adapter.json"), "utf8"),
    );
  } catch {
    return null;
  }
}

export function ask(hookEventName, reason) {
  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName,
        permissionDecision: "ask",
        permissionDecisionReason: reason,
      },
    }),
  );
}
