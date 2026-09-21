#!/usr/bin/env node
// Re-runnable version of docs/reviews/2026-09-02-session-tooling-review.md's
// findings F1, F2, F3/F3a and F7, plus the cache re-read multiplier from its
// Method section.
//
// WHY THIS IS A SCRIPT AND NOT A jq PIPELINE IN A MARKDOWN FILE
//
// The 2026-09-02 review produced its numbers with three `jq` extracts joined
// by `awk`, pasted into the document. That measured the corpus once. Every
// recommendation in it — and every recommendation in the 2026-09-21 review
// that builds on it — is stated as "measure this before and after", which a
// pipeline living in prose cannot support: re-running it means re-typing it,
// and the 2026-09-21 review found that none of R3/R4/R5 had shipped and
// nobody had re-measured in the nineteen days during which the surface it
// measured DOUBLED.
//
// WHERE THE CORPUS LIVES, AND WHERE IT DOES NOT
//
// Session transcripts are written by the Claude Code CLI to
// ~/.claude/projects/<mangled-cwd>/*.jsonl on the machine that ran the
// session. They are NOT in the repo and NOT in a cloud container: a Claude
// Code on the web session starts from a fresh clone and holds only its own
// transcript. Run this on the laptop that has the history. In a cloud session
// it will find one file (this session) and say so rather than reporting a
// baseline computed from a corpus of one.
//
// TOKEN ACCOUNTING — the same caveats the review stated, restated because
// they are what make the output honest rather than merely precise:
//
//   1. `chars / 4` is an ESTIMATOR for text tool results, not a measurement.
//      Where an exact figure exists (message.usage) it is reported as exact.
//   2. Browser results are EXCLUDED from every char-based total. A
//      base64 screenshot's real cost is ~1.4k tokens, not chars/4, so
//      including them would inflate the totals by roughly an order of
//      magnitude. Browser activity is reported as screenshot COUNTS.
//   3. The re-read multiplier is the number that matters. A token written
//      into a session's context is re-read on every subsequent turn; the
//      review measured 51.3x. A byte saved at write time is not saved once.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import { pathToFileURL } from "node:url";

// ---------------------------------------------------------------------------
// The nine doc sources of F1. Order matters: a path is attributed to the FIRST
// pattern it matches, so `docs/known-issues/README.md` counts as known-issues
// and not as a stray `*.md`. These are the sources whose re-reading the review
// measured at ~1.9M tokens; they are deliberately NOT "every markdown file",
// because F1's claim is about ORIENTATION reading specifically.
// ---------------------------------------------------------------------------
// Each row is [name, pathPattern, mentionPattern].
//
// `pathPattern` classifies a tool call's ARGUMENT — a real path, so
// `docs/plans` is exactly right there.
//
// `mentionPattern` is different, and conflating the two was a bug CodeRabbit
// caught on PR #199. F3a asks whether a subagent BRIEF names a doc source, and
// the first draft built that regex from the row's NAME — so a brief saying
// "prepare implementation plans" counted as naming `docs/plans`, and
// "architecture" or "guidelines" in ordinary prose counted too. That inflates
// the one number R3 is argued from.
//
// The suggested fix was to reuse `pathPattern` for briefs. That trades an
// over-count for an under-count: the 2026-09-02 review's own F3a counted 66
// briefs saying "known-issues", which is how people write it — not
// "docs/known-issues". So each source gets an explicit mention pattern:
// distinctive enough not to fire on English, loose enough to match how a brief
// actually refers to the thing.
export const DOC_SOURCES = [
  ["known-issues", /docs\/known-issues/, /\bknown[- ]issues\b|\bKI-\d/],
  ["plans", /docs\/plans/, /\bdocs\/plans\b/],
  ["milestones", /docs\/milestones/, /\bdocs\/milestones\b|\bmilestone file\b/],
  ["AGENTS.md", /AGENTS\.md/, /\bAGENTS\.md\b/],
  ["STATUS.md", /STATUS\.md/, /\bSTATUS\.md\b/],
  ["TODO.md", /TODO\.md/, /\bTODO\.md\b/],
  ["architecture", /docs\/architecture/, /\bdocs\/architecture\b|\bADR-\d/],
  ["specs", /docs\/specs/, /\bdocs\/specs\b/],
  ["guidelines", /docs\/guidelines/, /\bdocs\/guidelines\b/],
];

// F2's bootstrap regex, verbatim from the review's method column. It is wider
// than DOC_SOURCES on purpose: "orientation" in the opening moves of a session
// includes asking git and gh where things are, not only reading docs.
export const BOOTSTRAP_RE =
  /STATUS|TODO|milestones|known-issues|AGENTS|CLAUDE|git log|git branch|gh pr (list|view)|gh run list|git worktree|git status|guidelines|architecture|contracts/;

// F7's three skills, each with the manual command shape it competes with. The
// review's finding was ZERO OVERLAP — no session ever ran both — so the report
// prints the overlap explicitly rather than only the two counts.
export const SKILL_PAIRS = [
  {
    skill: "minimal-check-subset",
    manual: /pnpm\s+(-w\s+)?(run\s+)?check(\s|$)/,
    manualLabel: "full `pnpm check`",
  },
  {
    skill: "ci-triage",
    manual: /gh\s+run\s+view|gh\s+run\s+list.*--log|gh\s+pr\s+checks/,
    manualLabel: "manual gh run/checks",
  },
  {
    skill: "worktree-hygiene",
    manual: /git\s+worktree\s+list/,
    manualLabel: "manual git worktree",
  },
];

const BROWSER_RE = /Claude_Browser|mcp__.*browser/i;

// The first argument that identifies WHAT a tool call touched. Different tools
// carry it under different keys; the review's extract used this same fallback
// chain. Without it a Read of AGENTS.md and a Bash `sed -n` of AGENTS.md would
// not be comparable, and F1 counts both.
export function firstArg(input) {
  if (!input || typeof input !== "object") return "";
  const v =
    input.command ??
    input.file_path ??
    input.skill ??
    input.pattern ??
    input.subagent_type ??
    input.url ??
    input.path ??
    "";
  return String(v).replace(/[\t\n\r]/g, " ").slice(0, 400);
}

// Attribute a tool call's argument to one of the nine sources, or null.
export function classifyDocSource(arg) {
  for (const [name, re] of DOC_SOURCES) if (re.test(arg)) return name;
  return null;
}

export function estTokens(chars) {
  return Math.round(chars / 4);
}

// ---------------------------------------------------------------------------
// Parsing. One pass per file; we never hold a whole corpus in memory as JSON.
// ---------------------------------------------------------------------------
function* jsonlRecords(file) {
  let raw;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return;
  }
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      yield JSON.parse(line);
    } catch {
      // A transcript being written to while we read it can end mid-line.
      // Skipping the partial line is correct; aborting the file is not.
    }
  }
}

export function parseSession(file) {
  const id = basename(file, ".jsonl");
  const isAgent = id.startsWith("agent-");
  const toolUses = [];
  const resultsById = new Map();
  const usageByRequest = new Map();
  let firstTs = null;
  let lastTs = null;

  for (const rec of jsonlRecords(file)) {
    if (rec.timestamp) {
      if (!firstTs || rec.timestamp < firstTs) firstTs = rec.timestamp;
      if (!lastTs || rec.timestamp > lastTs) lastTs = rec.timestamp;
    }

    if (rec.type === "assistant") {
      // Dedupe usage by requestId: a streamed response emits the same usage
      // across several records, and SUMMING them would multiply the cache
      // figures by the number of content blocks — the re-read multiplier is
      // the one number reported as exact rather than estimated, so this is
      // where it would quietly go wrong.
      //
      // Note what actually does the deduping: keying a Map by requestId and
      // overwriting. The `has` guard below only makes that explicit and skips
      // the redundant write. Proven by mutation 2026-09-21 — removing the
      // guard alone leaves every test green; the corpus only double-counts if
      // the body ALSO accumulates. Do not "simplify" this into a += .
      if (rec.requestId && !usageByRequest.has(rec.requestId)) {
        const u = rec.message?.usage ?? {};
        usageByRequest.set(rec.requestId, {
          cacheCreation: u.cache_creation_input_tokens ?? 0,
          cacheRead: u.cache_read_input_tokens ?? 0,
        });
      }
      for (const block of rec.message?.content ?? []) {
        if (block?.type !== "tool_use") continue;
        toolUses.push({
          session: id,
          isAgent,
          isSidechain: Boolean(rec.isSidechain),
          id: block.id,
          name: block.name,
          arg: firstArg(block.input),
          // The Agent tool's brief is what F3a measures, and it is under
          // `prompt`, which firstArg() deliberately does not reach for.
          prompt: block.name === "Agent" ? String(block.input?.prompt ?? "") : "",
        });
      }
    }

    if (rec.type === "user") {
      const content = rec.message?.content;
      if (!Array.isArray(content)) continue;
      for (const block of content) {
        if (block?.type !== "tool_result") continue;
        const text =
          typeof block.content === "string"
            ? block.content
            : JSON.stringify(block.content ?? "");
        resultsById.set(block.tool_use_id, {
          chars: text.length,
          isError: Boolean(block.is_error),
        });
      }
    }
  }

  // The join the review did with awk on tool_use_id.
  for (const t of toolUses) {
    const r = resultsById.get(t.id);
    t.chars = r?.chars ?? 0;
    t.isError = r?.isError ?? false;
  }

  return { id, isAgent, file, toolUses, usageByRequest, firstTs, lastTs };
}

export function findTranscripts(root, since) {
  let dirs;
  try {
    dirs = readdirSync(root);
  } catch {
    return [];
  }
  const files = [];
  for (const d of dirs) {
    if (!d.includes("travel-collab")) continue;
    const dir = join(root, d);
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.endsWith(".jsonl")) continue;
      const full = join(dir, e);
      if (since) {
        try {
          if (statSync(full).mtime < since) continue;
        } catch {
          continue;
        }
      }
      files.push(full);
    }
  }
  return files;
}

// ---------------------------------------------------------------------------
// The findings.
// ---------------------------------------------------------------------------
export function computeFindings(sessions) {
  const mainSessions = sessions.filter((s) => !s.isAgent);
  const agentSessions = sessions.filter((s) => s.isAgent);

  // --- F1: orientation re-reads across the whole corpus -------------------
  const f1 = { calls: 0, chars: 0, sessions: new Set(), bySource: new Map() };
  let nonBrowserChars = 0;

  for (const s of sessions) {
    for (const t of s.toolUses) {
      if (BROWSER_RE.test(t.name)) continue; // caveat 2
      nonBrowserChars += t.chars;
      if (t.name !== "Read" && t.name !== "Bash" && t.name !== "Grep") continue;
      const src = classifyDocSource(t.arg);
      if (!src) continue;
      f1.calls += 1;
      f1.chars += t.chars;
      f1.sessions.add(s.id);
      const e = f1.bySource.get(src) ?? { calls: 0, chars: 0, sessions: new Set() };
      e.calls += 1;
      e.chars += t.chars;
      e.sessions.add(s.id);
      f1.bySource.set(src, e);
    }
  }

  // --- F2: orientation inside the FIRST 20 tool calls of a main session ---
  const f2 = { perSession: [], total: 0 };
  for (const s of mainSessions) {
    let chars = 0;
    for (const t of s.toolUses.slice(0, 20)) {
      if (BROWSER_RE.test(t.name)) continue;
      if (BOOTSTRAP_RE.test(t.arg)) chars += t.chars;
    }
    if (chars > 0) f2.perSession.push(chars);
    f2.total += chars;
  }
  f2.perSession.sort((a, b) => a - b);

  // --- F3 / F3a: subagents redo the orientation ---------------------------
  const f3 = { chars: 0, calls: 0, sessions: new Set(), bySource: new Map() };
  for (const s of agentSessions) {
    for (const t of s.toolUses) {
      if (BROWSER_RE.test(t.name)) continue;
      const src = classifyDocSource(t.arg);
      if (!src) continue;
      f3.calls += 1;
      f3.chars += t.chars;
      f3.sessions.add(s.id);
      const e = f3.bySource.get(src) ?? { calls: 0, chars: 0, sessions: new Set() };
      e.calls += 1;
      e.chars += t.chars;
      e.sessions.add(s.id);
      f3.bySource.set(src, e);
    }
  }

  const f3a = { dispatches: 0, mentioning: new Map(), briefChars: [] };
  for (const s of sessions) {
    for (const t of s.toolUses) {
      if (t.name !== "Agent") continue;
      f3a.dispatches += 1;
      f3a.briefChars.push(t.prompt.length);
      for (const [name, , mention] of DOC_SOURCES) {
        if (mention.test(t.prompt)) {
          f3a.mentioning.set(name, (f3a.mentioning.get(name) ?? 0) + 1);
        }
      }
    }
  }
  f3a.briefChars.sort((a, b) => a - b);

  // --- F4 (free, same extract): which subagent types get dispatched -------
  const f4 = new Map();
  for (const s of sessions) {
    for (const t of s.toolUses) {
      if (t.name !== "Agent") continue;
      const k = t.arg || "(unspecified)";
      f4.set(k, (f4.get(k) ?? 0) + 1);
    }
  }

  // --- F7: skills vs the manual path they compete with --------------------
  const f7 = [];
  for (const pair of SKILL_PAIRS) {
    const skillSessions = new Set();
    const manualSessions = new Set();
    let manualCalls = 0;
    let manualChars = 0;
    for (const s of sessions) {
      for (const t of s.toolUses) {
        if (t.name === "Skill" && t.arg.includes(pair.skill)) skillSessions.add(s.id);
        if (t.name === "Bash" && pair.manual.test(t.arg)) {
          manualSessions.add(s.id);
          manualCalls += 1;
          manualChars += t.chars;
        }
      }
    }
    const overlap = [...skillSessions].filter((x) => manualSessions.has(x));
    f7.push({
      skill: pair.skill,
      manualLabel: pair.manualLabel,
      skillSessions: skillSessions.size,
      manualSessions: manualSessions.size,
      manualCalls,
      manualChars,
      overlap: overlap.length,
    });
  }

  // --- The multiplier -----------------------------------------------------
  let cacheCreation = 0;
  let cacheRead = 0;
  const seenRequests = new Set();
  for (const s of sessions) {
    for (const [reqId, u] of s.usageByRequest) {
      if (seenRequests.has(reqId)) continue;
      seenRequests.add(reqId);
      cacheCreation += u.cacheCreation;
      cacheRead += u.cacheRead;
    }
  }

  // Browser activity, in counts rather than chars (caveat 2).
  let browserCalls = 0;
  let browserMain = 0;
  for (const s of sessions) {
    for (const t of s.toolUses) {
      if (!BROWSER_RE.test(t.name)) continue;
      browserCalls += 1;
      if (!s.isAgent) browserMain += 1;
    }
  }

  return {
    corpus: {
      files: sessions.length,
      mainSessions: mainSessions.length,
      agentSessions: agentSessions.length,
      toolUses: sessions.reduce((n, s) => n + s.toolUses.length, 0),
      requests: seenRequests.size,
      nonBrowserChars,
      firstTs: sessions.map((s) => s.firstTs).filter(Boolean).sort()[0],
      lastTs: sessions.map((s) => s.lastTs).filter(Boolean).sort().at(-1),
    },
    f1,
    f2,
    f3,
    f3a,
    f4,
    f7,
    cache: {
      cacheCreation,
      cacheRead,
      multiplier: cacheCreation > 0 ? cacheRead / cacheCreation : 0,
    },
    browser: { calls: browserCalls, mainThread: browserMain },
  };
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
function pct(part, whole) {
  return whole > 0 ? ((part / whole) * 100).toFixed(1) + "%" : "n/a";
}

// "The middle value, or the LOWER of the two middles" — the definition
// apps/web/src/server/billing/revenue.ts:146 already uses for every median in
// this repo. The first draft took the upper middle, so F2 and F3a could report
// a median above the repo's own convention while calling it the same word.
// CodeRabbit, PR #199 (and PR #177, where that convention was set).
export function median(sorted) {
  return sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : 0;
}

function report(r, opts) {
  const L = [];
  const c = r.corpus;
  L.push("SESSION METRICS — F1/F2/F3/F7 re-run");
  L.push("=".repeat(72));
  L.push(`corpus root        ${opts.root}`);
  L.push(`transcripts        ${c.files}  (main ${c.mainSessions}, subagent ${c.agentSessions})`);
  L.push(`window             ${c.firstTs ?? "?"}  ->  ${c.lastTs ?? "?"}`);
  L.push(`tool_use blocks    ${c.toolUses}`);
  L.push(`model requests     ${c.requests} (deduped by requestId)`);
  L.push(`non-browser output ${c.nonBrowserChars.toLocaleString()} chars ~ ${estTokens(c.nonBrowserChars).toLocaleString()} tok`);
  L.push("");

  if (c.files < 5) {
    L.push("!! FEWER THAN 5 TRANSCRIPTS FOUND.");
    L.push("!! This is almost certainly a cloud session, which holds only its own");
    L.push("!! transcript. The corpus lives on the machine that ran the sessions:");
    L.push("!!   ~/.claude/projects/-Users-<you>-...-travel-collab*/");
    L.push("!! Numbers below are NOT a baseline. Re-run this on that machine.");
    L.push("");
  }

  L.push("MULTIPLIER (exact, from message.usage — not an estimate)");
  L.push("-".repeat(72));
  L.push(`  cache_creation_input_tokens  ${r.cache.cacheCreation.toLocaleString()}`);
  L.push(`  cache_read_input_tokens      ${r.cache.cacheRead.toLocaleString()}`);
  L.push(`  re-read multiplier           ${r.cache.multiplier.toFixed(1)}x`);
  L.push(`  2026-09-02 baseline          51.3x`);
  L.push("  A token written into context is re-read this many times before the");
  L.push("  session ends. A byte saved at write time is not saved once.");
  L.push("");

  L.push("F1 — ORIENTATION RE-READS (the nine doc sources)");
  L.push("-".repeat(72));
  L.push(`  ${r.f1.calls} tool calls across ${r.f1.sessions.size} of ${c.files} transcripts`);
  L.push(`  ~${estTokens(r.f1.chars).toLocaleString()} tok — ${pct(r.f1.chars, c.nonBrowserChars)} of all non-browser output`);
  L.push(`  2026-09-02 baseline: 2,621 calls / 220 of 419 / ~1,913,600 tok / 16.9%`);
  L.push("");
  const rows = [...r.f1.bySource.entries()].sort((a, b) => b[1].chars - a[1].chars);
  for (const [name, e] of rows) {
    L.push(
      `    ${name.padEnd(14)} ${String(e.calls).padStart(5)} calls  ` +
        `${String(e.sessions.size).padStart(4)} sessions  ~${estTokens(e.chars).toLocaleString()} tok`
    );
  }
  L.push("");

  L.push("F2 — SESSION BOOTSTRAP (orientation in the first 20 tool calls)");
  L.push("-".repeat(72));
  L.push(`  ${r.f2.perSession.length} of ${c.mainSessions} main sessions pay it`);
  const mean = r.f2.perSession.length
    ? r.f2.perSession.reduce((a, b) => a + b, 0) / r.f2.perSession.length
    : 0;
  L.push(`  mean ${estTokens(mean).toLocaleString()} tok/session, median ${estTokens(median(r.f2.perSession)).toLocaleString()} tok`);
  L.push(`  total ~${estTokens(r.f2.total).toLocaleString()} tok`);
  L.push(`  2026-09-02 baseline: 66 of 72, mean 7,760, median 6,037, total ~512,200`);
  L.push("");

  L.push("F3 — SUBAGENTS REDO THE ORIENTATION");
  L.push("-".repeat(72));
  L.push(`  ${r.f3.calls} calls in ${r.f3.sessions.size} of ${c.agentSessions} subagent transcripts`);
  L.push(`  ~${estTokens(r.f3.chars).toLocaleString()} tok`);
  L.push(`  2026-09-02 baseline: ~814,000 tok`);
  const f3rows = [...r.f3.bySource.entries()].sort((a, b) => b[1].chars - a[1].chars).slice(0, 5);
  for (const [name, e] of f3rows) {
    L.push(
      `    ${name.padEnd(14)} ${String(e.calls).padStart(5)} calls  ` +
        `${String(e.sessions.size).padStart(4)} subagents  ~${estTokens(e.chars).toLocaleString()} tok`
    );
  }
  L.push("");
  L.push(`F3a — briefs that NAME a doc source (R3's target)`);
  L.push(`  ${r.f3a.dispatches} Agent dispatches; median brief ${estTokens(median(r.f3a.briefChars)).toLocaleString()} tok`);
  for (const [name, n] of [...r.f3a.mentioning.entries()].sort((a, b) => b[1] - a[1])) {
    L.push(`    brief says "${name}": ${n}`);
  }
  L.push(`  2026-09-02 baseline: 355 dispatches; 78 said AGENTS.md, 66 known-issues, 25 STATUS.md`);
  L.push("");

  L.push("F4 — SUBAGENT TYPE MIX (free from the same extract)");
  L.push("-".repeat(72));
  for (const [k, n] of [...r.f4.entries()].sort((a, b) => b[1] - a[1])) {
    L.push(`    ${String(n).padStart(4)}  ${k}`);
  }
  L.push(`  2026-09-02 baseline: phase-verifier dispatched 0 times in 356.`);
  L.push("");

  L.push("F7 — SKILLS VS THE MANUAL PATH THEY COMPETE WITH");
  L.push("-".repeat(72));
  for (const s of r.f7) {
    L.push(`  ${s.skill}`);
    L.push(
      `    skill used in ${s.skillSessions} sessions  |  ${s.manualLabel} in ${s.manualSessions} ` +
        `sessions (${s.manualCalls} calls, ~${estTokens(s.manualChars).toLocaleString()} tok)`
    );
    L.push(`    OVERLAP (sessions that did both): ${s.overlap}`);
  }
  L.push(`  2026-09-02 baseline: 9 vs 45 (zero overlap), 3 vs 50, 4 vs 47.`);
  L.push("  Zero overlap means the skill was never CONSULTED — not that it");
  L.push("  advised running everything. That is a reach problem, not a content one.");
  L.push("");

  L.push("BROWSER (counts, never chars/4 — see caveat 2 in the header)");
  L.push("-".repeat(72));
  L.push(`  ${r.browser.calls} browser tool calls, ${r.browser.mainThread} of them in a MAIN thread`);
  L.push(`  Main-thread browser work is what phase-verifier exists to absorb.`);

  return L.join("\n");
}

// ---------------------------------------------------------------------------
// The self-report: one session's aggregate, for the durable sink.
//
// THIS IS THE ONLY THING THAT LEAVES THE CONTAINER, so its contents are a
// privacy boundary, not merely a size choice. Transcripts contain every
// prompt, every file read and every tool argument. A record carries COUNTS
// AND TOKEN SUMS ONLY — no prompt text, no file contents, no tool arguments,
// no branch-identifying free text beyond the branch name itself.
//
// If a future field would need an example value from the transcript to be
// useful, it does not belong here.
export function selfReport(session, { sessionId, branch } = {}) {
  const f = computeFindings([session]);
  const bySource = {};
  for (const [name, e] of f.f1.bySource) {
    bySource[name] = { calls: e.calls, tok: estTokens(e.chars) };
  }
  return {
    schema: 1,
    sessionId: sessionId ?? session.id,
    branch: branch ?? null,
    isAgent: session.isAgent,
    firstTs: session.firstTs,
    lastTs: session.lastTs,
    toolUses: f.corpus.toolUses,
    requests: f.corpus.requests,
    nonBrowserTok: estTokens(f.corpus.nonBrowserChars),
    cacheCreation: f.cache.cacheCreation,
    cacheRead: f.cache.cacheRead,
    multiplier: Number(f.cache.multiplier.toFixed(2)),
    // F1 and F2, the two findings the surface-growth argument rests on.
    orientationCalls: f.f1.calls,
    orientationTok: estTokens(f.f1.chars),
    orientationBySource: bySource,
    bootstrapTok: estTokens(f.f2.total),
    // F3a / F4, so subagent reach stays measurable.
    agentDispatches: f.f3a.dispatches,
    agentTypes: Object.fromEntries(f.f4),
    briefsNamingDocs: Object.fromEntries(f.f3a.mentioning),
    // F7, per skill.
    skills: f.f7.map((s) => ({
      skill: s.skill,
      skillSessions: s.skillSessions,
      manualSessions: s.manualSessions,
      manualCalls: s.manualCalls,
    })),
    browserCalls: f.browser.calls,
  };
}

function main() {
  const argv = process.argv.slice(2);
  const get = (flag) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const root = get("--root") ?? join(homedir(), ".claude", "projects");
  const sinceRaw = get("--since");
  const since = sinceRaw ? new Date(sinceRaw) : undefined;
  const asJson = argv.includes("--json");

  // --self <transcript.jsonl>: aggregate ONE transcript (the current session),
  // for the Stop/SessionEnd hook. Kept in this file rather than the hook so
  // the aggregation has exactly one implementation and one set of tests.
  const self = get("--self");
  if (self) {
    console.log(
      JSON.stringify(
        selfReport(parseSession(self), { sessionId: get("--session-id"), branch: get("--branch") })
      )
    );
    return;
  }

  const files = findTranscripts(root, since);
  if (files.length === 0) {
    console.error(`No travel-collab transcripts under ${root}.`);
    console.error("Transcripts live on the machine that ran the sessions, not in the repo.");
    process.exit(1);
  }
  const sessions = files.map(parseSession);
  const findings = computeFindings(sessions);

  if (asJson) {
    console.log(
      JSON.stringify(
        findings,
        (_k, v) => (v instanceof Set ? v.size : v instanceof Map ? Object.fromEntries(v) : v),
        2
      )
    );
  } else {
    console.log(report(findings, { root }));
  }
}

// pathToFileURL, not string interpolation: on Windows, or when the path holds
// a space or a URL-reserved character, `file://${argv[1]}` never equals
// import.meta.url, main() is skipped and the script exits 0 having done
// NOTHING. For surface-size that means `pnpm surface --check` — a lint wall —
// passing silently, which is the exact silent-success class this branch spent
// its time hunting. CodeRabbit, PR #199.
// The argv[1] guard is not decoration: pathToFileURL(undefined) THROWS, so
// without it merely IMPORTING this module (as the tests do, and as
// `node -e "import(...)"` does) crashes before any export is reachable.
// Found by running it immediately after applying the fix above.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
