import { ask, loadAdapter, parseStdin, readAll, unitForCwd } from "./lib/run-context.mjs";

// PreToolUse hook (matcher: Bash). The real serialization points in a parallel
// run are resources, not files: two units running the integration suite share
// one database and produce a different random subset of failures each run — a
// symptom that reads as flakiness and costs hours. The manifest names one
// holder per exclusive resource; this asks before a second unit takes it.

const payload = parseStdin(await readAll(process.stdin));
if (!payload || typeof payload !== "object") process.exit(0);

const cwd = payload.cwd ?? process.cwd();
const command = payload?.tool_input?.command;
// `!command` alone screens falsy but not a truthy non-string (e.g. an object
// or array slipped into tool_input) — the same class of bug review caught in
// the file-scope hook's `file_path` handling (Task 3). Guard the type too.
if (typeof command !== "string" || !command) process.exit(0);

const found = unitForCwd(cwd);
if (!found) process.exit(0);

const adapter = loadAdapter(cwd);
if (!Array.isArray(adapter?.exclusiveCommands)) process.exit(0);

const leases = found.manifest.resources ?? {};

for (const entry of adapter.exclusiveCommands) {
  // A non-object entry, or one missing `pattern`, must not reach `new RegExp`
  // below: `new RegExp(undefined)` does not throw — it silently compiles to
  // `/(?:)/`, which matches every string, turning a malformed adapter entry
  // into an ask on every single Bash command instead of failing open.
  if (!entry || typeof entry !== "object" || typeof entry.pattern !== "string") continue;

  // KI-63: `resource` and `symptom` are interpolated into the `ask` message
  // below, and `resource` is also used as a key into `leases`. Both were
  // previously unvalidated, so an adapter entry whose `resource` or `symptom`
  // is an object with a non-callable `toString`/`valueOf` threw a TypeError
  // ("Cannot convert object to primitive value") straight out of a PreToolUse
  // hook — which breaks every Bash command in the repo until someone finds
  // the adapter file. A merely missing field is harmless (it coerces to
  // "undefined"), which is why this needs a deliberately pathological input
  // and was judged safe to leave; it is still the wrong failure direction for
  // a library whose whole contract is to fail open on shapes it cannot read.
  if (typeof entry.resource !== "string" || !entry.resource) continue;
  if (typeof entry.symptom !== "string") continue;

  let pattern;
  try {
    pattern = new RegExp(entry.pattern);
  } catch {
    continue; // a bad pattern in the adapter must not block work
  }
  if (!pattern.test(command)) continue;

  const holder = leases[entry.resource];
  if (!holder || holder === found.unit.id) continue;

  ask(
    "PreToolUse",
    `This command claims the exclusive resource "${entry.resource}", which run ` +
      `${found.manifest.runId} leases to unit "${holder}" — not "${found.unit.id}".\n\n` +
      `${entry.symptom}\n\n` +
      "Coordinate through the orchestrator rather than taking it now. Waiting is " +
      "cheaper than the failure this produces.",
  );
  break;
}

process.exit(0);
