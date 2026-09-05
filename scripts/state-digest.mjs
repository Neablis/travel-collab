import { existsSync, readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

// THE STATE DIGEST: "where are we", answered deterministically, printed by the
// SessionStart hook so nobody has to ask.
//
// Why this exists, measured over 426 session transcripts on 2026-09-02
// (docs/reviews/2026-09-02-session-tooling-review.md):
//
//   F1  2,621 tool calls across 220 sessions re-read the same nine doc
//       sources — ~1.9M tokens, 16.9% of all non-browser tool output.
//   F2  66 of 72 main sessions spend their first 20 tool calls on
//       orientation: mean 7,760 tokens, median 6,037, before any work starts.
//   F8  /roadmap exists and answers this. It was invoked in 9 sessions; 109
//       read the STATUS/TODO/milestones trio anyway. The opt-in never happens.
//
// So this is a script and not a skill, a command, or a subagent. Nothing here
// needs judgement, and the three alternatives all cost a model turn plus their
// own instructions, and all three have to be *asked for*.
//
// Two hard rules, both of which are the whole point:
//
//  1. NO PROSE, NO JUDGEMENT. Every EXTRACTED fact carries a file:line
//     citation, so a session that needs the detail opens one file at one
//     offset instead of `cat`-ing 50KB of it — which is what produced F1a's
//     29k-char `sed -n '/^## Open/,/^## Resolved/p'` calls.
//     The exceptions are the fixed scaffolding — the banner, the DRIFT
//     verdict line, and the closing NEXT READ / VERIFY hints — which are
//     constants rather than readings and have nothing to cite. Stating the
//     rule as "every line" was inaccurate and made a contract nobody could
//     hold; it is the extracted facts that must be cited, and all of them are.
//  2. IT HAS A BUDGET: ~60-80 lines, <=2,500 tokens. A digest that grows into
//     a second copy of STATUS.md has failed at its only job. KI bodies are
//     never printed, and the KI block is a count plus the newest few rather
//     than the full list — see the note at that block for the measurement
//     behind it. scripts/__tests__ holds the test that fails if this
//     outgrows the budget.
//
// What it deliberately does NOT do:
//   - It does not audit worktrees. It prints a count and defers to the
//     `worktree-hygiene` skill, which is the thing that knows about staleness
//     and scope drift.
//   - It does not decide which source to believe when they disagree. It names
//     the mismatch mechanically and defers to /roadmap, whose whole turn is
//     that judgement.
//
// Never fails: this runs on the SessionStart path, so every section is
// individually guarded and the process exits 0 even when everything is
// missing. A digest is worth less than a session.

const DEFAULT_ROOT = fileURLToPath(new URL("..", import.meta.url));

const KI_TITLE_MAX = 54;
const STATUS_LINE_MAX = 96;
const STATUS_LINES = 3;
const WRAP_COLS = 98;
// Every list here is capped, so the output length is bounded no matter how the
// repo grows. That is the difference between a digest and a second STATUS.md:
// 42 open KIs today fits, and 200 would not, and the budget is not negotiable.
const KI_NEWEST = 5;
const PR_MAX_LINES = 8;
// `gh` may be absent, logged out, or talking to a slow network. None of those
// may hold up a session start, so the call is capped and its failure is a
// printed line rather than an exception.
const GH_TIMEOUT_MS = 5000;
const GIT_TIMEOUT_MS = 5000;

/** Runs a command, returning null on any failure at all (missing, timeout, non-zero). */
function run(cmd, args, { cwd, timeout }) {
  try {
    const result = spawnSync(cmd, args, { cwd, timeout, encoding: "utf8" });
    if (result.error || result.status !== 0) return null;
    return (result.stdout ?? "").trim();
  } catch {
    return null;
  }
}

function readLines(path) {
  if (!existsSync(path)) return null;
  try {
    return readFileSync(path, "utf8").split("\n");
  } catch {
    return null;
  }
}

/** Strips the markdown a heading or list item carries so a title reads as text. */
function plain(text) {
  return text
    .replace(/`/g, "")
    .replace(/\*\*/g, "")
    .replace(/~~/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(text, max) {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/** Milestone ids are M<n> with an optional letter suffix: M9, M17, M11a, M18b. */
function milestoneId(text) {
  const match = /\bM(\d+[a-z]?)\b/.exec(text ?? "");
  return match ? `M${match[1]}` : null;
}

// --- extraction -------------------------------------------------------------

/**
 * The "Current milestone" line at the bottom of docs/milestones/README.md.
 * AGENTS.md designates that line the single source of truth for the number,
 * and the gate-close checklist's step 4 is what bumps it.
 */
function readCurrentMilestone(root) {
  const rel = "docs/milestones/README.md";
  const lines = readLines(join(root, rel));
  if (!lines) return { rel, missing: true };
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const match = /^Current milestone:\s*(.+?)\s*$/.exec(lines[i]);
    if (!match) continue;
    const label = plain(match[1]);
    return { rel, line: i + 1, label, id: milestoneId(label) };
  }
  return { rel, missing: true };
}

/** The current milestone's own file, and how much of its exit gate is ticked. */
function readMilestoneGate(root, id) {
  if (!id) return null;
  const dir = join(root, "docs/milestones");
  let name;
  try {
    name = readdirSync(dir).find((f) => f.startsWith(`${id}-`) && f.endsWith(".md"));
  } catch {
    return null;
  }
  if (!name) return null;
  const rel = `docs/milestones/${name}`;
  const lines = readLines(join(dir, name));
  if (!lines) return { rel };

  const start = lines.findIndex((l) => /^##\s+Exit gate/i.test(l));
  if (start === -1) return { rel };
  let ticked = 0;
  let open = 0;
  let descoped = 0;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^##\s/.test(lines[i])) break;
    const box = /^\s*[-*]\s+\[( |x|X)\]\s*(.*)$/.exec(lines[i]);
    if (!box) continue;
    // A `- [ ] ~~…~~` box is scope struck out of the gate, not work outstanding.
    if (/^~~/.test(box[2])) descoped += 1;
    else if (box[1] === " ") open += 1;
    else ticked += 1;
  }
  return { rel, line: start + 1, ticked, open, descoped };
}

/**
 * TODO.md carries two claims about the current work and they are allowed to
 * disagree: the first unchecked item (the file's own stated rule) and the
 * explicit `← current milestone` marker (which the file says records a
 * Mitchell decision that overrides position). Read both; report both.
 */
function readTodo(root) {
  const rel = "TODO.md";
  const lines = readLines(join(root, rel));
  if (!lines) return { rel, missing: true };
  let first = null;
  let marker = null;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!/^\s*[-*]\s+\[/.test(line)) continue;
    if (!first && /^\s*[-*]\s+\[ \]/.test(line)) {
      // Cut at the `←` marker: what follows it is commentary on the decision,
      // and the marker itself is reported on its own line below.
      const text = plain(line.replace(/^\s*[-*]\s+\[ \]\s*/, "")).split("←")[0];
      first = { line: i + 1, text: truncate(text.trim(), 72) };
      first.id = milestoneId(first.text);
    }
    if (!marker && /←\s*\**current milestone/i.test(line)) {
      marker = { line: i + 1, id: milestoneId(plain(line)) };
    }
  }
  return { rel, first, marker };
}

/**
 * STATUS.md's leading "where the work is" block only — the first few lines of
 * it, not the section. The file is 46KB and this is the part that answers
 * "what is in flight"; everything else it says is a pointer to somewhere else.
 */
function readStatus(root) {
  const rel = "docs/STATUS.md";
  const lines = readLines(join(root, rel));
  if (!lines) return { rel, missing: true };
  const start = lines.findIndex((l) => /^##\s+Where the work is/i.test(l));
  if (start === -1) return { rel, missing: true };
  const said = [];
  let end = lines.length;
  for (let i = start + 1; i < lines.length && said.length < STATUS_LINES; i += 1) {
    if (/^##\s/.test(lines[i])) {
      end = i;
      break;
    }
    const text = plain(lines[i]);
    // Tables and rules carry no sentence; the PR table in particular is
    // already covered, and better, by the live `gh pr list` below. A line
    // ending in a colon is a lead-in to content this digest is not going to
    // print, and "Two things a fresh session must not miss:" with neither
    // thing under it is worse than not printing it at all.
    if (!text || text.startsWith("|") || /^-{3,}$/.test(text) || text.endsWith(":")) continue;
    said.push(truncate(text, STATUS_LINE_MAX));
  }
  const body = lines.slice(start, end).join(" ");
  return { rel, line: start + 1, said, mentions: body };
}

/** KI titles, never KI bodies. The list is the index; the files are the detail. */
function readKnownIssues(root) {
  const rel = "docs/known-issues/open";
  let names;
  try {
    names = readdirSync(join(root, rel))
      .filter((f) => f.endsWith(".md") && f !== "README.md")
      .sort();
  } catch {
    return { rel, missing: true, items: [] };
  }
  const items = [];
  for (const name of names) {
    const lines = readLines(join(root, rel, name)) ?? [];
    const heading = lines.find((l) => /^#{1,6}\s+\S/.test(l));
    const text = plain((heading ?? name.replace(/\.md$/, "")).replace(/^#{1,6}\s+/, ""));
    // Entries read "KI-3 — Minor M5 re-skin…": keep the id whole and truncate
    // only the title, so the id is always usable as a grep term.
    const split = /^(KI-[\w-]+)\s*[—:-]\s*(.*)$/.exec(text);
    items.push(
      split ? `${split[1]} ${truncate(split[2], KI_TITLE_MAX)}` : truncate(text, KI_TITLE_MAX + 10),
    );
  }
  return { rel, items };
}

function readGit(root) {
  const branch = run("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd: root,
    timeout: GIT_TIMEOUT_MS,
  });
  const log = run("git", ["log", "--oneline", "-5", "origin/main"], {
    cwd: root,
    timeout: GIT_TIMEOUT_MS,
  });
  const worktrees = run("git", ["worktree", "list"], { cwd: root, timeout: GIT_TIMEOUT_MS });
  const ahead = run("git", ["rev-list", "--count", "origin/main..HEAD"], {
    cwd: root,
    timeout: GIT_TIMEOUT_MS,
  });
  return {
    branch,
    ahead: ahead === null ? null : Number(ahead),
    mainLog: log === null ? null : log.split("\n").filter(Boolean),
    worktrees: worktrees === null ? null : worktrees.split("\n").filter(Boolean).length,
  };
}

/**
 * Open PRs. `gh` is optional infrastructure: it may not be installed, may not
 * be authenticated, and may be slow. Every one of those prints "(gh
 * unavailable)" and costs the session nothing.
 */
function readPullRequests(root, { skip }) {
  if (skip) return { unavailable: "--no-gh" };
  const out = run(
    "gh",
    [
      "pr",
      "list",
      "--state",
      "open",
      "--json",
      "number,title,headRefName,createdAt",
      "--limit",
      "20",
    ],
    { cwd: root, timeout: GH_TIMEOUT_MS },
  );
  if (out === null) return { unavailable: "gh unavailable" };
  try {
    const parsed = JSON.parse(out);
    if (!Array.isArray(parsed)) return { unavailable: "gh returned an unexpected shape" };
    return {
      prs: parsed.map((pr) => ({
        number: pr.number,
        title: String(pr.title ?? ""),
        branch: String(pr.headRefName ?? ""),
        created: String(pr.createdAt ?? "").slice(0, 10),
      })),
    };
  } catch {
    return { unavailable: "gh returned unparseable JSON" };
  }
}

// --- drift ------------------------------------------------------------------

/**
 * Mechanically detectable disagreement only. This never says which source is
 * right — AGENTS.md's gate-close checklist requires four flags to flip in one
 * commit, so a mismatch means one of them was missed, and deciding *which*
 * needs a turn's judgement. That turn is /roadmap's.
 */
function findDrift({ milestone, todo, gate, status }) {
  const drift = [];
  const current = milestone.id;

  if (current && todo.marker?.id && todo.marker.id !== current) {
    drift.push(
      `TODO.md's "← current milestone" marker says ${todo.marker.id}, ` +
        `milestones/README.md says ${current}  [${todo.rel}:${todo.marker.line} vs ${milestone.rel}:${milestone.line}]`,
    );
  }
  if (current && todo.first?.id && todo.first.id !== current) {
    drift.push(
      `TODO.md's first unchecked item is ${todo.first.id}, not ${current} ` +
        `(fine if the marker names a decision — check it)  [${todo.rel}:${todo.first.line}]`,
    );
  }
  if (current && status.mentions && !new RegExp(`\\b${current}\\b`).test(status.mentions)) {
    drift.push(
      `STATUS.md's "Where the work is right now" never mentions ${current} — ` +
        `gate-close step 5  [${status.rel}:${status.line}]`,
    );
  }
  if (gate && gate.open === 0 && gate.ticked > 0 && todo.first?.id === current) {
    drift.push(
      `every ${current} exit-gate box is ticked but TODO.md still has it unchecked ` +
        `[${gate.rel}:${gate.line} vs ${todo.rel}:${todo.first.line}]`,
    );
  }
  return drift;
}

// --- rendering --------------------------------------------------------------

function wrap(items, separator, indent, cols) {
  const out = [];
  let line = "";
  for (const item of items) {
    const candidate = line ? `${line}${separator}${item}` : item;
    if (candidate.length + indent.length > cols && line) {
      out.push(indent + line);
      line = item;
    } else {
      line = candidate;
    }
  }
  if (line) out.push(indent + line);
  return out;
}

function render(d) {
  const out = [];
  const cite = (rel, line) => (line ? `  [${rel}:${line}]` : `  [${rel}]`);

  out.push(`STATE DIGEST — ${d.branch ?? "unknown branch"} — facts only, cited; \`pnpm state\``);
  out.push("");

  out.push(
    d.milestone.label
      ? `CURRENT MILESTONE: ${d.milestone.label}${cite(d.milestone.rel, d.milestone.line)}`
      : `CURRENT MILESTONE: (not found in ${d.milestone.rel})`,
  );
  if (d.gate?.line !== undefined) {
    const descoped = d.gate.descoped ? `, ${d.gate.descoped} descoped` : "";
    out.push(
      `  EXIT GATE: ${d.gate.ticked}/${d.gate.ticked + d.gate.open} ticked${descoped}` +
        cite(d.gate.rel, d.gate.line),
    );
  }
  out.push(
    d.todo.first
      ? `FIRST UNCHECKED TODO: ${d.todo.first.text}${cite(d.todo.rel, d.todo.first.line)}`
      : `FIRST UNCHECKED TODO: none${cite(d.todo.rel)}`,
  );
  if (d.todo.marker) {
    out.push(
      `  MARKED CURRENT: ${d.todo.marker.id ?? "?"}${cite(d.todo.rel, d.todo.marker.line)}`,
    );
  }
  out.push("");

  out.push(`STATUS SAYS${cite(d.status.rel, d.status.line)}`);
  for (const line of d.status.said ?? []) out.push(`  ${line}`);
  if (!d.status.said?.length) out.push("  (no leading block found)");
  out.push("");

  if (d.drift.length === 0) {
    out.push("DRIFT: none detected by the four mechanical checks.");
  } else {
    out.push(`DRIFT: ${d.drift.length} — these are mismatches, not verdicts. Run /roadmap.`);
    for (const line of d.drift) out.push(`  - ${line}`);
  }
  out.push("");

  if (d.prs.unavailable) {
    out.push(`OPEN PRS: (${d.prs.unavailable})`);
  } else if (d.prs.prs.length === 0) {
    out.push("OPEN PRS: none");
  } else {
    out.push(`OPEN PRS: ${d.prs.prs.length}`);
    for (const pr of d.prs.prs.slice(0, PR_MAX_LINES)) {
      out.push(`  #${pr.number} ${truncate(pr.title, 62)} [${pr.branch}] ${pr.created}`);
    }
    if (d.prs.prs.length > PR_MAX_LINES) {
      out.push(`  …and ${d.prs.prs.length - PR_MAX_LINES} more (gh pr list)`);
    }
  }

  out.push(
    d.git.worktrees === null
      ? "WORKTREES: (git unavailable)"
      : `WORKTREES: ${d.git.worktrees} — run the worktree-hygiene skill to audit staleness and scope drift.`,
  );

  if (d.git.mainLog) {
    out.push("ORIGIN/MAIN:");
    for (const line of d.git.mainLog) out.push(`  ${truncate(line, 92)}`);
  } else {
    out.push("ORIGIN/MAIN: (unavailable — no origin/main, or git is not on PATH)");
  }
  if (typeof d.git.ahead === "number" && d.git.ahead > 0) {
    out.push(`  this branch is ${d.git.ahead} commit(s) ahead of origin/main`);
  }
  out.push("");

  if (d.ki.missing) {
    out.push(`OPEN KIs: (${d.ki.rel} not found)`);
  } else {
    // A COUNT AND A GREP, not a list. This block printed every open title and
    // ran to 49 of the digest's 79 lines — 62% of a session-start hook — while
    // still truncating, so it paid a full-list price for a partial list.
    //
    // The titles were also the wrong shape for their one job. Their value is
    // "has somebody already filed my symptom?", and you do not answer that by
    // skimming 46 truncated titles; you answer it with the grep CLAUDE.md rule
    // 2 already requires before calling anything flaky. So print the number
    // (which is the orienting fact) and the command (which is the action), and
    // let the newest few stand in for "what has been filed lately" — that being
    // the slice most likely to concern work still in flight.
    //
    // Deviation from R1's spec in the review, which asked for titles. Taken
    // deliberately, on R1's own budget constraint and the builder's own note
    // that this was the first thing to cut. Revert by restoring the wrap() call.
    out.push(`OPEN KIs: ${d.ki.items.length} — before calling anything flaky, grep ${d.ki.rel}/ for the symptom (CLAUDE.md rule 2).`);
    const newest = d.ki.items.slice(-KI_NEWEST);
    if (newest.length) {
      out.push(`  newest ${newest.length}:`);
      out.push(...wrap(newest, " / ", "    ", WRAP_COLS));
    }
  }
  out.push("");

  out.push(`NEXT READ: ${d.nextRead}`);
  out.push(
    "VERIFY: dispatch phase-verifier — it drives the PR's Vercel preview, so the browser walk needs no local infra.",
  );
  return out.join("\n");
}

/** The one file this state implies. Deterministic, not a recommendation engine. */
function nextRead({ drift, gate, milestone, status }) {
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  if (drift.length > 0) {
    return `/roadmap — ${plural(drift.length, "mechanical mismatch", "mechanical mismatches")} above need the judgement a script cannot make.`;
  }
  if (gate?.line !== undefined && gate.open > 0) {
    return `${gate.rel}:${gate.line} — ${plural(gate.open, "exit-gate box", "exit-gate boxes")} still open. That is what is left of ${milestone.id ?? "the milestone"}.`;
  }
  if (status.line) return `${status.rel}:${status.line} — the in-flight block, in full.`;
  return `${milestone.rel} — nothing else is out of place.`;
}

// --- entry point ------------------------------------------------------------

function collect(root, options) {
  const milestone = readCurrentMilestone(root);
  const gate = readMilestoneGate(root, milestone.id);
  const todo = readTodo(root);
  const status = readStatus(root);
  const ki = readKnownIssues(root);
  const git = readGit(root);
  const prs = readPullRequests(root, options);
  const drift = findDrift({ milestone, todo, gate, status });
  // `mentions` is the whole section, read only so the drift check can ask
  // whether the milestone id appears in it. It must not reach the output — in
  // --json it would be the single largest field, and printing STATUS.md back
  // is the exact thing this script exists to stop.
  delete status.mentions;
  const digest = {
    branch: git.branch,
    milestone,
    gate,
    todo,
    status,
    ki,
    git,
    prs,
    drift,
  };
  digest.nextRead = nextRead({ drift, gate, milestone, status });
  return digest;
}

function main(argv) {
  const args = argv.slice(2);
  const options = { skip: args.includes("--no-gh") };
  const asJson = args.includes("--json");
  const root = args.find((a) => !a.startsWith("--")) ?? DEFAULT_ROOT;

  const digest = collect(root, options);
  if (asJson) {
    // The machine shape carries everything, including the KI titles and the
    // status lines the human view truncates.
    process.stdout.write(`${JSON.stringify(digest, null, 2)}\n`);
  } else {
    process.stdout.write(`${render(digest)}\n`);
  }
}

try {
  main(process.argv);
} catch (error) {
  // Advisory to the end: this is wired into SessionStart, and no failure here
  // is worth a failed session. Say what broke and get out of the way.
  process.stderr.write(`state-digest: could not build the digest (${error?.message ?? error})\n`);
}
process.exitCode = 0;
