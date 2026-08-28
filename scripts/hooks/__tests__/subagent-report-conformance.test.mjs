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
