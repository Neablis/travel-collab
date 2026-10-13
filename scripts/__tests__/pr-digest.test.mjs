import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { diffEntry, digest, excerpt, main, parseRepo, summarizeChecks, summarizePr } from "../pr-digest.mjs";

// The digest is read by an orchestrator whose every token is re-read on later
// turns, so these pin what it prints, not only what it computes. No network:
// `main` takes the `gh api` function as an argument.

const NOW = new Date("2026-10-13T08:00:00Z");
const SHA_A = "1a2b3c4".padEnd(40, "0");
const SHA_B = "5d6e7f8".padEnd(40, "0");

const run = (id, name, status, conclusion = null) => ({ id, name, status, conclusion });
const user = (login, type = "User") => ({ login, type });

function rawPr(over = {}) {
  return {
    pr: {
      number: 431,
      state: "open",
      draft: false,
      mergeable_state: "clean",
      head: { sha: SHA_A },
      ...over.pr,
    },
    checkRuns: over.checkRuns ?? [run(1, "ci-ok", "completed", "success"), run(2, "test / unit", "completed", "success")],
    issueComments: over.issueComments ?? [],
    reviewComments: over.reviewComments ?? [],
    reviews: over.reviews ?? [],
  };
}

test("parseRepo reads owner/repo from https, ssh and a proxied remote", () => {
  assert.equal(parseRepo("https://github.com/Neablis/travel-collab"), "Neablis/travel-collab");
  assert.equal(parseRepo("git@github.com:Neablis/travel-collab.git"), "Neablis/travel-collab");
  assert.equal(parseRepo("http://local_proxy@127.0.0.1:41823/git/Neablis/travel-collab\n"), "Neablis/travel-collab");
});

test("checks: ci-ok's conclusion, failed names without ci-ok, running count, newest re-run wins", () => {
  const ci = summarizeChecks([
    run(1, "ci-ok", "completed", "failure"),
    run(2, "test / unit", "completed", "failure"),
    run(9, "test / unit", "completed", "success"),
    run(3, "static / lint", "completed", "timed_out"),
    run(4, "test / e2e (1/2)", "in_progress"),
    run(5, "changes", "completed", "skipped"),
  ]);
  assert.deepEqual(ci, { ciOk: "failure", failed: ["static / lint"], pending: 1 });
  assert.equal(summarizeChecks([run(1, "ci-ok", "queued")]).ciOk, "pending");
  assert.equal(summarizeChecks([]).ciOk, "none");
});

test("excerpt drops a bot's HTML comment preamble and markup and caps the length", () => {
  // A hidden comment can hold a `>`; a plain tag strip would leak its tail.
  const body = "<!-- internal state: a > b -->\n## **Walkthrough**\n`x`  done";
  assert.equal(excerpt(body), "Walkthrough x done");
  const long = excerpt("a".repeat(200));
  assert.equal(long.length, 80);
  assert.ok(long.endsWith("…"));
});

test("first run prints full state, two lines at most, with the newest comment and bots labelled", () => {
  const cur = summarizePr(
    rawPr({
      issueComments: [
        { user: user("Neablis"), created_at: "2026-10-13T06:00:00Z", body: "older" },
        { user: user("coderabbitai", "Bot"), created_at: "2026-10-13T06:40:00Z", body: "<!-- x -->Looks fine" },
      ],
      reviews: [{ user: user("Neablis"), submitted_at: "2026-10-12T22:00:00Z", state: "APPROVED", body: "" }],
    }),
  );
  const { lines } = digest(null, [cur], { now: NOW });
  assert.deepEqual(lines, [
    "PR 431 open head 1a2b3c4 merge clean; ci-ok success; 2 comments, 0 review comments, 1 review",
    '  newest: coderabbitai[bot] 06:40Z "Looks fine"',
  ]);
});

test("a changed PR prints only what changed; an untouched one is listed as unchanged", () => {
  const before = summarizePr(rawPr({ checkRuns: [run(1, "ci-ok", "in_progress")] }));
  const other = summarizePr(rawPr({ pr: { number: 432 } }));
  const snapshot = { prs: { 431: before, 432: other } };
  const after = summarizePr(
    rawPr({
      pr: { head: { sha: SHA_B } },
      checkRuns: [run(7, "ci-ok", "completed", "success")],
      issueComments: [
        { user: user("Neablis"), created_at: "2026-10-13T06:30:00Z", body: "first" },
        { user: user("Neablis"), created_at: "2026-10-13T06:40:00Z", body: "please rebase" },
      ],
    }),
  );
  const { lines } = digest(snapshot, [after, other], { now: NOW });
  assert.deepEqual(lines, [
    "PR 431 head 1a2b3c4 → 5d6e7f8; ci-ok pending (1 running) → success",
    '  +2 comments (Neablis 06:40Z "please rebase")',
    "unchanged: PR 432",
  ]);
});

test("a failing check is named in the change line", () => {
  const before = summarizePr(rawPr());
  const after = summarizePr(
    rawPr({ checkRuns: [run(3, "ci-ok", "completed", "failure"), run(4, "test / e2e (1/2)", "completed", "failure")] }),
  );
  assert.deepEqual(diffEntry(before, after, NOW), ["PR 431 ci-ok success → failure (failed: test / e2e (1/2))"]);
});

test("mergeable 'unknown' while GitHub recomputes is neither reported nor stored", () => {
  const before = summarizePr(rawPr());
  const after = summarizePr(rawPr({ pr: { mergeable_state: "unknown" } }));
  const out = digest({ prs: { 431: before } }, [after], { now: NOW });
  assert.deepEqual(out.lines, ["unchanged: PR 431"]);
  assert.equal(out.snapshot.prs[431].mergeable, "clean");
  const dirty = summarizePr(rawPr({ pr: { mergeable_state: "dirty" } }));
  assert.deepEqual(diffEntry(before, dirty, NOW), ["PR 431 merge clean → dirty"]);
});

test("a merged PR is printed once with its merge sha, then dropped from the snapshot", () => {
  const before = summarizePr(rawPr());
  const merged = summarizePr({ pr: { number: 431, state: "closed", merged_at: "x", merge_commit_sha: SHA_B, head: { sha: SHA_A } } });
  const out = digest({ prs: { 431: before } }, [merged], { now: NOW });
  assert.deepEqual(out.lines, ["PR 431 merged as 5d6e7f8"]);
  assert.equal(out.snapshot.prs[431], undefined);
  const closed = summarizePr({ pr: { number: 433, state: "closed", merged_at: null, head: { sha: SHA_A } } });
  assert.deepEqual(digest({ prs: {} }, [closed]).lines, ["PR 433 closed unmerged (head 1a2b3c4)"]);
});

test("--all prints full state even against a snapshot; a failed fetch keeps the old entry", () => {
  const cur = summarizePr(rawPr());
  const all = digest({ prs: { 431: cur } }, [cur], { all: true, now: NOW });
  assert.match(all.lines[0], /^PR 431 open head 1a2b3c4 merge clean; ci-ok success;/);
  const failed = digest({ prs: { 431: cur } }, [{ number: 431, error: "HTTP 502" }], { now: NOW });
  assert.deepEqual(failed.lines, ["PR 431: gh api failed (HTTP 502)"]);
  assert.deepEqual(failed.snapshot.prs[431], cur);
});

// main() end to end against a fake `api`, in a real git repo, so the
// snapshot path and the listing of open PRs plus remembered ones are covered.
function fakeApi(prs) {
  const calls = [];
  const api = (path) => {
    calls.push(path);
    if (/\/pulls\?state=open/.test(path)) return [Object.values(prs).filter((p) => p.state === "open")];
    let m = path.match(/\/pulls\/(\d+)$/);
    if (m) return prs[m[1]];
    if (/check-runs/.test(path)) return [{ check_runs: [run(1, "ci-ok", "completed", "success")] }];
    return [[]];
  };
  return { api, calls };
}

function repo() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "tc-pr-digest-")));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["remote", "add", "origin", "https://github.com/o/r"], { cwd: dir });
  return dir;
}

test("main stores the snapshot in the git common dir and reports a merge on the next check-in", () => {
  const cwd = repo();
  const prs = { 431: rawPr().pr };
  const lines = [];
  const log = (l) => lines.push(l);
  assert.equal(main([], { api: fakeApi(prs).api, cwd, log, now: NOW }), 0);
  assert.match(lines[0], /^PR 431 open head 1a2b3c4/);
  const file = join(cwd, ".git", "pr-digest.json");
  assert.ok(existsSync(file));

  prs[431] = { ...prs[431], state: "closed", merged_at: "x", merge_commit_sha: SHA_B };
  lines.length = 0;
  const { api, calls } = fakeApi(prs);
  main([], { api, cwd, log, now: NOW });
  assert.deepEqual(lines, ["PR 431 merged as 5d6e7f8"]);
  assert.ok(calls.every((c) => c.startsWith("repos/o/r/")));
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")).prs, {});
});

test("main --no-save leaves no snapshot; an unknown flag is a usage error", () => {
  const cwd = repo();
  const lines = [];
  main(["431", "--no-save"], { api: fakeApi({ 431: rawPr().pr }).api, cwd, log: (l) => lines.push(l), now: NOW });
  assert.equal(existsSync(join(cwd, ".git", "pr-digest.json")), false);
  assert.equal(main(["--json"], { api: () => assert.fail("no call"), cwd, log: () => {} }), 2);
});
