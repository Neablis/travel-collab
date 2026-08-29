import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runHook } from "./fixture.mjs";

// The hook reads the subagent's final assistant message out of the transcript
// JSONL, so the fixture writes a transcript rather than a report string.
function transcriptWith(text) {
  const dir = mkdtempSync(join(tmpdir(), "tc-transcript-"));
  const path = join(dir, "transcript.jsonl");
  writeFileSync(path, [
    JSON.stringify({ type: "user", message: { content: "go" } }),
    JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text }] } }),
  ].join("\n"));
  return path;
}

// Writes an arbitrary sequence of JSONL lines, for tests that need to shape
// entries transcriptWith() cannot (extra blocks, extra entries, etc.).
function transcriptOf(entries) {
  const dir = mkdtempSync(join(tmpdir(), "tc-transcript-"));
  const path = join(dir, "transcript.jsonl");
  writeFileSync(path, entries.map((e) => JSON.stringify(e)).join("\n"));
  return path;
}

const COMPLETE_DONE = `## Exit: DONE

## Unit
u1 — do the thing

## Files touched
- src/a.ts — did it

## Acceptance checks
- \`node --test\`
  ok 3
  PASS

## Evidence gaps
none

## Findings left alone
none

## Board entries written
none

## Teardown
nothing created
`;

test("a complete DONE report passes", () => {
  const res = runHook("subagent-report-conformance.mjs", {
    transcript_path: transcriptWith(COMPLETE_DONE),
    stop_hook_active: false,
  });
  assert.equal(res.status, 0);
});

test("a report missing Evidence gaps is blocked and told which section", () => {
  const res = runHook("subagent-report-conformance.mjs", {
    transcript_path: transcriptWith(COMPLETE_DONE.replace("## Evidence gaps\nnone\n", "")),
    stop_hook_active: false,
  });
  assert.equal(res.status, 2);
  assert.match(res.stderr, /## Evidence gaps/);
});

test("omitting a required section but quoting its label in prose is still blocked", () => {
  // Verified against production: a report that never has "## Evidence gaps"
  // as an actual heading, but merely mentions the string in a sentence,
  // passed (exit 0) because the old check was `text.includes(heading)` —
  // a substring match anywhere in the report, not a heading match. Enforcing
  // report shape is this hook's entire job, and quoting the label instead of
  // writing the section is exactly what a skipped section looks like.
  const quotedNotHeading = COMPLETE_DONE.replace(
    "## Evidence gaps\nnone\n",
    "I have no gaps; see \"## Evidence gaps\" mentioned in the template for context.\n",
  );
  const res = runHook("subagent-report-conformance.mjs", {
    transcript_path: transcriptWith(quotedNotHeading),
    stop_hook_active: false,
  });
  assert.equal(res.status, 2);
  assert.match(res.stderr, /## Evidence gaps/);
});

test("a BLOCKED report also requires Blocker and Tree state", () => {
  const blocked = COMPLETE_DONE.replace("## Exit: DONE", "## Exit: BLOCKED");
  const res = runHook("subagent-report-conformance.mjs", {
    transcript_path: transcriptWith(blocked),
    stop_hook_active: false,
  });
  assert.equal(res.status, 2);
  assert.match(res.stderr, /## Blocker/);
  assert.match(res.stderr, /## Tree state/);
});

test("an invented exit state is rejected", () => {
  const res = runHook("subagent-report-conformance.mjs", {
    transcript_path: transcriptWith(COMPLETE_DONE.replace("## Exit: DONE", "## Exit: MOSTLY DONE")),
    stop_hook_active: false,
  });
  assert.equal(res.status, 2);
  assert.match(res.stderr, /DONE \| BLOCKED \| DESCOPED/);
});

test("a non-protocol subagent is left alone", () => {
  const res = runHook("subagent-report-conformance.mjs", {
    transcript_path: transcriptWith("I searched the codebase and found three call sites."),
    stop_hook_active: false,
  });
  assert.equal(res.status, 0);
});

test("stop_hook_active short-circuits so the hook cannot loop", () => {
  // "## Exit: DONE\n" alone is missing every other required section, so
  // absent the guard this report would fail conformance and exit 2 — which
  // is exactly the case that would re-trigger SubagentStop forever if
  // stop_hook_active weren't checked first. A complete report would pass
  // regardless of the guard, so it wouldn't prove anything; this does.
  const res = runHook("subagent-report-conformance.mjs", {
    transcript_path: transcriptWith("## Exit: DONE\n"),
    stop_hook_active: true,
  });
  assert.equal(res.status, 0);
});

test("an unreadable transcript fails open", () => {
  const res = runHook("subagent-report-conformance.mjs", {
    transcript_path: "/nonexistent/transcript.jsonl",
    stop_hook_active: false,
  });
  assert.equal(res.status, 0);
});

// --- Realistic transcript shapes -------------------------------------------
//
// A real transcript's assistant entries carry an array of blocks that can mix
// `thinking` and `text` types, and the very last assistant entry can
// legitimately be thinking-only (e.g. the model reasons after its last reply
// tool-call settles, before the turn ends). A backwards walk that only checks
// "is this an assistant entry" without also checking "did it produce text"
// would treat a thinking-only tail as the report and silently no-op.

test("a final assistant entry mixing thinking and text is read correctly", () => {
  const path = transcriptOf([
    { type: "user", message: { content: "go" } },
    {
      type: "assistant",
      message: {
        content: [
          { type: "thinking", text: "Let me assemble the report." },
          { type: "text", text: COMPLETE_DONE },
        ],
      },
    },
  ]);
  const res = runHook("subagent-report-conformance.mjs", {
    transcript_path: path,
    stop_hook_active: false,
  });
  assert.equal(res.status, 0);
});

test("a thinking-only final entry falls back to the prior assistant text", () => {
  const path = transcriptOf([
    { type: "user", message: { content: "go" } },
    { type: "assistant", message: { content: [{ type: "text", text: COMPLETE_DONE }] } },
    { type: "assistant", message: { content: [{ type: "thinking", text: "done." }] } },
  ]);
  const res = runHook("subagent-report-conformance.mjs", {
    transcript_path: path,
    stop_hook_active: false,
  });
  assert.equal(res.status, 0);
});

test("a thinking-only final entry still catches an incomplete prior report", () => {
  const path = transcriptOf([
    { type: "user", message: { content: "go" } },
    {
      type: "assistant",
      message: {
        content: [{ type: "text", text: COMPLETE_DONE.replace("## Evidence gaps\nnone\n", "") }],
      },
    },
    { type: "assistant", message: { content: [{ type: "thinking", text: "done." }] } },
  ]);
  const res = runHook("subagent-report-conformance.mjs", {
    transcript_path: path,
    stop_hook_active: false,
  });
  assert.equal(res.status, 2);
  assert.match(res.stderr, /## Evidence gaps/);
});

// --- KI-62: which unit's report does the hook actually read? ----------------
//
// Settled by measurement, not by reading. Two concurrent subagents were run
// with this hook instrumented. At BOTH SubagentStop events `transcript_path`
// was the PARENT session's transcript — the same path for both units — and
// its last assistant text block was an unrelated message from the
// orchestrator's own earlier turn. The hook found no "## Exit:" heading and
// silently exited 0 for both. It was not checking the wrong unit's report; it
// was not checking any report at all.
//
// The payload carries two per-unit fields that make this unambiguous:
// `last_assistant_message` (the unit's final message, verbatim) and
// `agent_transcript_path` (that unit's own transcript file). These pin the
// precedence between them and the now-last-resort `transcript_path`.

/**
 * The shape the reproduction actually produced: a parent transcript whose
 * final assistant text belongs to the orchestrator, not to any unit.
 */
const PARENT_NOISE = "Five cloud agents running, 19 of 34 open KIs, five PRs.";

test("KI-62: last_assistant_message wins over a parent transcript's unrelated text", () => {
  const res = runHook("subagent-report-conformance.mjs", {
    transcript_path: transcriptWith(PARENT_NOISE),
    last_assistant_message: COMPLETE_DONE.replace("## Evidence gaps\nnone\n", ""),
    stop_hook_active: false,
  });
  // Without the fix this exits 0 (no "## Exit:" in the parent noise) and the
  // incomplete report ships unchecked. That silent no-op IS the bug.
  assert.equal(res.status, 2);
  assert.match(res.stderr, /## Evidence gaps/);
});

test("KI-62: a conforming report in last_assistant_message passes", () => {
  const res = runHook("subagent-report-conformance.mjs", {
    transcript_path: transcriptWith(PARENT_NOISE),
    last_assistant_message: COMPLETE_DONE,
    stop_hook_active: false,
  });
  assert.equal(res.status, 0);
});

test("KI-62: agent_transcript_path is read in preference to transcript_path", () => {
  const res = runHook("subagent-report-conformance.mjs", {
    transcript_path: transcriptWith(PARENT_NOISE),
    agent_transcript_path: transcriptWith(
      COMPLETE_DONE.replace("## Board entries written\nnone\n", ""),
    ),
    stop_hook_active: false,
  });
  assert.equal(res.status, 2);
  assert.match(res.stderr, /## Board entries written/);
});

test("KI-62: an unreadable agent_transcript_path falls back to transcript_path", () => {
  const res = runHook("subagent-report-conformance.mjs", {
    transcript_path: transcriptWith(COMPLETE_DONE.replace("## Teardown\nnothing created\n", "")),
    agent_transcript_path: "/nonexistent/agent.jsonl",
    stop_hook_active: false,
  });
  assert.equal(res.status, 2);
  assert.match(res.stderr, /## Teardown/);
});

test("KI-62: two concurrent units are each judged on their own report", () => {
  // The reproduction's exact shape: one parent transcript, two units, one
  // conforming and one not. Reading `transcript_path` cannot tell them apart;
  // reading each unit's own final message can.
  const parent = transcriptWith(PARENT_NOISE);
  const alpha = runHook("subagent-report-conformance.mjs", {
    transcript_path: parent,
    last_assistant_message: COMPLETE_DONE,
    stop_hook_active: false,
  });
  const bravo = runHook("subagent-report-conformance.mjs", {
    transcript_path: parent,
    last_assistant_message: COMPLETE_DONE.replace("## Acceptance checks", "## Checks I ran"),
    stop_hook_active: false,
  });
  assert.equal(alpha.status, 0);
  assert.equal(bravo.status, 2);
  assert.match(bravo.stderr, /## Acceptance checks/);
});

// --- KI-63: two "## Exit:" headings ----------------------------------------

test("KI-63: a quoted DONE above a real BLOCKED no longer sheds BLOCKED's sections", () => {
  // The first heading used to govern silently, so this validated as DONE and
  // never asked for Blocker / Tree state.
  const twoStates = `## Exit: DONE\n\n${COMPLETE_DONE.replace("## Exit: DONE", "## Exit: BLOCKED")}`;
  const res = runHook("subagent-report-conformance.mjs", {
    last_assistant_message: twoStates,
    stop_hook_active: false,
  });
  assert.equal(res.status, 2);
  assert.match(res.stderr, /ambiguous/);
  assert.match(res.stderr, /## Blocker/);
  assert.match(res.stderr, /## Tree state/);
});

test("KI-63: repeating the SAME exit state is not treated as ambiguous", () => {
  const repeated = `## Exit: DONE\n\n${COMPLETE_DONE}`;
  const res = runHook("subagent-report-conformance.mjs", {
    last_assistant_message: repeated,
    stop_hook_active: false,
  });
  assert.equal(res.status, 0);
});
