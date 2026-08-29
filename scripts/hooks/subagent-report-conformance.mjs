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

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// A required label must appear as an actual heading — at the start of a
// line, followed by whitespace or end-of-line — not merely as a substring
// anywhere in the report. `text.includes(heading)` (the previous check) let
// a report that never wrote the section but happened to quote its label in
// a sentence pass conformance, which defeats the one thing this hook exists
// to enforce. Labels are escaped rather than interpolated raw: today's list
// is regex-safe, but it will be edited later by someone who doesn't know
// that, and an unescaped label could silently become a broader pattern.
function hasHeading(text, label) {
  return new RegExp(`^${escapeRegExp(label)}(?:\\s|$)`, "m").test(text);
}

const payload = parseStdin(await readAll(process.stdin));
if (!payload || typeof payload !== "object") process.exit(0);

// Without this guard the block below re-fires forever: exiting 2 causes
// SubagentStop to fire again with stop_hook_active set, and a hook that
// doesn't check it would block that retry too, forever. Must be checked
// before anything else that could exit 2.
if (payload.stop_hook_active) process.exit(0);

// KI-62, settled by measurement rather than by reading. Two concurrent
// subagents were run with this hook instrumented; at BOTH SubagentStop events
// `payload.transcript_path` was the PARENT session's transcript — the same
// path for both units — and the last assistant text block in it was an
// unrelated message from the orchestrator's own earlier turn. The hook found
// no "## Exit:" heading and silently exited 0, twice. It was not checking the
// wrong unit's report; it was not checking any report at all.
//
// The entry's hypothesis (interleaved sidechains) was close but wrong in a way
// that matters: the units' entries were not in the parent transcript to
// interleave. Each unit gets its OWN file, and the payload names it.
//
// Two payload fields make this unambiguous, both scoped to the stopping unit:
//
//   - `last_assistant_message` — the unit's final message, verbatim, as a
//     string. This is exactly what the hook wants and needs no file read, no
//     backwards walk, and no way to pick up a neighbour's text. Preferred.
//   - `agent_transcript_path` — that unit's own transcript file
//     (`<session>/subagents/agent-<id>.jsonl`). Distinct per unit.
//
// `transcript_path` is kept only as a last-resort fallback for a Claude Code
// build that supplies neither of the above. It is known to select the wrong
// text when subagents are involved, so it is tried last, never first.
function lastAssistantText(file) {
  const raw = readFileSync(file, "utf8").trim();
  // `"".split("\n")` yields `[""]`, whose JSON.parse throws into the `continue`
  // below, so an empty transcript needs no special case (KI-63: the `raw ? …`
  // ternary this replaces was dead weight).
  const lines = raw.split("\n");
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
    if (candidate.trim()) return candidate;
  }
  return "";
}

let text = "";
if (typeof payload.last_assistant_message === "string") {
  text = payload.last_assistant_message;
} else {
  const files = [payload.agent_transcript_path, payload.transcript_path].filter(
    (f) => typeof f === "string" && f,
  );
  for (const file of files) {
    try {
      text = lastAssistantText(file);
    } catch {
      // Missing file or a permission error — the hook must not block a
      // subagent's stop because it could not read its own transcript.
      // (KI-63: this comment used to also claim "non-UTF8 content", which
      // `readFileSync(…, "utf8")` does not throw on — it substitutes U+FFFD.)
      continue;
    }
    if (text) break;
  }
}

if (!/^##\s*Exit:/m.test(text)) process.exit(0);

// KI-63: with two "## Exit:" headings the FIRST used to govern silently, so a
// report that quoted the template's `## Exit: DONE` above its own
// `## Exit: BLOCKED` was validated as DONE and never asked for the two extra
// sections BLOCKED requires. Collect every heading instead: one is the normal
// case, several that agree is harmless, and several that DISAGREE is a real
// ambiguity the unit has to resolve rather than a coin toss the hook makes.
const states = [...text.matchAll(/^##\s*Exit:\s*(DONE|BLOCKED|DESCOPED)\s*$/gm)].map(
  (m) => m[1],
);
const distinct = [...new Set(states)];
const missing = [];

if (distinct.length === 0) {
  missing.push('"## Exit: <state>" naming exactly one of DONE | BLOCKED | DESCOPED');
} else if (distinct.length > 1) {
  missing.push(
    `a single "## Exit: <state>" — this report declares ${distinct.join(" and ")}, ` +
      "so which one governs is ambiguous",
  );
}

const required = [
  ...REQUIRED,
  // If BLOCKED is declared at all, its two extra sections are required — an
  // ambiguous report must not shed them by listing DONE first.
  ...(distinct.includes("BLOCKED") ? BLOCKED_EXTRA : []),
];

for (const heading of required) {
  if (!hasHeading(text, heading)) missing.push(heading);
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
