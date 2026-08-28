import { activeRuns, parseStdin, readAll } from "./lib/run-context.mjs";

// Stop hook (main session). Fires ONLY when a run has every unit closed and no
// teardown recorded. The narrow trigger is the point: a Stop hook that fires on
// every turn is trained away within a day, after which it enforces nothing.
//
// What it protects is the promotion gate. Deleting a run directory that still
// holds an unpromoted durable fact is how the same lesson gets paid for twice.

const payload = parseStdin(await readAll(process.stdin));
if (!payload || typeof payload !== "object") process.exit(0);

// Without this guard the block below re-fires forever: exiting 2 causes Stop
// to fire again with stop_hook_active set, and a hook that doesn't check it
// would block that retry too, forever. Must be checked before anything else
// that could exit 2.
if (payload.stop_hook_active) process.exit(0);

const cwd = payload.cwd ?? process.cwd();

// `manifest.units` is operator-authored JSON, not a validated schema — a
// stray string or object where an array belongs must not throw `.every` out
// of this filter, and a unit entry that isn't an object must not throw on
// `.state`. Either would surface as an uncaught exception (not the deliberate
// exit 2 below), which is worse: it blocks the turn with a stack trace instead
// of a readable checklist, for a malformed manifest nobody meant to author.
const pending = activeRuns(cwd).filter(({ manifest }) => {
  const units = Array.isArray(manifest.units) ? manifest.units : [];
  // `[].every(...)` is `true` — a run with zero units must never look
  // "all closed". The length check is the fix for that foot-gun, not
  // decoration.
  return (
    units.length > 0 &&
    units.every((unit) => unit && typeof unit === "object" && unit.state === "closed")
  );
});

if (pending.length === 0) process.exit(0);

// `activeRuns` scans from the git common dir, so this reaches EVERY session
// in the repo — including one whose cwd is an unrelated sibling worktree that
// has never heard of this run. Two things keep it from reading as an
// instruction to an uninvolved agent: the run directory's absolute path, so a
// reader can tell at a glance whether it is theirs, and the explicit
// permission below to do nothing. Without them the message tells a stranger
// to triage notes and get approval to delete worktrees and branches.
const label = pending.length === 1 ? "Run" : "Runs";
const names = pending.map(({ manifest, runDir }) => `${manifest.runId} (${runDir})`).join(", ");

console.error(
  `${label} ${names}: every unit is closed, but teardown is not recorded.\n\n` +
    "If you neither dispatched this work nor were dispatched into it, it is\n" +
    "not yours to act on — say so and stop again.\n\n" +
    "Otherwise, before this run's directory is deleted:\n" +
    "  1. Triage every board entry in <run-dir>/notes/ — promote each one to a\n" +
    "     known-issue, an ADR, or the adapter, or discard it with a one-line reason.\n" +
    "     (See the promotion table in .claude/protocol/ADAPTER.md.)\n" +
    "  2. Report the teardown categories and get a per-category yes before\n" +
    "     deleting: run directory, worktrees, branches, launch config entries,\n" +
    "     stray containers and held ports.\n" +
    "  3. Record the teardown timestamp in the manifest to silence this.\n\n" +
    "If you are stopping for another reason, say so and stop again.",
);

process.exit(2);
