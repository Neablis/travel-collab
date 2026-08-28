import { readFileSync } from "node:fs";
import { parseStdin, readAll } from "./lib/run-context.mjs";

// SubagentStop hook. Checks that a unit's final report has the sections
// REPORT-TEMPLATE.md requires, and blocks (exit 2) with the gaps named if not.
//
// Two deliberate limits:
//
// 1. This validates SHAPE, NOT TRUTH. It can force an "Acceptance checks"
//    section to exist; it cannot make the output pasted into it real. That is
//    still worth having — the verification failures this guards against were
//    silent omissions, not fabricated evidence.
// 2. It only engages when the final message has an "## Exit:" heading.
//    SubagentStop fires for every subagent, including ones outside any
//    protocol run; enforcing unconditionally would push unrelated agents into
//    writing fake reports. A MISSING report is caught by the orchestrator's
//    close step in /dispatch, not here.

const REQUIRED = [
  "## Unit",
  "## Files touched",
  "## Acceptance checks",
  "## Evidence gaps",
  "## Findings left alone",
  "## Board entries written",
  "## Teardown",
];

const BLOCKED_EXTRA = ["## Blocker", "## Tree state"];

const payload = parseStdin(await readAll(process.stdin));
if (!payload || typeof payload !== "object") process.exit(0);

// Without this guard the block below re-fires forever: exiting 2 causes
// SubagentStop to fire again with stop_hook_active set, and a hook that
// doesn't check it would block that retry too, forever. Must be checked
// before anything else that could exit 2.
if (payload.stop_hook_active) process.exit(0);
if (typeof payload.transcript_path !== "string" || !payload.transcript_path) process.exit(0);

let text = "";
try {
  const raw = readFileSync(payload.transcript_path, "utf8").trim();
  const lines = raw ? raw.split("\n") : [];
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    let entry;
    try {
      entry = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    if (entry?.type !== "assistant") continue;
    const content = entry?.message?.content;
    const candidate = Array.isArray(content)
      ? content
          .filter((b) => b?.type === "text" && typeof b.text === "string")
          .map((b) => b.text)
          .join("\n")
      : typeof content === "string"
        ? content
        : "";
    // A thinking-only assistant entry (no text block, or a blank one) is not
    // the report — the model can legitimately end a turn on bare reasoning.
    // Keep walking backwards past it rather than treating its absence of
    // text as "no report" and silently no-opping on the transcript's actual
    // final report, one or more entries earlier.
    if (candidate.trim()) {
      text = candidate;
      break;
    }
  }
} catch {
  // Missing file, permission error, non-UTF8 content — the hook must not
  // block a subagent's stop because it could not read its own transcript.
  process.exit(0);
}

if (!/^##\s*Exit:/m.test(text)) process.exit(0);

const stateMatch = text.match(/^##\s*Exit:\s*(DONE|BLOCKED|DESCOPED)\s*$/m);
const missing = [];

if (!stateMatch) {
  missing.push('"## Exit: <state>" naming exactly one of DONE | BLOCKED | DESCOPED');
}

const required = [
  ...REQUIRED,
  ...(stateMatch?.[1] === "BLOCKED" ? BLOCKED_EXTRA : []),
];

for (const heading of required) {
  if (!text.includes(heading)) missing.push(heading);
}

if (missing.length > 0) {
  console.error(
    "Your final report does not conform to .claude/protocol/REPORT-TEMPLATE.md.\n\n" +
      `Missing:\n  ${missing.join("\n  ")}\n\n` +
      "Re-emit the full report with these sections. \"Evidence gaps\" may say " +
      "\"none\", but it may not be absent — a stated gap is a fine outcome, a " +
      "silent one is not.",
  );
  process.exit(2);
}

process.exit(0);
