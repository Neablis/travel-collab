// Tests for scripts/session-metrics.mjs.
//
// These cover the three places the script can silently produce a WRONG
// baseline rather than an obviously broken one — which matters more here than
// usual, because the output is a number somebody will quote in a review and
// then make a decision against. A crash is self-announcing; a quietly halved
// multiplier is not.
//
//   1. Attribution: a doc read must land in exactly one of the nine sources,
//      and a non-doc read must land in none. Getting this wrong moves tokens
//      between F1 rows without changing the total, which no total-based
//      assertion would catch.
//   2. The requestId dedupe: a streamed assistant response repeats the same
//      `usage` across records. Summing them multiplies the cache figures by
//      the number of content blocks, and the re-read multiplier is the one
//      figure the review states as EXACT rather than estimated.
//   3. The tool_use -> tool_result join: an unjoined call contributes zero
//      chars, so a broken join reports a suspiciously cheap corpus rather
//      than an error.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  classifyDocSource,
  firstArg,
  parseSession,
  computeFindings,
  findTranscripts,
} from "../session-metrics.mjs";

// --- helpers ---------------------------------------------------------------

function assistantToolUse({ requestId, id, name, input, sidechain = false, usage }) {
  return JSON.stringify({
    type: "assistant",
    requestId,
    isSidechain: sidechain,
    timestamp: "2026-09-21T00:00:00Z",
    message: { usage, content: [{ type: "tool_use", id, name, input }] },
  });
}

function toolResult({ id, text, isError = false }) {
  return JSON.stringify({
    type: "user",
    timestamp: "2026-09-21T00:00:01Z",
    message: {
      content: [{ type: "tool_result", tool_use_id: id, content: text, is_error: isError }],
    },
  });
}

function writeCorpus(lines, { name = "session-a.jsonl" } = {}) {
  const root = mkdtempSync(join(tmpdir(), "sm-test-"));
  const dir = join(root, "-Users-someone-travel-collab");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, name);
  writeFileSync(file, lines.join("\n") + "\n");
  return { root, dir, file };
}

// --- 1. attribution --------------------------------------------------------

test("classifyDocSource attributes each of the nine sources, and nothing else", () => {
  assert.equal(classifyDocSource("docs/known-issues/open/KI-1.md"), "known-issues");
  assert.equal(classifyDocSource("docs/plans/foo.md"), "plans");
  assert.equal(classifyDocSource("docs/milestones/M26-design-parity.md"), "milestones");
  assert.equal(classifyDocSource("/repo/AGENTS.md"), "AGENTS.md");
  assert.equal(classifyDocSource("docs/STATUS.md"), "STATUS.md");
  assert.equal(classifyDocSource("sed -n '1,50p' TODO.md"), "TODO.md");
  assert.equal(classifyDocSource("docs/architecture/ADR-041.md"), "architecture");
  assert.equal(classifyDocSource("docs/specs/2026-09-18-map.md"), "specs");
  assert.equal(classifyDocSource("docs/guidelines/testing.md"), "guidelines");

  // Source code and the repo's own README are NOT orientation reading. F1's
  // claim is specifically about the nine state/doc sources.
  assert.equal(classifyDocSource("apps/web/src/server/db/schema.ts"), null);
  assert.equal(classifyDocSource("README.md"), null);
  assert.equal(classifyDocSource("pnpm check"), null);
});

test("a known-issues README is attributed to known-issues, not to a later pattern", () => {
  // First-match-wins is load-bearing: a reordering that let a broader pattern
  // win would move real tokens between F1 rows while leaving the F1 total
  // untouched — invisible to any assertion on the total.
  assert.equal(classifyDocSource("docs/known-issues/README.md"), "known-issues");
});

test("firstArg reaches the key each tool actually carries", () => {
  assert.equal(firstArg({ command: "cat AGENTS.md" }), "cat AGENTS.md");
  assert.equal(firstArg({ file_path: "/x/TODO.md" }), "/x/TODO.md");
  assert.equal(firstArg({ skill: "minimal-check-subset" }), "minimal-check-subset");
  assert.equal(firstArg({ subagent_type: "phase-verifier" }), "phase-verifier");
  assert.equal(firstArg(null), "");
  // Newlines would break the one-call-per-line shape the aggregation assumes.
  assert.equal(firstArg({ command: "a\nb" }), "a b");
});

// --- 2. the requestId dedupe ----------------------------------------------

test("usage is deduped by requestId, so a streamed response is not counted twice", () => {
  const usage = { cache_creation_input_tokens: 1000, cache_read_input_tokens: 51300 };
  const { file } = writeCorpus([
    // One logical response, three records, ONE requestId — the streaming shape.
    assistantToolUse({ requestId: "req-1", id: "t1", name: "Read", input: { file_path: "AGENTS.md" }, usage }),
    assistantToolUse({ requestId: "req-1", id: "t2", name: "Read", input: { file_path: "TODO.md" }, usage }),
    assistantToolUse({ requestId: "req-1", id: "t3", name: "Read", input: { file_path: "docs/STATUS.md" }, usage }),
    toolResult({ id: "t1", text: "x".repeat(40) }),
    toolResult({ id: "t2", text: "x".repeat(40) }),
    toolResult({ id: "t3", text: "x".repeat(40) }),
  ]);

  const findings = computeFindings([parseSession(file)]);

  assert.equal(findings.cache.cacheCreation, 1000, "counted the same request more than once");
  assert.equal(findings.cache.cacheRead, 51300, "counted the same request more than once");
  assert.equal(findings.cache.multiplier.toFixed(1), "51.3");
});

test("distinct requestIds DO accumulate", () => {
  const { file } = writeCorpus([
    assistantToolUse({
      requestId: "req-1", id: "t1", name: "Read", input: { file_path: "AGENTS.md" },
      usage: { cache_creation_input_tokens: 100, cache_read_input_tokens: 200 },
    }),
    assistantToolUse({
      requestId: "req-2", id: "t2", name: "Read", input: { file_path: "TODO.md" },
      usage: { cache_creation_input_tokens: 100, cache_read_input_tokens: 200 },
    }),
    toolResult({ id: "t1", text: "x" }),
    toolResult({ id: "t2", text: "x" }),
  ]);
  const findings = computeFindings([parseSession(file)]);
  assert.equal(findings.cache.cacheCreation, 200);
  assert.equal(findings.cache.cacheRead, 400);
});

// --- 3. the join -----------------------------------------------------------

test("tool_use joins to its tool_result, so F1 charges real chars", () => {
  const { file } = writeCorpus([
    assistantToolUse({
      requestId: "r", id: "t1", name: "Read",
      input: { file_path: "docs/known-issues/open/KI-1.md" },
    }),
    toolResult({ id: "t1", text: "y".repeat(4000) }),
  ]);
  const findings = computeFindings([parseSession(file)]);
  assert.equal(findings.f1.calls, 1);
  assert.equal(findings.f1.chars, 4000, "the join dropped the result size");
  assert.equal(findings.f1.bySource.get("known-issues").chars, 4000);
});

test("browser output is excluded from char totals but counted as calls", () => {
  const { file } = writeCorpus([
    assistantToolUse({
      requestId: "r", id: "t1", name: "mcp__Claude_Browser__computer",
      input: { url: "AGENTS.md" },
    }),
    toolResult({ id: "t1", text: "z".repeat(100000) }), // a base64 screenshot
    assistantToolUse({ requestId: "r2", id: "t2", name: "Read", input: { file_path: "AGENTS.md" } }),
    toolResult({ id: "t2", text: "z".repeat(400) }),
  ]);
  const findings = computeFindings([parseSession(file)]);
  assert.equal(findings.browser.calls, 1);
  assert.equal(findings.browser.mainThread, 1);
  // The 100k screenshot must NOT reach the char-based totals.
  assert.equal(findings.corpus.nonBrowserChars, 400);
  assert.equal(findings.f1.chars, 400);
});

// --- F3 / F4 / F7 ----------------------------------------------------------

test("subagent transcripts are separated from main-thread ones", () => {
  const { root, dir } = writeCorpus(
    [
      assistantToolUse({ requestId: "r", id: "t1", name: "Read", input: { file_path: "AGENTS.md" } }),
      toolResult({ id: "t1", text: "m".repeat(800) }),
    ],
    { name: "main-session.jsonl" }
  );
  writeFileSync(
    join(dir, "agent-abc.jsonl"),
    [
      assistantToolUse({
        requestId: "r2", id: "t2", name: "Read",
        input: { file_path: "AGENTS.md" }, sidechain: true,
      }),
      toolResult({ id: "t2", text: "s".repeat(1200) }),
    ].join("\n") + "\n"
  );

  const findings = computeFindings(findTranscripts(root).map(parseSession));

  assert.equal(findings.corpus.mainSessions, 1);
  assert.equal(findings.corpus.agentSessions, 1);
  // F3 is the SUBAGENT half only; the main session's 800 chars must not be in it.
  assert.equal(findings.f3.chars, 1200);
  // F1 spans the whole corpus.
  assert.equal(findings.f1.chars, 2000);
  rmSync(root, { recursive: true, force: true });
});

test("F3a counts briefs that name a doc source — R3's target", () => {
  const { file } = writeCorpus([
    assistantToolUse({
      requestId: "r", id: "t1", name: "Agent",
      input: {
        subagent_type: "phase-implementer",
        prompt: "Read AGENTS.md first, then check docs/known-issues.",
      },
    }),
    toolResult({ id: "t1", text: "done" }),
  ]);
  const findings = computeFindings([parseSession(file)]);
  assert.equal(findings.f3a.dispatches, 1);
  assert.equal(findings.f3a.mentioning.get("AGENTS.md"), 1);
  assert.equal(findings.f3a.mentioning.get("known-issues"), 1);
  assert.equal(findings.f4.get("phase-implementer"), 1);
});

test("F7 reports the zero-overlap case the 2026-09-02 review found", () => {
  const { root, dir } = writeCorpus(
    [
      // A session that ran the full check and never consulted the skill.
      assistantToolUse({ requestId: "r", id: "t1", name: "Bash", input: { command: "pnpm check" } }),
      toolResult({ id: "t1", text: "c".repeat(2000) }),
    ],
    { name: "manual.jsonl" }
  );
  writeFileSync(
    join(dir, "skilled.jsonl"),
    [
      assistantToolUse({
        requestId: "r2", id: "t2", name: "Skill", input: { skill: "minimal-check-subset" },
      }),
      toolResult({ id: "t2", text: "ok" }),
    ].join("\n") + "\n"
  );

  const findings = computeFindings(findTranscripts(root).map(parseSession));
  const row = findings.f7.find((f) => f.skill === "minimal-check-subset");
  assert.equal(row.skillSessions, 1);
  assert.equal(row.manualSessions, 1);
  assert.equal(row.overlap, 0, "these two sessions must not be counted as overlapping");
  rmSync(root, { recursive: true, force: true });
});

test("a truncated final line does not abort the file", () => {
  const root = mkdtempSync(join(tmpdir(), "sm-test-"));
  const dir = join(root, "-Users-x-travel-collab");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "partial.jsonl");
  writeFileSync(
    file,
    assistantToolUse({ requestId: "r", id: "t1", name: "Read", input: { file_path: "TODO.md" } }) +
      "\n" +
      toolResult({ id: "t1", text: "q".repeat(120) }) +
      '\n{"type":"assistant","message":{"content":[{"type":"tool_u'
  );
  const findings = computeFindings([parseSession(file)]);
  assert.equal(findings.f1.calls, 1);
  assert.equal(findings.f1.chars, 120);
  rmSync(root, { recursive: true, force: true });
});
