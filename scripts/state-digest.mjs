import { existsSync, readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { PART_BRANCH } from "./hooks/lib/part-branch.mjs";

// The roadmap readers live in ONE place so this digest and the commands that
// write these files cannot disagree about what they say. See the header of
// scripts/lib/roadmap-read.mjs — a tool built to report drift must not be able
// to drift from itself.
//
// This digest is ADVISORY: it degrades on a missing anchor rather than
// throwing, because a digest that can fail a session start is worth less than
// the session. Writing callers use assertAnchors() instead.
import {
  plain,
  truncate,
  milestoneId,
  readCurrentMilestone,
  readMilestoneGate,
  readTodo,
  readStatus,
  findDrift,
  inFlightMilestones,
  readMilestoneIndex,
} from "./lib/roadmap-read.mjs";

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

// --- extraction -------------------------------------------------------------

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
 * One word for a PR's checks. `ci-ok` is the one required check (CLAUDE.md
 * rule 4), so when it has reported it is the answer; otherwise the worst of
 * the rest. Check runs carry status/conclusion, commit statuses carry state.
 */
function summarizeChecks(rollup) {
  if (!Array.isArray(rollup) || rollup.length === 0) return "no checks";
  const verdict = (c) => {
    const v = String(c?.conclusion || c?.state || "").toUpperCase();
    if (c?.status && String(c.status).toUpperCase() !== "COMPLETED") return "pending";
    if (["SUCCESS", "NEUTRAL", "SKIPPED"].includes(v)) return "green";
    if (["PENDING", "EXPECTED", "QUEUED", ""].includes(v)) return "pending";
    return "red";
  };
  const required = rollup.find((c) => (c?.name ?? c?.context) === "ci-ok");
  if (required) return `ci-ok ${verdict(required)}`;
  const all = rollup.map(verdict);
  return `CI ${all.includes("red") ? "red" : all.includes("pending") ? "pending" : "green"}`;
}

/**
 * What GraphQL's `reviewDecision` would say, from REST reviews: each
 * reviewer's latest approving or blocking review counts; comments do not.
 */
function reviewDecision(reviews) {
  const latest = new Map();
  for (const r of reviews) {
    if (r?.state === "APPROVED" || r?.state === "CHANGES_REQUESTED" || r?.state === "DISMISSED") {
      latest.set(r.user?.login ?? "", r.state);
    }
  }
  const states = [...latest.values()];
  if (states.includes("CHANGES_REQUESTED")) return "changes requested";
  if (states.includes("APPROVED")) return "approved";
  return "no review decision";
}

/**
 * Open PRs. `gh` is optional infrastructure: it may not be installed, may not
 * be authenticated, and may be slow. Every one of those prints "(gh
 * unavailable)" and costs the session nothing.
 *
 * REST only (`gh api`), as in `pr-digest.mjs`: `gh pr list` is GraphQL, which
 * the cloud session proxy refuses, so this block used to read "(gh
 * unavailable)" in every cloud session. REST has no review decision field,
 * so it is derived from each reviewer's latest review. Checks and reviews
 * are fetched for milestone parts alone, since those are the only lines that
 * print them.
 */
function readPullRequests(root, { skip }) {
  if (skip) return { unavailable: "--no-gh" };
  const api = (path) => {
    const out = run("gh", ["api", path], { cwd: root, timeout: GH_TIMEOUT_MS });
    if (out === null) return null;
    try {
      return JSON.parse(out);
    } catch {
      return undefined;
    }
  };
  const parsed = api("repos/{owner}/{repo}/pulls?state=open&per_page=20");
  if (parsed === null) return { unavailable: "gh unavailable" };
  if (parsed === undefined) return { unavailable: "gh returned unparseable JSON" };
  if (!Array.isArray(parsed)) return { unavailable: "gh returned an unexpected shape" };
  const prs = parsed.map((pr) => ({
    number: pr.number,
    title: String(pr.title ?? ""),
    branch: String(pr.head?.ref ?? ""),
    sha: String(pr.head?.sha ?? ""),
    created: String(pr.created_at ?? "").slice(0, 10),
    draft: pr.draft === true,
  }));
  for (const pr of prs.filter((p) => PART_BRANCH.test(p.branch)).slice(0, PR_MAX_LINES)) {
    const checks = pr.sha ? api(`repos/{owner}/{repo}/commits/${pr.sha}/check-runs?per_page=100`) : null;
    pr.ci = Array.isArray(checks?.check_runs) ? summarizeChecks(checks.check_runs) : "checks unread";
    const reviews = api(`repos/{owner}/{repo}/pulls/${pr.number}/reviews?per_page=100`);
    pr.review = Array.isArray(reviews) ? reviewDecision(reviews) : "reviews unread";
  }
  return { prs };
}

/**
 * Whether production has the newest migration, computed rather than recalled.
 *
 * STATUS.md said "`migrate-production` has NOT run for M14" for three days
 * after runs 29 and 30 had applied 0029-0031 (checked 2026-09-27: 32 rows in
 * production's `drizzle.__drizzle_migrations`), and a session repeated it to
 * Mitchell as an outstanding operator task. A sentence about production is
 * true on the day it is written and never again, so the digest derives it:
 * a migration is applied when the commit that ADDED its file is an ancestor of
 * the last successful migrate-production run's head.
 *
 * Without `gh` it cannot know, and says so with the exact check to make —
 * "unverified" is the honest answer, and STATUS prose is not a substitute.
 */
const MIGRATIONS_DIR = "apps/web/drizzle";
const PENDING_MAX = 5;

function readProductionMigrations(root, { skip }) {
  let entries;
  try {
    entries = JSON.parse(readFileSync(join(root, MIGRATIONS_DIR, "meta/_journal.json"), "utf8")).entries;
  } catch {
    return null;
  }
  if (!Array.isArray(entries) || entries.length === 0) return null;
  // A migration can arrive only in a merge commit: renumbered while resolving
  // a collision with main (0035 → 0036, 2026-10-03). Plain `--diff-filter=A`
  // never reports a merge, so it answered nothing and the digest said "added
  // in ?". Falling back to the first-parent line, merges diffed against their
  // first parent, names the commit where the file landed on this line, which
  // is the commit a migrate-production head has to contain. The plain query
  // stays first because on a branch it names the commit that wrote the file,
  // where the fallback would name the branch's merge of main.
  const addedBy = (extra, tag) =>
    run("git", ["log", ...extra, "--diff-filter=A", "--format=%H", "-1", "--", `${MIGRATIONS_DIR}/${tag}.sql`], {
      cwd: root,
      timeout: GIT_TIMEOUT_MS,
    }) || null;
  const added = (tag) => addedBy([], tag) ?? addedBy(["-m", "--first-parent"], tag);
  const newest = { tag: entries[entries.length - 1].tag, sha: added(entries[entries.length - 1].tag) };
  const base = { total: entries.length, newest };
  if (skip) return { ...base, unverified: "--no-gh" };

  const out = run(
    "gh",
    [
      "run", "list", "--workflow", "migrate-production.yml", "--status", "success",
      "--limit", "1", "--json", "headSha,createdAt",
    ],
    { cwd: root, timeout: GH_TIMEOUT_MS },
  );
  if (out === null) return { ...base, unverified: "gh unavailable" };
  let last;
  try {
    last = JSON.parse(out)[0];
  } catch {
    return { ...base, unverified: "gh returned unparseable JSON" };
  }
  if (!last?.headSha) return { ...base, lastRun: null, pending: entries.slice(-PENDING_MAX).map((e) => e.tag) };

  const lastRun = { sha: String(last.headSha), date: String(last.createdAt ?? "").slice(0, 10) };
  const contains = (sha) =>
    sha !== null &&
    run("git", ["merge-base", "--is-ancestor", sha, lastRun.sha], { cwd: root, timeout: GIT_TIMEOUT_MS }) !== null;
  // Walk back from the newest until one is in; migrations apply in order, so
  // everything older than the first included one is in too.
  const pending = [];
  for (let i = entries.length - 1; i >= 0 && pending.length < PENDING_MAX; i -= 1) {
    const sha = added(entries[i].tag);
    if (sha === null) return { ...base, unverified: `no commit adds ${entries[i].tag}.sql (shallow clone?)` };
    if (contains(sha)) break;
    pending.unshift(entries[i].tag);
  }
  return { ...base, lastRun, pending };
}

// --- drift ------------------------------------------------------------------

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
      ? `ORDER (TODO.md rows, top down): ${d.todo.order.map((r) => r.id).join(" → ")}` +
          (d.todo.paused?.length ? `  (paused: ${d.todo.paused.map((r) => r.id).join(", ")})` : "") +
          cite(d.todo.rel, d.todo.first.line)
      : `ORDER (TODO.md rows, top down): none${cite(d.todo.rel)}`,
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
    out.push("DRIFT: none detected by the mechanical checks.");
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
      out.push(`  …and ${d.prs.prs.length - PR_MAX_LINES} more (pnpm -s pr-digest)`);
    }
  }

  // One line per open milestone part, so the orchestrator sees where each
  // part's PR stands without a gh call per PR. Merged parts have left this list.
  // Without gh it prints nothing: OPEN PRS already says gh is unavailable.
  if (!d.prs.unavailable) {
    const parts = d.prs.prs.filter((pr) => PART_BRANCH.test(pr.branch));
    if (parts.length > 0) {
      out.push(`MILESTONE PARTS: ${parts.length} open, not merged`);
      for (const pr of parts.slice(0, PR_MAX_LINES)) {
        out.push(`  PR ${pr.number} [${pr.branch}] ${pr.draft ? "draft" : "ready"}, ${pr.ci ?? "checks unread"}, ${pr.review ?? "reviews unread"}`);
      }
    }
  }

  out.push(
    d.git.worktrees === null
      ? "WORKTREES: (git unavailable)"
      : `WORKTREES: ${d.git.worktrees} — run the worktree-hygiene skill to audit staleness and scope drift.`,
  );

  if (d.prod) {
    const short = (sha) => (sha ? sha.slice(0, 7) : "?");
    const p = d.prod;
    if (p.unverified) {
      out.push(
        `PROD MIGRATIONS: unverified (${p.unverified}) — newest is ${p.newest.tag}, added in ` +
          `${short(p.newest.sha)}; it is applied iff the last successful migrate-production run's head contains that commit. STATUS prose is not evidence.`,
      );
    } else if (!p.lastRun) {
      out.push(`PROD MIGRATIONS: no successful migrate-production run found — dispatch it from main.`);
    } else if (p.pending.length === 0) {
      out.push(
        `PROD MIGRATIONS: all ${p.total} applied — last migrate-production run ${short(p.lastRun.sha)} ${p.lastRun.date} contains ${p.newest.tag}`,
      );
    } else {
      out.push(
        `PROD MIGRATIONS: ${p.pending.length}${p.pending.length === PENDING_MAX ? "+" : ""} NOT applied (${p.pending.join(", ")}) — ` +
          `last run ${short(p.lastRun.sha)} ${p.lastRun.date}; dispatch migrate-production from main.`,
      );
    }
  }

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
  // Name the extraction commands HERE rather than leaving them to be
  // discovered. docs/reviews/2026-09-02-session-tooling-review.md (F8)
  // measured the alternative: /roadmap was invoked in 9 sessions against 109
  // that read the same files by hand. A line in the thing that already fires
  // is the only delivery mechanism with a record in this repo.
  out.push(
    "INSTEAD OF READING: `pnpm milestones` (the table + disagreements) · " +
      "`pnpm candidates` (unscheduled ideas) · `pnpm lanes` (what this box can verify)",
  );
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
  let inFlight = [];
  try {
    inFlight = inFlightMilestones(readMilestoneIndex(root));
  } catch {
    // Advisory: a milestone file the index cannot read must not cost the session.
  }
  const drift = findDrift({ milestone, todo, gate, status, inFlight });
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
    prod: readProductionMigrations(root, options),
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
