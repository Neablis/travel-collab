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
import { join, basename, resolve } from "node:path";
import { execFileSync } from "node:child_process";
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

// ---------------------------------------------------------------------------
// --milestone: where one milestone's tokens went.
//
// docs/retros/2026-10-12-m42-token-spend-retro.md found M42 cost twice M41 for
// the same lines, and found it with a one-off Python script (its section 8)
// run inside a cloud container that was then reclaimed. That is the same
// failure this file's header describes for the 2026-09-02 review: a
// measurement that lives in prose is made once. This mode makes it a command,
// and `pnpm milestone close` refuses a milestone file that lacks its output,
// so every retro carries the same numbers.
//
// THE METHOD IS THE RETRO'S SECTION 2, NOT A NEW ONE — a figure here must be
// comparable with the M42 baseline or it is not worth printing:
//
//   - one call  = one assistant `message.id`, deduplicated (a streamed message
//                 is logged once per content block);
//   - units     = input + 1.25 x cache_creation + 0.1 x cache_read, the ratios
//                 between Anthropic's prices. Output is EXCLUDED: the logged
//                 output_tokens is the stream-start value, so it understates;
//   - context   = input + cache_creation + cache_read of that call.
//
// Note this is a DIFFERENT dedupe key from parseSession() above, which keys by
// requestId because the 2026-09-02 review did. Each mode reproduces its own
// baseline; unifying them would move one of the two.
// ---------------------------------------------------------------------------

/** First line of the block, and what `milestone close` looks for. */
export const MILESTONE_SPEND_HEADING = "## Spend";
export const MILESTONE_SPEND_MARKER = "<!-- session-metrics:milestone v1 -->";

function usageOf(u) {
  return {
    input: u?.input_tokens ?? 0,
    cacheCreation: u?.cache_creation_input_tokens ?? 0,
    cacheRead: u?.cache_read_input_tokens ?? 0,
  };
}

export function callUnits(u) {
  return u.input + 1.25 * u.cacheCreation + 0.1 * u.cacheRead;
}

export function callContext(u) {
  return u.input + u.cacheCreation + u.cacheRead;
}

/** A user-role record's text, or null when it is a tool_result (not a turn start). */
function userText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  if (content.some((b) => b?.type === "tool_result")) return null;
  return content
    .filter((b) => b?.type === "text")
    .map((b) => String(b.text ?? ""))
    .join("\n");
}

/**
 * One transcript as an ordered list of events: `{kind:"call", usage, tools}`
 * and `{kind:"user", text}`. Order is what the turn, follow-up and re-write
 * sections all need, and none of them need anything else from the file.
 */
export function parseMilestoneTranscript(file) {
  const events = [];
  const callsById = new Map();
  const seenToolUse = new Set();
  let anonymous = 0;
  for (const rec of jsonlRecords(file)) {
    const m = rec.message;
    if (!m || typeof m !== "object") continue;
    if (m.role === "assistant" && m.usage) {
      // A record with no id cannot be deduplicated, so it is counted as its
      // own call: under-counting silently is the worse of the two errors.
      const key = m.id ?? rec.requestId ?? `anonymous-${(anonymous += 1)}`;
      let call = callsById.get(key);
      if (!call) {
        call = { kind: "call", id: key, usage: null, tools: [] };
        callsById.set(key, call);
        events.push(call);
      }
      // Overwrite, never accumulate — the retro's script keeps one usage per
      // id for the same reason parseSession() keeps one per requestId.
      call.usage = usageOf(m.usage);
      for (const block of Array.isArray(m.content) ? m.content : []) {
        if (block?.type !== "tool_use" || seenToolUse.has(block.id)) continue;
        if (block.id) seenToolUse.add(block.id);
        call.tools.push(String(block.name ?? ""));
      }
    } else if (m.role === "user") {
      const text = userText(m.content);
      if (text !== null) events.push({ kind: "user", text });
    }
  }
  return events;
}

/**
 * The orchestrator's transcript plus its subagents'.
 *
 * `agent-*.meta.json` is OBSERVED in cloud sessions, not documented anywhere,
 * so its absence is a label (`unknown`) rather than an error. The retro's own
 * script called a meta-less file "orchestrator", which would fold a subagent
 * into the row this report most needs to be right.
 */
export function loadMilestone(transcript) {
  const dir = join(transcript.replace(/\.jsonl$/, ""), "subagents");
  let entries = [];
  try {
    entries = readdirSync(dir).filter((e) => /^agent-.*\.jsonl$/.test(e)).sort();
  } catch {
    // No subagents directory: a session that dispatched nothing.
  }
  const subagents = entries.map((e) => {
    let meta = {};
    try {
      meta = JSON.parse(readFileSync(join(dir, e.replace(/\.jsonl$/, ".meta.json")), "utf8")) ?? {};
    } catch {
      // Absent or unreadable: labelled below.
    }
    return {
      id: basename(e, ".jsonl"),
      agentType: typeof meta.agentType === "string" && meta.agentType ? meta.agentType : "unknown",
      description: typeof meta.description === "string" && meta.description ? meta.description : basename(e, ".jsonl"),
      events: parseMilestoneTranscript(join(dir, e)),
    };
  });
  return {
    orchestrator: {
      id: basename(transcript, ".jsonl"),
      agentType: "orchestrator",
      description: "orchestrator",
      events: parseMilestoneTranscript(transcript),
    },
    subagents,
  };
}

// What started an orchestrator turn. First match wins, top down.
//
// THESE PATTERNS WERE WRITTEN FROM THE RETRO'S DESCRIPTION OF THE FRAMES (its
// F1 table), NOT FROM A TRANSCRIPT: cloud transcripts do not exist on the
// machine this was written on, and M42's were reclaimed with its container.
// Check every row against the first real M43 transcript. Until then the
// `other` row is the alarm: a turn that looks like a frame but matches nothing
// here lands there, and it is always printed, so a wrong pattern shows up as a
// large `other` instead of quietly inflating `human`.
export const TURN_CLASSES = [
  ["github", /<wake reason="external-event"|\bnotifications?[- ](?:are )?pending\b|\bpending notifications?\b/i],
  ["subagent-report", /<agent-message\b|<teammate-message\b|<subagent[-_](?:handback|hand-back|report|message)\b/i],
  ["subagent-finished", /<task-notification>/],
  [
    "harness",
    // Only system-reminders; hook output; a compaction summary; a slash
    // command's own frames. The prose alternatives are anchored to the start
    // and name the hook event, so that a person WRITING "the hook output is
    // wrong" stays human (the first draft of this row took that sentence).
    /^\s*(?:<system-reminder>[\s\S]*?<\/system-reminder>\s*)+$|<[a-z-]*hook[a-z-]*>|^\s*(?:Stop|SubagentStop|PreToolUse|PostToolUse|UserPromptSubmit|SessionStart|PreCompact) hook (?:feedback|output|blocking error)\b|^\s*This session is being continued from a previous conversation|<local-command-(?:stdout|stderr|caveat)>|<command-name>/i,
  ],
];

export const TURN_LABELS = {
  github: "GitHub / trigger notification",
  "subagent-report": "Subagent report",
  "subagent-finished": "Subagent finished",
  harness: "Harness",
  human: "Human",
  other: "Other (unrecognised frame)",
};

// A notification turn that did nothing but read the notification.
const IDLE_TOOLS = new Set(["ReadNotifications", "ToolSearch"]);
const COORDINATOR_MESSAGE = "The coordinator sent a message";

/**
 * `human` is what is left once every frame is accounted for, so it needs a
 * guard of its own: text that still OPENS with a tag after the reminders are
 * stripped is a frame nobody has a pattern for, and an empty message is not a
 * person typing. Both are `other`.
 */
export function classifyTurn(text) {
  for (const [name, re] of TURN_CLASSES) if (re.test(text)) return name;
  const rest = text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "").trim();
  if (rest === "" || /^<[a-z]/i.test(rest)) return "other";
  return "human";
}

// The tag an `other` turn opens with: the frame's NAME, which is what a new
// TURN_CLASSES row would be written from, and never its contents.
function leadingTag(text) {
  const m = /^<([a-z][a-z0-9_-]{0,39})/i.exec(
    text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "").trim(),
  );
  return m ? `<${m[1].toLowerCase()}>` : "(empty)";
}

function bareToolName(name) {
  // `mcp__server__ReadNotifications` and `ReadNotifications` are one tool.
  return name.startsWith("mcp__") ? name.split("__").slice(2).join("__") : name;
}

function agentStats(agent) {
  let calls = 0;
  let units = 0;
  let contextSum = 0;
  let peak = 0;
  for (const e of agent.events) {
    if (e.kind !== "call") continue;
    const ctx = callContext(e.usage);
    calls += 1;
    units += callUnits(e.usage);
    contextSum += ctx;
    if (ctx > peak) peak = ctx;
  }
  return {
    id: agent.id,
    agentType: agent.agentType,
    description: agent.description,
    calls,
    units,
    avgContext: calls ? contextSum / calls : 0,
    peakContext: peak,
    contextSum,
  };
}

export function orchestratorTurns(events) {
  const turns = [];
  let turn = null;
  for (const e of events) {
    if (e.kind === "user") {
      turn = { cls: classifyTurn(e.text), tag: null, units: 0, calls: 0, tools: [] };
      if (turn.cls === "other") turn.tag = leadingTag(e.text);
      turns.push(turn);
      continue;
    }
    if (!turn) {
      // Calls before any user record. Not expected, so not guessed at.
      turn = { cls: "other", tag: "(before first turn)", units: 0, calls: 0, tools: [] };
      turns.push(turn);
    }
    turn.units += callUnits(e.usage);
    turn.calls += 1;
    turn.tools.push(...e.tools);
  }
  for (const t of turns) t.idle = t.tools.every((n) => IDLE_TOOLS.has(bareToolName(n)));
  return turns;
}

/**
 * Full cache re-writes: a call that is not the agent's first, whose context is
 * over 50k and at least 80% freshly written. That is the signature of the
 * 5-minute cache having expired under an idle agent (retro F3), and the first
 * call is excluded because writing the whole context is what a first call IS.
 */
export function findRewrites(events) {
  const out = [];
  let index = 0;
  let coordinatorSincePrevCall = false;
  let coordinatorMessages = 0;
  for (const e of events) {
    if (e.kind === "user") {
      // After the first call, and near the top of the message: a brief or a
      // file that merely quotes the frame is not a follow-up.
      if (index > 0 && e.text.slice(0, 200).includes(COORDINATOR_MESSAGE)) {
        coordinatorMessages += 1;
        coordinatorSincePrevCall = true;
      }
      continue;
    }
    const ctx = callContext(e.usage);
    if (index > 0 && ctx > 50_000 && e.usage.cacheCreation >= 0.8 * ctx) {
      out.push({ tokens: e.usage.cacheCreation, afterCoordinator: coordinatorSincePrevCall });
    }
    index += 1;
    coordinatorSincePrevCall = false;
  }
  return { rewrites: out, coordinatorMessages };
}

/** Guard-hook decisions, or null when the log does not exist ("none recorded"). */
export function readGuardLog(path) {
  if (!path) return null;
  try {
    statSync(path);
  } catch {
    return null;
  }
  const byHook = new Map();
  let lines = 0;
  for (const rec of jsonlRecords(path)) {
    if (!rec || typeof rec.hook !== "string") continue;
    lines += 1;
    const row = byHook.get(rec.hook) ?? {};
    const decision = String(rec.decision ?? "unknown");
    row[decision] = (row[decision] ?? 0) + 1;
    byHook.set(rec.hook, row);
  }
  return { path, lines, byHook: Object.fromEntries(byHook) };
}

export function defaultGuardLogPath(cwd = process.cwd()) {
  try {
    // The COMMON dir, so every worktree of the repo shares one log.
    const dir = execFileSync("git", ["rev-parse", "--git-common-dir"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return resolve(cwd, dir, "tc-guard-log.jsonl");
  } catch {
    return null;
  }
}

export function computeMilestone({ orchestrator, subagents }, opts = {}) {
  const { costUsd = null, linesAdded = null, parts = null, guardLog = null } = opts;
  const orch = agentStats(orchestrator);
  const subs = subagents.map(agentStats);
  const all = [orch, ...subs];
  const totalUnits = all.reduce((n, a) => n + a.units, 0);
  const share = (u) => (totalUnits > 0 ? u / totalUnits : 0);

  // 1. by agent type
  const typeMap = new Map();
  for (const a of all) {
    const t = typeMap.get(a.agentType) ?? { agentType: a.agentType, agents: 0, calls: 0, units: 0, contextSum: 0, peakContext: 0 };
    t.agents += 1;
    t.calls += a.calls;
    t.units += a.units;
    t.contextSum += a.contextSum;
    t.peakContext = Math.max(t.peakContext, a.peakContext);
    typeMap.set(a.agentType, t);
  }
  const byType = [...typeMap.values()]
    .map((t) => ({ ...t, avgContext: t.calls ? t.contextSum / t.calls : 0, share: share(t.units) }))
    .sort((a, b) => b.units - a.units);

  // 2. the costliest subagents (the orchestrator has its own row in 1)
  const costliest = [...subs].sort((a, b) => b.units - a.units).slice(0, 10);

  // 3. orchestrator turns
  const turns = orchestratorTurns(orchestrator.events);
  const turnClasses = Object.keys(TURN_LABELS).map((cls) => {
    const mine = turns.filter((t) => t.cls === cls);
    return {
      cls,
      turns: mine.length,
      units: mine.reduce((n, t) => n + t.units, 0),
      idle: mine.filter((t) => t.idle).length,
      idleUnits: mine.filter((t) => t.idle).reduce((n, t) => n + t.units, 0),
    };
  });
  const otherTags = {};
  for (const t of turns) if (t.cls === "other") otherTags[t.tag] = (otherTags[t.tag] ?? 0) + 1;

  // 4 and 5. follow-ups and re-writes
  const sendMessages = orchestrator.events
    .filter((e) => e.kind === "call")
    .reduce((n, e) => n + e.tools.filter((t) => bareToolName(t) === "SendMessage").length, 0);
  const received = [];
  const rewrites = { count: 0, tokens: 0, afterCoordinator: 0, afterCoordinatorTokens: 0 };
  subagents.forEach((agent, i) => {
    const r = findRewrites(agent.events);
    if (r.coordinatorMessages > 0) {
      received.push({ description: subs[i].description, agentType: subs[i].agentType, messages: r.coordinatorMessages });
    }
    for (const w of r.rewrites) {
      rewrites.count += 1;
      rewrites.tokens += w.tokens;
      if (w.afterCoordinator) {
        rewrites.afterCoordinator += 1;
        rewrites.afterCoordinatorTokens += w.tokens;
      }
    }
  });
  received.sort((a, b) => b.messages - a.messages);

  // 7. targets — the retro's four for M43, plus the re-write ceiling.
  const githubTurns = turnClasses.find((c) => c.cls === "github").turns;
  const builders = subs.filter((a) => a.agentType === "phase-implementer" && a.calls > 0);
  const worstBuilder = builders.reduce((m, a) => Math.max(m, a.avgContext), 0);
  const target = (name, measurable, value, met, shown, need) => ({
    name,
    status: !measurable ? "not measurable" : met ? "met" : "missed",
    value: measurable ? value : null,
    shown: measurable ? shown : need,
  });
  const orchShare = share(orch.units);
  const wakesPerPart = parts ? githubTurns / parts : null;
  const usdPerKLines = costUsd !== null && linesAdded ? costUsd / (linesAdded / 1000) : null;
  const targets = [
    target("Orchestrator share of units < 15%", totalUnits > 0, orchShare, orchShare < 0.15, pctOf(orchShare), "no calls in the transcript"),
    target("No phase-implementer averaging > 250k context", builders.length > 0, worstBuilder, worstBuilder <= 250_000, `worst ${tok(worstBuilder)}`, "no phase-implementer transcripts"),
    target("GitHub wakes per merged part < 5", wakesPerPart !== null, wakesPerPart, wakesPerPart < 5, `${githubTurns} / ${parts} = ${wakesPerPart?.toFixed(1)}`, "needs --parts"),
    target("Dollars per 1k lines added < 20", usdPerKLines !== null, usdPerKLines, usdPerKLines < 20, `$${usdPerKLines?.toFixed(2)}`, "needs --cost-usd and --lines-added"),
    target("Coordinator-message re-writes <= 2", true, rewrites.afterCoordinator, rewrites.afterCoordinator <= 2, String(rewrites.afterCoordinator), ""),
  ];

  return {
    schema: 1,
    totals: { agents: all.length, calls: all.reduce((n, a) => n + a.calls, 0), units: totalUnits },
    usdPerUnit: costUsd !== null && totalUnits > 0 ? costUsd / totalUnits : null,
    inputs: { costUsd, linesAdded, parts },
    byType,
    costliest: costliest.map((a) => ({ ...a, share: share(a.units) })),
    turns: { classes: turnClasses, orchestratorUnits: orch.units, otherTags },
    followUps: { sendMessages, received },
    rewrites,
    guardLog,
    targets,
  };
}

function tok(n) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}k`;
  return String(Math.round(n));
}

function pctOf(fraction) {
  return `${(fraction * 100).toFixed(1)}%`;
}

// A description is the one free-text field allowed out (the brief a human
// already chose to label the agent with); keep it from breaking the table.
function cell(text) {
  const flat = String(text).replace(/\s+/g, " ").replace(/\|/g, "/").trim();
  return flat.length > 60 ? `${flat.slice(0, 57)}...` : flat;
}

/**
 * The block, as markdown that pastes into a milestone file unchanged. Its
 * first two lines are a contract with scripts/milestone.mjs.
 *
 * Same privacy rule as selfReport(): counts, token sums and agent
 * descriptions. No prompt text, no tool arguments, no file contents.
 */
export function renderMilestone(m) {
  const usd = m.usdPerUnit;
  const money = (units) => (usd === null ? [] : [`$${(units * usd).toFixed(2)}`]);
  const head = (cols) => [`| ${cols.join(" | ")} |`, `|${cols.map(() => "---").join("|")}|`];
  const row = (cols) => `| ${cols.join(" | ")} |`;
  const dollarsCol = usd === null ? [] : ["≈ $"];
  const L = [MILESTONE_SPEND_HEADING, MILESTONE_SPEND_MARKER, ""];

  L.push(
    `${m.totals.agents} agents, ${m.totals.calls.toLocaleString("en-US")} API calls, ${tok(m.totals.units)} units` +
      (m.inputs.costUsd !== null ? `, $${m.inputs.costUsd.toFixed(2)} recorded` : "") +
      ". One call is one assistant `message.id`; units = input + 1.25 × cache write + 0.1 × cache read (output excluded, transcripts understate it).",
  );
  L.push("");

  L.push("**By agent type**", "");
  L.push(...head(["Who", "Agents", "Calls", "Avg context", "Peak context", "Units", ...dollarsCol, "Share"]));
  for (const t of m.byType) {
    L.push(row([`\`${t.agentType}\``, t.agents, t.calls, tok(t.avgContext), tok(t.peakContext), tok(t.units), ...money(t.units), pctOf(t.share)]));
  }
  L.push("");

  L.push("**Costliest agents**", "");
  if (m.costliest.length === 0) L.push("No subagent transcripts found.");
  else {
    L.push(...head(["Agent (description)", "Type", "Calls", "Avg context", "Peak context", "Units", ...dollarsCol]));
    for (const a of m.costliest) {
      L.push(row([cell(a.description), `\`${a.agentType}\``, a.calls, tok(a.avgContext), tok(a.peakContext), tok(a.units), ...money(a.units)]));
    }
  }
  L.push("");

  L.push("**Orchestrator turns, by what started them**", "");
  L.push(...head(["What started the turn", "Turns", "Units", ...dollarsCol, "Share of orchestrator", "Idle"]));
  for (const c of m.turns.classes) {
    const ofOrch = m.turns.orchestratorUnits > 0 ? pctOf(c.units / m.turns.orchestratorUnits) : "n/a";
    // Idle is only a claim about notification turns: "read it, did nothing".
    const idle = c.cls === "github" ? `${c.idle} of ${c.turns} (${tok(c.idleUnits)} units)` : "–";
    L.push(row([TURN_LABELS[c.cls], c.turns, tok(c.units), ...money(c.units), ofOrch, idle]));
  }
  const tags = Object.entries(m.turns.otherTags);
  if (tags.length > 0) {
    L.push("");
    L.push(`Unrecognised frames, by opening tag: ${tags.map(([t, n]) => `\`${t}\` × ${n}`).join(", ")}. Add a row to \`TURN_CLASSES\`.`);
  }
  L.push("");

  L.push("**Follow-ups and cache re-writes**", "");
  L.push(...head(["Measure", "Count", "Tokens"]));
  const totalReceived = m.followUps.received.reduce((n, r) => n + r.messages, 0);
  L.push(row(["`SendMessage` calls by the orchestrator", m.followUps.sendMessages, "–"]));
  L.push(row([`Coordinator messages received mid-life, by ${m.followUps.received.length} subagent(s)`, totalReceived, "–"]));
  L.push(row(["Full cache re-writes in subagents", m.rewrites.count, tok(m.rewrites.tokens)]));
  L.push(row(["— directly after a coordinator message", m.rewrites.afterCoordinator, tok(m.rewrites.afterCoordinatorTokens)]));
  if (m.followUps.received.length > 0) {
    L.push("");
    L.push(
      "Most messaged: " +
        m.followUps.received.slice(0, 10).map((r) => `${cell(r.description)} (${r.messages})`).join("; ") +
        ".",
    );
  }
  L.push("");

  L.push("**Guard hooks**", "");
  const hooks = m.guardLog ? Object.entries(m.guardLog.byHook) : [];
  if (hooks.length === 0) L.push("None recorded.");
  else {
    const decisions = [...new Set(["deny", "note", ...hooks.flatMap(([, d]) => Object.keys(d))])];
    L.push(...head(["Hook", ...decisions]));
    for (const [hook, d] of hooks.sort((a, b) => a[0].localeCompare(b[0]))) {
      L.push(row([`\`${cell(hook)}\``, ...decisions.map((k) => d[k] ?? 0)]));
    }
  }
  L.push("");

  L.push("**Targets**", "");
  L.push(...head(["Target", "Result", "Measured"]));
  for (const t of m.targets) L.push(row([t.name, t.status, t.shown]));

  return L.join("\n");
}

function numberFlag(name, raw) {
  if (raw === undefined) return null;
  const n = Number(raw);
  if (raw.trim() === "" || !Number.isFinite(n) || n < 0) {
    console.error(`session-metrics: ${name} needs a non-negative number, got "${raw}".`);
    process.exit(1);
  }
  return n;
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

  // --milestone <orchestrator-transcript.jsonl>: the `## Spend` block for a
  // milestone file. Run it before the cloud container is reclaimed; the
  // subagent transcripts beside the orchestrator's go with it.
  const milestone = get("--milestone");
  if (argv.includes("--milestone")) {
    if (!milestone || milestone.startsWith("--")) {
      console.error("session-metrics: --milestone needs the orchestrator's transcript (.jsonl).");
      process.exit(1);
    }
    try {
      statSync(milestone);
    } catch {
      console.error(`session-metrics: ${milestone} not found.`);
      console.error("Transcripts live on the machine (or cloud container) that ran the session.");
      process.exit(1);
    }
    const result = computeMilestone(loadMilestone(milestone), {
      costUsd: numberFlag("--cost-usd", get("--cost-usd")),
      linesAdded: numberFlag("--lines-added", get("--lines-added")),
      parts: numberFlag("--parts", get("--parts")),
      guardLog: readGuardLog(get("--guard-log") ?? defaultGuardLogPath()),
    });
    console.log(asJson ? JSON.stringify(result, null, 2) : renderMilestone(result));
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
