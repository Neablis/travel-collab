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
  for await (const chunk of stream) out += chunk;
  return out;
}

export function parseStdin(raw) {
  try {
    return JSON.parse(raw || "{}");
  } catch {
    return null;
  }
}

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

export function activeRuns(cwd) {
  const main = mainCheckout(cwd);
  if (!main) return [];
  const root = join(main, ".claude", "run");
  if (!existsSync(root)) return [];

  const runs = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = join(root, entry.name, "manifest.json");
    if (!existsSync(file)) continue;
    try {
      const manifest = JSON.parse(readFileSync(file, "utf8"));
      if (manifest.teardown) continue;
      runs.push({ runDir: join(root, entry.name), manifest });
    } catch {
      // A malformed manifest must not block work.
    }
  }
  return runs;
}

export function unitForCwd(cwd) {
  const here = resolve(cwd);
  for (const run of activeRuns(cwd)) {
    for (const unit of run.manifest.units ?? []) {
      if (!unit.worktree) continue;
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
    if (c === "*") {
      if (glob[i + 1] === "*") {
        out += ".*";
        i += 1;
        if (glob[i + 1] === "/") i += 1;
      } else {
        out += "[^/]*";
      }
    } else if (c === "?") {
      out += "[^/]";
    } else {
      out += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${out}$`);
}

export function inScope(relPath, globs) {
  return (globs ?? []).some((glob) => globToRegExp(glob).test(relPath));
}

export function loadAdapter(cwd) {
  const main = mainCheckout(cwd);
  if (!main) return null;
  try {
    return JSON.parse(
      readFileSync(join(main, ".claude", "protocol", "adapter.json"), "utf8"),
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
