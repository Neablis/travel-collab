import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// THE PR DIGEST: what changed on this repo's PRs since the last time anyone
// asked, in one call and a few lines.
//
//   pnpm -s pr-digest [<n> ...] [--all] [--no-save]
//
// With no numbers it covers every open PR plus every PR the stored snapshot
// still holds (so a PR that merged since the last check-in is reported once,
// as merged, and then dropped), and saves the snapshot. With numbers it only
// reads: it diffs against the snapshot and never writes it, as if `--no-save`
// were given. `--all` prints full state instead of changes; `--no-save` leaves
// the snapshot as it was.
//
// Why this exists (2026-10-13, after the M45 retro): the milestone
// orchestrator stopped subscribing to GitHub PR activity. Every event woke it
// and re-read its whole context to learn, mostly, that nothing it would act on
// had happened. It now arms long `send_later` check-ins and, on each one, runs
// this once and acts only on what it prints. So the output is budgeted: no
// JSON, at most two lines for a PR that changed, one line for all the rest.
//
// REST only (`gh api`). GraphQL answers 403 in cloud sessions, which is why
// `pnpm state` prints "gh unavailable" there; nothing here may depend on it.
//
// The snapshot lives in the git common dir, so every worktree of this clone
// finds it. It is a cursor, and only the orchestrator's form (no numbers)
// moves it: an implementer that ran `pr-digest 437` twice and saved would
// consume part 3's `success → failure`, and the next check-in would print
// `unchanged: PR 437` (PR 431's review, finding 1).
//
// Shape: everything between the `gh api` calls and the printed lines is pure
// (summarizePr, diffEntry, fullLines, digest) and unit-tested with fixture
// objects in scripts/__tests__/pr-digest.test.mjs. The network is one
// injectable function, `api(path)`.

const EXCERPT = 80;
const FAILED = new Set(["failure", "timed_out", "cancelled", "action_required", "startup_failure"]);

/** owner/repo from any remote URL form: https, ssh, or a proxied `/git/owner/repo`. */
export function parseRepo(url) {
  const m = String(url)
    .trim()
    .replace(/\.git$/, "")
    .match(/[/:]([^/:]+)\/([^/:]+)$/);
  return m ? `${m[1]}/${m[2]}` : null;
}

const short = (sha) => (sha ? String(sha).slice(0, 7) : "?");

function isBot(user) {
  return user?.type === "Bot" || /\[bot\]$/.test(user?.login ?? "");
}

function who(user) {
  const login = user?.login ?? "?";
  return isBot(user) && !login.endsWith("[bot]") ? `${login}[bot]` : login;
}

/** One line of a comment body: HTML comments, markup and whitespace removed. */
export function excerpt(body, max = EXCERPT) {
  const text = String(body ?? "")
    .replace(/<!--[\s\S]*?(?:-->|$)/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/[`*_#>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** The count and newest entry of one kind of comment. */
function tally(items, at) {
  const list = (items ?? []).filter((c) => c && at(c));
  if (!list.length) return { count: 0, newest: null };
  const n = list.reduce((a, b) => (at(b) > at(a) ? b : a));
  const state = n.state && n.state !== "COMMENTED" ? `${n.state} ` : "";
  return {
    count: list.length,
    newest: { author: who(n.user), at: at(n), text: `${state}${excerpt(n.body)}`.trim() },
  };
}

/** ci-ok's state, failed check names and how many are still running, on one head. */
export function summarizeChecks(checkRuns) {
  // A re-run leaves the old run beside the new one; the newest of each name wins.
  const latest = new Map();
  for (const r of checkRuns ?? []) {
    const prev = latest.get(r.name);
    if (!prev || (r.id ?? 0) > (prev.id ?? 0)) latest.set(r.name, r);
  }
  const runs = [...latest.values()];
  const ci = latest.get("ci-ok");
  const ciOk = !ci ? "none" : ci.status === "completed" ? (ci.conclusion ?? "none") : "pending";
  const failed = runs
    .filter((r) => r.name !== "ci-ok" && r.status === "completed" && FAILED.has(r.conclusion))
    .map((r) => r.name)
    .sort();
  const pending = runs.filter((r) => r.status !== "completed").length;
  return { ciOk, failed, pending };
}

/** The snapshot entry for one PR, from the raw REST responses. */
export function summarizePr({ pr, checkRuns, issueComments, reviewComments, reviews }) {
  const state = pr.merged_at || pr.merged ? "merged" : pr.state === "closed" ? "closed" : "open";
  const entry = {
    number: pr.number,
    state,
    mergeSha: state === "merged" ? (pr.merge_commit_sha ?? null) : null,
    draft: Boolean(pr.draft),
    mergeable: pr.mergeable_state ?? "unknown",
    head: pr.head?.sha ?? null,
  };
  if (state !== "open") return entry;
  return {
    ...entry,
    ci: summarizeChecks(checkRuns),
    comments: tally(issueComments, (c) => c.created_at),
    reviewComments: tally(reviewComments, (c) => c.created_at),
    reviews: tally(reviews, (r) => r.submitted_at),
  };
}

/** "06:40Z" today, "10-12 06:40Z" otherwise; UTC either way. */
export function stamp(iso, now = new Date()) {
  if (!iso) return "?";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "?";
  const hm = d.toISOString().slice(11, 16);
  return d.toISOString().slice(0, 10) === now.toISOString().slice(0, 10)
    ? `${hm}Z`
    : `${d.toISOString().slice(5, 10)} ${hm}Z`;
}

// ci-ok `needs` every other job (ci.yml), so GitHub creates no check run for
// it until they all finish. "none" with jobs running is therefore a normal
// CI run, and must not read like "CI never started".
const ciRunning = (ci) => ci.ciOk === "none" && ci.pending > 0;

function ciLabel(ci) {
  if (!ci) return "ci-ok ?";
  if (ciRunning(ci)) {
    const failed = ci.failed.length ? ` (failed: ${ci.failed.join(", ")})` : "";
    return `ci running (${ci.pending} pending)${failed}`;
  }
  let s = `ci-ok ${ci.ciOk}`;
  if (ci.failed.length) s += ` (failed: ${ci.failed.join(", ")})`;
  if (ci.ciOk === "pending" && ci.pending) s += ` (${ci.pending} running)`;
  return s;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const KINDS = [
  ["comments", "comment"],
  ["reviewComments", "review comment"],
  ["reviews", "review"],
];

function newestNote(newest, now) {
  return `${newest.author} ${stamp(newest.at, now)} "${newest.text}"`;
}

function terminalLine(cur) {
  return cur.state === "merged"
    ? `PR ${cur.number} merged as ${short(cur.mergeSha)}`
    : `PR ${cur.number} closed unmerged (head ${short(cur.head)})`;
}

/** Full state for one PR, in at most two lines. */
export function fullLines(cur, now = new Date()) {
  if (cur.state !== "open") return [terminalLine(cur)];
  const counts = KINDS.map(([k, w]) => plural(cur[k]?.count ?? 0, w)).join(", ");
  const first =
    `PR ${cur.number} open${cur.draft ? " draft" : ""} head ${short(cur.head)} ` +
    `merge ${cur.mergeable}; ${ciLabel(cur.ci)}; ${counts}`;
  const newest = KINDS.map(([k]) => cur[k]?.newest)
    .filter(Boolean)
    .reduce((a, b) => (!a || b.at > a.at ? b : a), null);
  return newest ? [first, `  newest: ${newestNote(newest, now)}`] : [first];
}

/**
 * What changed from `prev` to `cur`, as at most two lines; [] when nothing
 * the orchestrator would act on did.
 */
export function diffEntry(prev, cur, now = new Date()) {
  if (!prev) return fullLines(cur, now);
  if (cur.state !== "open") return [terminalLine(cur)];
  const state = [];
  if (prev.head !== cur.head) state.push(`head ${short(prev.head)} → ${short(cur.head)}`);
  if (prev.draft !== cur.draft) state.push(cur.draft ? "ready → draft" : "draft → ready");
  // "unknown" on either side is GitHub recomputing, not a change: a PR first
  // seen just after its push is stored as "unknown".
  const settled = cur.mergeable !== "unknown" && prev.mergeable !== "unknown";
  if (settled && prev.mergeable !== cur.mergeable) state.push(`merge ${prev.mergeable} → ${cur.mergeable}`);
  const pc = prev.ci ?? { ciOk: "?", failed: [], pending: 0 };
  const ciChanged =
    pc.ciOk !== cur.ci.ciOk || ciRunning(pc) !== ciRunning(cur.ci) || pc.failed.join("\0") !== cur.ci.failed.join("\0");
  if (ciChanged) {
    const from = ciLabel(pc);
    const to = ciLabel(cur.ci);
    state.push(`${from} → ${from.startsWith("ci-ok ") ? to.replace(/^ci-ok /, "") : to}`);
  }
  const talk = [];
  for (const [k, w] of KINDS) {
    const added = (cur[k]?.count ?? 0) - (prev[k]?.count ?? 0);
    if (added > 0) talk.push(`+${added} ${w}${added === 1 ? "" : "s"} (${newestNote(cur[k].newest, now)})`);
  }
  if (!state.length && !talk.length) return [];
  if (!state.length) return [`PR ${cur.number} ${talk.join("; ")}`];
  return [`PR ${cur.number} ${state.join("; ")}`, ...(talk.length ? [`  ${talk.join("; ")}`] : [])];
}

/**
 * The digest itself. `entries` are this run's summaries (or `{number, error}`
 * for a PR whose fetch failed). Returns the lines to print and the snapshot
 * to store: merged and closed PRs leave it, failed fetches keep their old
 * entry, PRs this run did not look at are untouched.
 */
export function digest(snapshot, entries, { all = false, now = new Date() } = {}) {
  const prev = snapshot?.prs ?? {};
  const prs = { ...prev };
  const lines = [];
  const unchanged = [];
  for (const cur of [...entries].sort((a, b) => a.number - b.number)) {
    if (cur.error) {
      lines.push(`PR ${cur.number}: gh api failed (${cur.error})`);
      continue;
    }
    const out = !snapshot || all ? fullLines(cur, now) : diffEntry(prev[cur.number], cur, now);
    if (out.length) lines.push(...out);
    else unchanged.push(`PR ${cur.number}`);
    if (cur.state === "open") {
      // GitHub answers "unknown" while it recomputes mergeability after a
      // push. Storing that would report a flap on every check-in.
      const keep = cur.mergeable === "unknown" && prev[cur.number] ? prev[cur.number].mergeable : cur.mergeable;
      prs[cur.number] = { ...cur, mergeable: keep };
    } else delete prs[cur.number];
  }
  if (unchanged.length) lines.push(`unchanged: ${unchanged.join(", ")}`);
  if (!lines.length) lines.push("no open PRs");
  return { lines, snapshot: { savedAt: now.toISOString(), prs } };
}

/** Everything `summarizePr` needs for one PR, through `api(path)`. */
export function fetchPr(api, repo, n) {
  const pr = api(`repos/${repo}/pulls/${n}`);
  if (pr.state !== "open") return summarizePr({ pr });
  const pages = (path) => [].concat(...api(`${path}${path.includes("?") ? "&" : "?"}per_page=100`, { paginate: true }));
  const checkPages = api(`repos/${repo}/commits/${pr.head.sha}/check-runs?per_page=100`, { paginate: true });
  return summarizePr({
    pr,
    checkRuns: [].concat(...checkPages.map((p) => p.check_runs ?? [])),
    issueComments: pages(`repos/${repo}/issues/${n}/comments`),
    reviewComments: pages(`repos/${repo}/pulls/${n}/comments`),
    reviews: pages(`repos/${repo}/pulls/${n}/reviews`),
  });
}

/** The real `api`: `gh api`, REST, every page slurped into an array when asked. */
function ghApi(path, { paginate = false } = {}) {
  const args = ["api", ...(paginate ? ["--paginate", "--slurp"] : []), path];
  const out = execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 << 20 });
  return JSON.parse(out);
}

function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

const firstLine = (e) => String(e?.stderr || e?.message || e).trim().split("\n")[0].slice(0, 120);

/** Parse argv, fetch, diff, print, save. Returns the exit code. */
export function main(argv, { api = ghApi, cwd = process.cwd(), log = console.log, now = new Date() } = {}) {
  const all = argv.includes("--all");
  const asked = argv.filter((a) => /^\d+$/.test(a)).map(Number);
  // Numbers mean a look at one PR, by anyone; only the full check-in saves.
  const save = !asked.length && !argv.includes("--no-save");
  const bad = argv.filter((a) => !/^\d+$/.test(a) && a !== "--all" && a !== "--no-save");
  if (bad.length) {
    log(`usage: pnpm -s pr-digest [<n> ...] [--all] [--no-save]  (numbers never save; unknown: ${bad.join(" ")})`);
    return 2;
  }
  let repo;
  let file;
  try {
    repo = parseRepo(git(["remote", "get-url", "origin"], cwd));
    file = join(git(["rev-parse", "--path-format=absolute", "--git-common-dir"], cwd), "pr-digest.json");
  } catch (e) {
    log(`pr-digest: not in a git clone with an origin (${firstLine(e)})`);
    return 1;
  }
  let snapshot = null;
  try {
    snapshot = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    snapshot = null; // A missing or corrupt snapshot is a first run, not a failure.
  }
  let numbers = asked;
  if (!numbers.length) {
    try {
      const open = [].concat(...api(`repos/${repo}/pulls?state=open&per_page=100`, { paginate: true }));
      numbers = [...new Set([...open.map((p) => p.number), ...Object.keys(snapshot?.prs ?? {}).map(Number)])];
    } catch (e) {
      log(`pr-digest: gh api failed listing open PRs (${firstLine(e)})`);
      return 1;
    }
  }
  const entries = numbers.map((n) => {
    try {
      return fetchPr(api, repo, n);
    } catch (e) {
      return { number: n, error: firstLine(e) };
    }
  });
  const out = digest(snapshot, entries, { all, now });
  for (const l of out.lines) log(l);
  if (save) {
    // Write then rename, so a concurrent reader sees the old snapshot or the new one, never half.
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(out.snapshot)}\n`);
    renameSync(tmp, file);
  }
  return 0;
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  process.exitCode = main(process.argv.slice(2));
}
