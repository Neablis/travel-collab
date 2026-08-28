import { join, relative, resolve, sep } from "node:path";
import { ask, inScope, parseStdin, readAll, unitForCwd } from "./lib/run-context.mjs";

// PreToolUse hook (matcher: Edit|Write). Keeps a dispatched unit inside the
// file scope its brief declared. No-ops entirely when this cwd is not part of
// an active protocol run, so ordinary work is untouched.
//
// `ask`, not `deny`, on purpose: sometimes the declared scope is genuinely
// wrong, and the right outcome is that someone notices — not that the agent
// is trapped. AGENTS.md records the sprawl this guards against (PR #23).

const payload = parseStdin(await readAll(process.stdin));
if (!payload || typeof payload !== "object") process.exit(0);

const cwd = payload.cwd ?? process.cwd();
const target = payload?.tool_input?.file_path;
if (typeof target !== "string" || !target) process.exit(0);

const found = unitForCwd(cwd);
if (!found) process.exit(0);

const { unit, runDir } = found;
const root = resolve(unit.worktree);
const resolved = resolve(cwd, target);

// The contract ORDERS two writes that land outside the unit's worktree:
// the report at <run-dir>/reports/<unit-id>.md and board entries at
// <run-dir>/notes/<ts>-<slug>.md. The run directory lives in the main
// checkout while units live in worktrees, so `relative()` below yields
// "../../.claude/run/..." and the boundary branch fires on the two files
// every unit is required to produce — a permission prompt per unit in a
// protocol built for unattended parallelism, on the board that is the whole
// anti-poisoning mechanism.
//
// The allowance is narrowed to exactly those two things: the unit's OWN
// report, and anything under notes/. Permitting the whole run directory
// (every non-manifest path) let a unit overwrite another unit's report — a
// real integrity hole in a protocol whose whole point is parallel units.
// Everything else, including manifest.json and another unit's report, falls
// through to the worktree-boundary check below and therefore asks — this
// depends on run-context.mjs's `unit.id` validation in unitForCwd, so
// `unit.id` is guaranteed a non-empty string by the time we get here.
//
// Sep-terminated rather than a bare string prefix, so "<run-dir>-evil/" is
// still an escape.
const runRoot = resolve(runDir);
const ownReport = join(runRoot, "reports", `${unit.id}.md`);
const notesRoot = join(runRoot, "notes") + sep;
if (resolved === ownReport || resolved.startsWith(notesRoot)) process.exit(0);

const rel = relative(root, resolved);

// Boundary-safe: `rel.startsWith("..")` alone also matches an in-worktree
// path like "..hidden/file.ts" (a directory whose name happens to start
// with two dots), wrongly flagging a file that never left the worktree as
// outside it. Match run-context.mjs's own `root + sep` convention.
if (rel === "" || rel === ".." || rel.startsWith(".." + sep) || rel.startsWith(sep)) {
  ask(
    "PreToolUse",
    `Unit "${unit.id}" is writing to "${target}", which is outside its own worktree ` +
      `(${root}). Units never edit across worktree boundaries — report the need ` +
      "instead of reaching for it.",
  );
  process.exit(0);
}

// Normalised once: `inScope` already fails open (false) on a non-array
// fileScope via its own Array.isArray guard, but the ask-message builder
// below used to call `.join()` on `unit.fileScope` directly — `?? []` does
// not catch a truthy non-array like the string "src/**", so a malformed
// manifest crashed the hook (exit 1) instead of asking.
const fileScope = Array.isArray(unit.fileScope) ? unit.fileScope : [];
if (!inScope(rel, fileScope)) {
  ask(
    "PreToolUse",
    `"${rel}" is outside unit "${unit.id}"'s declared file scope:\n  ` +
      `${fileScope.join("\n  ")}\n\n` +
      "The contract (.claude/protocol/CONTRACT.md) requires reporting an " +
      "out-of-scope need rather than expanding silently, and widening your own " +
      "scope to get past a blocker is an automatic BLOCKED. If the scope is " +
      "genuinely wrong, say so in your report.",
  );
}

process.exit(0);
