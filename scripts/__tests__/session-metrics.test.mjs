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
  DOC_SOURCES,
  median,
  classifyDocSource,
  firstArg,
  parseSession,
  computeFindings,
  findTranscripts,
  callUnits,
  callContext,
  classifyTurn,
  parseMilestoneTranscript,
  loadMilestone,
  computeMilestone,
  findRewrites,
  readGuardLog,
  renderMilestone,
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

test("a brief using ordinary English does NOT count as naming a doc source", () => {
  // CodeRabbit, PR #199: the mention regex was built from the row NAME, so
  // "prepare implementation plans" counted as naming docs/plans, and
  // "architecture" / "guidelines" in prose counted too — inflating the exact
  // number R3 is argued from.
  const prose = "Prepare implementation plans, follow the guidelines, respect the architecture, and review the specs.";
  const hits = DOC_SOURCES.filter(([, , mention]) => mention.test(prose)).map(([n]) => n);
  assert.deepEqual(hits, [], `prose matched: ${hits.join(", ")}`);
});

test("a brief naming sources the way people actually write them DOES count", () => {
  // Reusing the path pattern for briefs would under-count instead: the
  // 2026-09-02 review's own F3a counted 66 briefs saying "known-issues", not
  // "docs/known-issues".
  const brief = "Read AGENTS.md, grep known-issues, then check docs/plans and ADR-041.";
  const hits = DOC_SOURCES.filter(([, , mention]) => mention.test(brief)).map(([n]) => n).sort();
  assert.deepEqual(hits, ["AGENTS.md", "architecture", "known-issues", "plans"]);
});

test("median is the LOWER of two middles, matching the repo's own definition", () => {
  // revenue.ts:146 — "The middle value, or the lower of the two middles."
  // F2 and F3a call their figure a median, so it must be the same median.
  assert.equal(median([1, 2, 3, 4]), 2, "upper middle would be 3");
  assert.equal(median([1, 2, 3]), 2);
  assert.equal(median([]), 0);
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

// --- --milestone: one milestone's spend ------------------------------------
//
// docs/retros/2026-10-12-m42-token-spend-retro.md is the baseline every later
// milestone is compared with, so what is tested here is that each number is
// computed THE RETRO'S WAY (its section 2). A figure that is merely plausible
// is the failure: nobody re-derives a retro table by hand.

function usage(input, cacheCreation, cacheRead) {
  return {
    input_tokens: input,
    cache_creation_input_tokens: cacheCreation,
    cache_read_input_tokens: cacheRead,
    output_tokens: 3,
  };
}

/** One assistant record. A streamed message is several of these with one id. */
function call(id, u, tools = []) {
  return JSON.stringify({
    type: "assistant",
    message: {
      id,
      role: "assistant",
      usage: u,
      content: tools.map((name, i) => ({ type: "tool_use", id: `${id}-t${i}`, name, input: {} })),
    },
  });
}

function said(text) {
  return JSON.stringify({ type: "user", message: { role: "user", content: text } });
}

function toolReturned(id) {
  return JSON.stringify({
    type: "user",
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: "ok" }] },
  });
}

/** An orchestrator transcript plus `<name>/subagents/agent-*.jsonl` beside it. */
function writeMilestone(orchestrator, subagents = {}) {
  const root = mkdtempSync(join(tmpdir(), "sm-milestone-"));
  const transcript = join(root, "session-m43.jsonl");
  writeFileSync(transcript, orchestrator.join("\n") + "\n");
  const dir = join(root, "session-m43", "subagents");
  mkdirSync(dir, { recursive: true });
  for (const [name, { lines, meta }] of Object.entries(subagents)) {
    writeFileSync(join(dir, `${name}.jsonl`), lines.join("\n") + "\n");
    if (meta) writeFileSync(join(dir, `${name}.meta.json`), JSON.stringify(meta));
  }
  return { root, transcript };
}

const WAKE = '<wake reason="external-event">check_suite.completed</wake>';

test("units are input + 1.25 x cache write + 0.1 x cache read, and context is their plain sum", () => {
  const u = { input: 100, cacheCreation: 1_000, cacheRead: 10_000 };
  assert.equal(callUnits(u), 100 + 1_250 + 1_000);
  assert.equal(callContext(u), 11_100);
});

test("a streamed message logged once per content block is ONE call, by message.id", () => {
  // Three records, one id: the retro's 3,923 calls would have been ~10,000,
  // and every units figure with them, if these were summed.
  const { root, transcript } = writeMilestone([
    said("Build M43"),
    call("msg_1", usage(100, 1_000, 10_000), ["Read"]),
    call("msg_1", usage(100, 1_000, 10_000), ["Bash"]),
    call("msg_1", usage(100, 1_000, 10_000)),
    call("msg_2", usage(10, 0, 20_000)),
  ]);
  const m = computeMilestone(loadMilestone(transcript));
  assert.equal(m.totals.calls, 2);
  assert.equal(m.totals.units, 2_350 + 2_010);
  const orch = m.byType.find((t) => t.agentType === "orchestrator");
  assert.equal(orch.avgContext, (11_100 + 20_010) / 2);
  assert.equal(orch.peakContext, 20_010);
  rmSync(root, { recursive: true, force: true });
});

test("agents are grouped by the type in .meta.json, and a subagent without one is `unknown`", () => {
  // The retro's own script labelled a meta-less file "orchestrator", which
  // would fold a subagent into the one share the first target is about.
  const { root, transcript } = writeMilestone(
    [said("Build M43"), call("o1", usage(0, 0, 1_000))],
    {
      "agent-a": {
        lines: [said("brief"), call("a1", usage(0, 0, 4_000))],
        meta: { agentType: "phase-implementer", description: "Build M43 part 1" },
      },
      "agent-b": {
        lines: [said("brief"), call("b1", usage(0, 0, 3_000))],
        meta: { agentType: "phase-implementer", description: "Build M43 part 2" },
      },
      "agent-c": { lines: [said("brief"), call("c1", usage(0, 0, 2_000))] },
    },
  );
  const m = computeMilestone(loadMilestone(transcript));
  const types = Object.fromEntries(m.byType.map((t) => [t.agentType, t]));
  assert.deepEqual(Object.keys(types).sort(), ["orchestrator", "phase-implementer", "unknown"]);
  assert.equal(types["phase-implementer"].agents, 2);
  assert.equal(types["phase-implementer"].units, 700);
  assert.equal(types.unknown.units, 200);
  assert.equal(types.orchestrator.units, 100);
  assert.equal(types.orchestrator.share, 0.1);
  assert.deepEqual(m.costliest.map((a) => a.description), ["Build M43 part 1", "Build M43 part 2", "agent-c"]);
  rmSync(root, { recursive: true, force: true });
});

test("each turn is classified by what started it, and its calls' units land on that class", () => {
  const { root, transcript } = writeMilestone([
    said("Build M43 please"),
    call("o1", usage(0, 0, 10_000), ["Agent"]),
    toolReturned("o1-t0"),
    // A tool_result is NOT a turn start: o2 still belongs to the human turn.
    call("o2", usage(0, 0, 10_000)),
    said(WAKE),
    call("o3", usage(0, 0, 20_000), ["ReadNotifications"]),
    said("<task-notification>agent-a finished</task-notification>"),
    call("o4", usage(0, 0, 30_000)),
    said("<agent-message from=\"agent-a\">PR opened</agent-message>"),
    call("o5", usage(0, 0, 40_000)),
    said("<system-reminder>todo list is empty</system-reminder>"),
    call("o6", usage(0, 0, 50_000)),
  ]);
  const m = computeMilestone(loadMilestone(transcript));
  const by = Object.fromEntries(m.turns.classes.map((c) => [c.cls, [c.turns, c.units]]));
  assert.deepEqual(by, {
    github: [1, 2_000],
    "subagent-report": [1, 4_000],
    "subagent-finished": [1, 3_000],
    harness: [1, 5_000],
    human: [1, 2_000],
    other: [0, 0],
  });
  rmSync(root, { recursive: true, force: true });
});

test("a notification turn is idle only if it used nothing beyond ReadNotifications or ToolSearch", () => {
  const { root, transcript } = writeMilestone([
    said(WAKE),
    call("o1", usage(0, 0, 10_000), ["ReadNotifications"]),
    said(WAKE),
    call("o2", usage(0, 0, 10_000), ["ToolSearch", "mcp__github__ReadNotifications"]),
    said(WAKE),
    call("o3", usage(0, 0, 10_000), ["ReadNotifications"]),
    toolReturned("o3-t0"),
    call("o4", usage(0, 0, 10_000), ["Bash"]),
    said("there are 2 notifications pending"),
    call("o5", usage(0, 0, 10_000)),
  ]);
  const github = computeMilestone(loadMilestone(transcript)).turns.classes.find((c) => c.cls === "github");
  assert.equal(github.turns, 4);
  assert.equal(github.idle, 3, "the turn that went on to run Bash did work");
  assert.equal(github.idleUnits, 3_000);
  rmSync(root, { recursive: true, force: true });
});

test("an unrecognised frame is counted as `other`, never as human, and the block says so", () => {
  // The patterns were written from the retro's prose, not from a transcript.
  // If one is wrong, this is the row that has to show it: merged into
  // `human`, a missed frame would read as Mitchell typing 190 times.
  assert.equal(classifyTurn("<mystery-frame>payload</mystery-frame>"), "other");
  assert.equal(classifyTurn(""), "other");
  assert.equal(classifyTurn("<system-reminder>x</system-reminder>\n<new-thing/>"), "other");
  assert.equal(classifyTurn("<system-reminder>x</system-reminder>\nmerge it"), "human");
  // The shape CodeQL flagged on PR 418 when this was one pattern: a long run of
  // reminders with a non-reminder tail must classify at once, not backtrack.
  const run = "<system-reminder>x</system-reminder>".repeat(5000);
  const started = Date.now();
  assert.equal(classifyTurn(`${run}\n \n`), "harness");
  assert.equal(classifyTurn(`${run}!`), "human");
  assert.ok(Date.now() - started < 1000, "classifying a run of reminders is linear");
  assert.equal(classifyTurn("the hook output is wrong, look again"), "human");

  const { root, transcript } = writeMilestone([
    said("<mystery-frame>payload text that must not be printed</mystery-frame>"),
    call("o1", usage(0, 0, 10_000)),
    said("go on"),
    call("o2", usage(0, 0, 10_000)),
  ]);
  const m = computeMilestone(loadMilestone(transcript));
  const by = Object.fromEntries(m.turns.classes.map((c) => [c.cls, c.turns]));
  assert.equal(by.other, 1);
  assert.equal(by.human, 1);
  const out = renderMilestone(m);
  assert.match(out, /\| Other \(unrecognised frame\) \| 1 \|/);
  assert.match(out, /`<mystery-frame>` × 1/);
  assert.doesNotMatch(out, /payload text/, "the frame's NAME is reported, never its contents");
  rmSync(root, { recursive: true, force: true });
});

test("a full cache re-write is a later call over 50k that is at least 80% freshly written", () => {
  const { rewrites, coordinatorMessages } = findRewrites(
    parseMilestoneTranscriptFrom([
      // A brief that QUOTES the frame is not a follow-up: this session's own
      // briefs did, and each was counted as one.
      said("brief: count the turns that open with The coordinator sent a message"),
      // The first call writes its whole context by definition: not a re-write.
      call("a1", usage(0, 60_000, 0)),
      call("a2", usage(0, 2_000, 98_000)),
      said("a long tool result ".repeat(20) + "The coordinator sent a message, the retro says"),
      said("The coordinator sent a message while you were working: fix the review findings"),
      call("a3", usage(0, 90_000, 10_000)),
      // Exactly 80% counts; 79% does not; nor does a small context, however fresh.
      call("a4", usage(0, 80_000, 20_000), ["Bash"]),
      toolReturned("a4-t0"),
      call("a5", usage(0, 79_000, 21_000)),
      call("a6", usage(0, 40_000, 0)),
    ]),
  );
  assert.equal(coordinatorMessages, 1);
  assert.deepEqual(rewrites, [
    { tokens: 90_000, afterCoordinator: true },
    { tokens: 80_000, afterCoordinator: false },
  ]);
});

function parseMilestoneTranscriptFrom(lines) {
  const { root, file } = writeCorpus(lines, { name: "agent-x.jsonl" });
  const events = parseMilestoneTranscript(file);
  rmSync(root, { recursive: true, force: true });
  return events;
}

test("follow-ups, re-writes and the five targets are totalled across the milestone", () => {
  const { root, transcript } = writeMilestone(
    [
      said("Build M43"),
      call("o1", usage(0, 0, 100_000), ["Agent", "SendMessage"]),
      call("o2", usage(0, 0, 100_000), ["SendMessage"]),
      said(WAKE),
      call("o3", usage(0, 0, 100_000), ["ReadNotifications"]),
    ],
    {
      "agent-a": {
        lines: [
          said("brief"),
          call("a1", usage(0, 300_000, 0)),
          said("The coordinator sent a message while you were idle: one more thing"),
          call("a2", usage(0, 300_000, 0)),
          said("The coordinator sent a message while you were idle: and another"),
          call("a3", usage(0, 300_000, 0)),
        ],
        meta: { agentType: "phase-implementer", description: "Build M43 part 1" },
      },
    },
  );
  const loaded = loadMilestone(transcript);
  const bare = computeMilestone(loaded);
  assert.equal(bare.followUps.sendMessages, 2);
  assert.deepEqual(bare.followUps.received.map((r) => [r.description, r.messages]), [["Build M43 part 1", 2]]);
  assert.deepEqual(bare.rewrites, { count: 2, tokens: 600_000, afterCoordinator: 2, afterCoordinatorTokens: 600_000 });
  // units: orchestrator 30k, builder 1.125M -> 2.6% share; builder averages 300k.
  assert.deepEqual(bare.targets.map((t) => t.status), ["met", "missed", "not measurable", "not measurable", "met"]);

  const full = computeMilestone(loaded, { costUsd: 50, linesAdded: 2_000, parts: 1 });
  assert.deepEqual(full.targets.map((t) => t.status), ["met", "missed", "met", "missed", "met"]);
  assert.equal(full.targets[3].value, 25);
  assert.equal(full.usdPerUnit, 50 / 1_155_000);
  rmSync(root, { recursive: true, force: true });
});

test("the guard log is counted per hook and decision, and a missing file is `none recorded`", () => {
  const root = mkdtempSync(join(tmpdir(), "sm-guard-"));
  const log = join(root, "tc-guard-log.jsonl");
  writeFileSync(
    log,
    [
      { t: "2026-10-12T00:00:00Z", hook: "full-suite", decision: "deny" },
      { t: "2026-10-12T00:01:00Z", hook: "full-suite", decision: "deny" },
      { t: "2026-10-12T00:02:00Z", hook: "full-suite", decision: "note" },
      { t: "2026-10-12T00:03:00Z", hook: "pr-watch", decision: "note" },
    ].map((r) => JSON.stringify(r)).join("\n") + "\n",
  );
  assert.deepEqual(readGuardLog(log).byHook, { "full-suite": { deny: 2, note: 1 }, "pr-watch": { note: 1 } });
  assert.equal(readGuardLog(join(root, "absent.jsonl")), null);

  const { root: r2, transcript } = writeMilestone([said("hi"), call("o1", usage(0, 0, 1_000))]);
  const loaded = loadMilestone(transcript);
  assert.match(renderMilestone(computeMilestone(loaded, { guardLog: readGuardLog(log) })), /\| `full-suite` \| 2 \| 1 \|/);
  assert.match(renderMilestone(computeMilestone(loaded, { guardLog: null })), /\*\*Guard hooks\*\*\n\nNone recorded\./);
  rmSync(root, { recursive: true, force: true });
  rmSync(r2, { recursive: true, force: true });
});

test("the block opens with the two lines `pnpm milestone close` looks for", () => {
  // Spelled out rather than imported: scripts/milestone.mjs and every
  // milestone file already closed depend on these exact bytes.
  const { root, transcript } = writeMilestone([said("hi"), call("o1", usage(0, 0, 1_000))]);
  const lines = renderMilestone(computeMilestone(loadMilestone(transcript))).split("\n");
  assert.deepEqual(lines.slice(0, 2), ["## Spend", "<!-- session-metrics:milestone v1 -->"]);
  rmSync(root, { recursive: true, force: true });
});

test("--cost-usd adds a dollars column of units x (cost / total units); without it there is none", () => {
  const { root, transcript } = writeMilestone(
    [said("hi"), call("o1", usage(0, 0, 1_000))],
    { "agent-a": { lines: [said("b"), call("a1", usage(0, 0, 3_000))], meta: { agentType: "part-reviewer", description: "Review part 1" } } },
  );
  const loaded = loadMilestone(transcript);
  const priced = renderMilestone(computeMilestone(loaded, { costUsd: 8 }));
  assert.match(priced, /\| `part-reviewer` \| 1 \| 1 \| 3k \| 3k \| 300 \| \$6\.00 \| 75\.0% \|/);
  assert.match(priced, /\| `orchestrator` \| 1 \| 1 \| 1k \| 1k \| 100 \| \$2\.00 \| 25\.0% \|/);
  const bare = renderMilestone(computeMilestone(loaded));
  assert.doesNotMatch(bare, /\$/);
  assert.match(bare, /\| `part-reviewer` \| 1 \| 1 \| 3k \| 3k \| 300 \| 75\.0% \|/);
  rmSync(root, { recursive: true, force: true });
});
