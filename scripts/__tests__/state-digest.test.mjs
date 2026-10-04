import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIGEST = join(HERE, "..", "state-digest.mjs");
const REPO = join(HERE, "..", "..");

// The digest's whole value proposition is that it is small. These are the
// numbers from docs/reviews/2026-09-02-session-tooling-review.md's R1, and a
// digest over budget has failed at the one job it has, so they are asserted
// rather than aspired to. 4 chars/token is the review's own estimator.
const MAX_LINES = 80;
const MAX_TOKENS = 2500;

function runDigest(args = [], { cwd = REPO, env } = {}) {
  const result = spawnSync(process.execPath, [DIGEST, ...args], {
    cwd,
    encoding: "utf8",
    env: env ?? process.env,
  });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

/**
 * A repo root with just enough of the four state sources to be parseable, so
 * the parse assertions below are about known input rather than about whatever
 * the real docs happen to say today.
 */
function makeFixture(overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), "tc-state-digest-"));
  const files = {
    "docs/milestones/README.md": [
      "# Milestones",
      "",
      "| # | Name | Scope |",
      "|---|---|---|",
      "| M42 | The answer | Everything |",
      "",
      "Current milestone: **M42 — The answer**",
      "",
    ].join("\n"),
    "docs/milestones/M42-the-answer.md": [
      "# M42 — The answer",
      "",
      "## Scope",
      "",
      "- [x] not a gate box, wrong section",
      "",
      "## Exit gate",
      "",
      "- [x] The first thing works end to end",
      "- [ ] The second thing works end to end",
      "- [ ] ~~The third thing~~ — struck out of scope 2026-09-01",
      "",
      "## Deliberately not here",
      "",
      "- [ ] not a gate box either",
      "",
    ].join("\n"),
    "TODO.md": [
      "# TODO",
      "",
      "- [x] **M41 The question** → done",
      "- [ ] **M42 The answer** ← **current milestone** — placed 2026-09-01 by",
      "      Mitchell, with a long trailing sentence nobody needs in a digest.",
      "- [ ] **M43 Later** → not started",
      "",
    ].join("\n"),
    "docs/STATUS.md": [
      "# STATUS",
      "",
      "Preamble nobody needs.",
      "",
      "## Where the work is right now",
      "",
      "**M42 is landing, 2026-09-02.** One PR is open and green.",
      "",
      "| PR | State |",
      "|---|---|",
      "| #1 | open |",
      "",
      "A fresh session must not miss:",
      "",
      "The migration is not applied by merging.",
      "",
      "## Something else entirely",
      "",
      "Not part of the leading block.",
      "",
    ].join("\n"),
    "docs/known-issues/open/KI-007-a-thing-is-broken.md": [
      "### KI-7 — A thing is broken in a way worth writing down",
      "",
      "- **Severity:** annoying",
      "- A long body that must never appear in the digest: xyzzy-body-marker.",
      "",
    ].join("\n"),
    "docs/known-issues/open/KI-008-another-thing.md": ["### KI-8 — Another thing", ""].join("\n"),
    "docs/known-issues/open/README.md": "# not a KI\n",
    ...overrides,
  };
  for (const [name, source] of Object.entries(files)) {
    if (source === null) continue;
    const path = join(dir, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, source);
  }
  return dir;
}

/** A PATH holding only the stub commands given, so `gh`/`git` can be removed. */
function makeBin(stubs) {
  const dir = mkdtempSync(join(tmpdir(), "tc-state-digest-bin-"));
  for (const [name, script] of Object.entries(stubs)) {
    const path = join(dir, name);
    writeFileSync(path, script);
    chmodSync(path, 0o755);
  }
  return dir;
}

test("parses a known fixture: milestone, gate tally, TODO, STATUS, KI titles", () => {
  const dir = makeFixture();
  const { status, stdout, stderr } = runDigest(["--no-gh", dir]);

  assert.equal(status, 0);
  assert.equal(stderr, "");

  // Every fact carries the file:line a session would open to see more. The
  // line numbers are the point — "read docs/STATUS.md" is what this replaces.
  assert.match(stdout, /CURRENT MILESTONE: M42 — The answer {2}\[docs\/milestones\/README\.md:7\]/);
  assert.match(
    stdout,
    /EXIT GATE: 1\/2 ticked, 1 descoped {2}\[docs\/milestones\/M42-the-answer\.md:7\]/,
  );

  // The unticked milestone rows, top down, are the execution order
  // (KI-2026-09-21-a); cited at the first of them. The marker gets its own line.
  assert.match(stdout, /ORDER \(TODO\.md rows, top down\): M42 → M43 {2}\[TODO\.md:4\]/);
  assert.match(stdout, /MARKED CURRENT: M42 {2}\[TODO\.md:4\]/);

  assert.match(stdout, /STATUS SAYS {2}\[docs\/STATUS\.md:5\]/);
  assert.match(stdout, /M42 is landing, 2026-09-02\. One PR is open and green\./);
  // The table is dropped — `gh pr list` answers that question live and better.
  assert.doesNotMatch(stdout, /\| #1 \| open \|/);
  // ...and so is a lead-in whose content the digest is not going to print.
  assert.doesNotMatch(stdout, /A fresh session must not miss:/);

  assert.match(stdout, /OPEN KIs: 2 —/);
  assert.match(stdout, /KI-7 A thing is broken in a way worth writing down/);
  assert.match(stdout, /KI-8 Another thing/);
  // Titles only, never bodies. This is the line between a digest and a second
  // copy of docs/known-issues/.
  assert.doesNotMatch(stdout, /xyzzy-body-marker/);
  // README.md is not a known issue.
  assert.doesNotMatch(stdout, /not a KI/);

  assert.match(stdout, /DRIFT: none detected/);
  // The one file this state implies: the gate box still open. Not the
  // struck-out one — descoped work is not outstanding work.
  assert.match(
    stdout,
    /NEXT READ: docs\/milestones\/M42-the-answer\.md:7 — 1 exit-gate box still open/,
  );
});

test("names each mechanical mismatch and defers the verdict to /roadmap", () => {
  const dir = makeFixture({
    // The gate-close checklist's four flags, two of them left unflipped.
    "TODO.md": [
      "# TODO",
      "",
      "- [ ] **M43 Later** ← **current milestone**",
      "",
    ].join("\n"),
    "docs/STATUS.md": [
      "# STATUS",
      "",
      "## Where the work is right now",
      "",
      "Work continues on M99, which is not the current milestone.",
      "",
    ].join("\n"),
  });
  const { status, stdout } = runDigest(["--no-gh", dir]);

  assert.equal(status, 0);
  assert.match(stdout, /DRIFT: 3 — these are mismatches, not verdicts\. Run \/roadmap\./);
  assert.match(stdout, /marker says M43, milestones\/README\.md says M42/);
  assert.match(stdout, /first unchecked item is M43, not M42/);
  assert.match(stdout, /never mentions M42 — gate-close step 5/);
  assert.match(stdout, /NEXT READ: \/roadmap — 3 mechanical mismatch/);
});

test("stays inside its line and token budget on the real repo", () => {
  // Deliberately the real docs, not a fixture: the budget is a claim about
  // this repo's actual state files, and a fixture would never fail.
  const { status, stdout, stderr } = runDigest(["--no-gh"]);
  assert.equal(status, 0);
  assert.equal(stderr, "");

  const lines = stdout.trimEnd().split("\n").length;
  const tokens = Math.ceil(stdout.length / 4);
  assert.ok(
    lines <= MAX_LINES,
    `digest is ${lines} lines, budget is ${MAX_LINES}. Trim it or cap a list — see R1.`,
  );
  assert.ok(
    tokens <= MAX_TOKENS,
    `digest is ~${tokens} tokens, budget is ${MAX_TOKENS}. Trim it or cap a list — see R1.`,
  );
});

test("degrades with a stated line when gh and git are not on PATH at all", () => {
  const dir = makeFixture();
  const bin = makeBin({});
  const { status, stdout, stderr } = runDigest([dir], {
    env: { ...process.env, PATH: bin },
  });

  // Missing tooling costs the session a line of the digest, never the digest
  // and never the session.
  assert.equal(status, 0);
  assert.equal(stderr, "");
  assert.match(stdout, /OPEN PRS: \(gh unavailable\)/);
  assert.match(stdout, /WORKTREES: \(git unavailable\)/);
  assert.match(stdout, /ORIGIN\/MAIN: \(unavailable/);
  // The doc-derived half still works — that is the half that matters.
  assert.match(stdout, /CURRENT MILESTONE: M42 — The answer/);
});

test("degrades when gh is present but fails, e.g. unauthenticated", () => {
  const dir = makeFixture();
  const bin = makeBin({
    gh: '#!/bin/sh\necho "gh: To get started with GitHub CLI, please run: gh auth login" >&2\nexit 4\n',
  });
  const { status, stdout, stderr } = runDigest([dir], {
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
  });

  assert.equal(status, 0);
  assert.equal(stderr, "");
  assert.match(stdout, /OPEN PRS: \(gh unavailable\)/);
});

test("does not throw on a repo state with no open PRs", () => {
  const dir = makeFixture();
  const bin = makeBin({ gh: "#!/bin/sh\necho '[]'\n" });
  const { status, stdout, stderr } = runDigest([dir], {
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
  });

  assert.equal(status, 0);
  assert.equal(stderr, "");
  // "none" and "unavailable" are different answers and the digest must not
  // conflate them: an empty list is a fact about the repo, and gh not
  // answering is a fact about the machine.
  assert.match(stdout, /OPEN PRS: none/);
  assert.doesNotMatch(stdout, /OPEN PRS: \(/);
});

test("survives a repo with none of the four state sources", () => {
  const dir = mkdtempSync(join(tmpdir(), "tc-state-digest-empty-"));
  const { status, stdout, stderr } = runDigest(["--no-gh", dir]);

  assert.equal(status, 0);
  assert.equal(stderr, "");
  assert.match(stdout, /CURRENT MILESTONE: \(not found in docs\/milestones\/README\.md\)/);
  assert.match(stdout, /ORDER \(TODO\.md rows, top down\): none/);
  assert.match(stdout, /OPEN KIs: \(docs\/known-issues\/open not found\)/);
});

test("--json carries the facts and not the prose it read to find them", () => {
  const dir = makeFixture();
  const { status, stdout } = runDigest(["--no-gh", "--json", dir]);
  assert.equal(status, 0);

  const digest = JSON.parse(stdout);
  assert.equal(digest.milestone.id, "M42");
  assert.equal(digest.milestone.line, 7);
  assert.deepEqual(
    { ticked: digest.gate.ticked, open: digest.gate.open, descoped: digest.gate.descoped },
    { ticked: 1, open: 1, descoped: 1 },
  );
  assert.equal(digest.todo.first.id, "M42");
  assert.equal(digest.todo.marker.id, "M42");
  assert.deepEqual(digest.drift, []);
  assert.equal(digest.ki.items.length, 2);

  // The STATUS section is read whole so the drift check can look for the
  // milestone id in it. It must not be handed back out — in --json it would be
  // the largest field in the file, and re-emitting STATUS.md is the exact cost
  // this script exists to remove.
  assert.equal(digest.status.mentions, undefined);
  assert.ok(!stdout.includes("xyzzy-body-marker"));
});

// --- production migrations -------------------------------------------------

/**
 * A fixture repo whose migrations 0000 and 0001 land in two commits, plus a
 * fake `gh` whose last successful migrate-production run is `runAt` (0 or 1).
 */
function migrationFixture(runAt) {
  const dir = makeFixture();
  const git = (...args) => {
    const r = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  git("init", "-q");
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  const shas = [];
  const entries = [];
  for (const tag of ["0000_first", "0001_second"]) {
    entries.push({ idx: entries.length, tag });
    mkdirSync(join(dir, "apps/web/drizzle/meta"), { recursive: true });
    writeFileSync(join(dir, `apps/web/drizzle/${tag}.sql`), "select 1;\n");
    writeFileSync(join(dir, "apps/web/drizzle/meta/_journal.json"), JSON.stringify({ entries }));
    git("add", "-A");
    git("commit", "-q", "-m", tag);
    shas.push(git("rev-parse", "HEAD"));
  }
  const run = JSON.stringify([{ headSha: shas[runAt], createdAt: "2026-09-25T07:25:14Z" }]);
  const bin = makeBin({
    gh: `#!/bin/sh\ncase "$1" in run) echo '${run}';; *) echo '[]';; esac\n`,
  });
  return runDigest([dir], { env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } });
}

test("PROD MIGRATIONS names the migration the last run does not contain", () => {
  const { status, stdout } = migrationFixture(0);
  assert.equal(status, 0);
  assert.match(stdout, /PROD MIGRATIONS: 1 NOT applied \(0001_second\)/);
});

test("PROD MIGRATIONS says all applied when the last run contains the newest", () => {
  // The case STATUS.md got wrong for three days (2026-09-24 → 09-27).
  const { stdout } = migrationFixture(1);
  assert.match(stdout, /PROD MIGRATIONS: all 2 applied — last migrate-production run \w{7} 2026-09-25 contains 0001_second/);
});

test("PROD MIGRATIONS without gh says unverified, never applied or pending", () => {
  const { stdout } = runDigest(["--no-gh", REPO]);
  assert.match(stdout, /PROD MIGRATIONS: unverified \(--no-gh\) — newest is \d{4}_\w+, added in \w{7}/);
});

/**
 * A `--no-ff` merge of a feature branch that adds migration 0001 while main
 * held 0000. With `renumber`, the merge resolves a collision the way #308 did
 * (0035 → 0036, 2026-10-03): the file is moved to 0002 inside the merge, so
 * no commit but the merge ever adds that path. Answers the digest's output,
 * the feature commit and the merge commit.
 */
function noFfMergeFixture({ renumber }) {
  const dir = makeFixture();
  const git = (...args) => {
    const r = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  const drizzle = join(dir, "apps/web/drizzle");
  const journal = (...tags) =>
    writeFileSync(join(drizzle, "meta/_journal.json"), JSON.stringify({ entries: tags.map((tag, idx) => ({ idx, tag })) }));
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  mkdirSync(join(drizzle, "meta"), { recursive: true });
  writeFileSync(join(drizzle, "0000_first.sql"), "select 1;\n");
  journal("0000_first");
  git("add", "-A");
  git("commit", "-q", "-m", "0000");

  git("checkout", "-q", "-b", "feature");
  writeFileSync(join(drizzle, "0001_feature.sql"), "select 2;\n");
  journal("0000_first", "0001_feature");
  git("add", "-A");
  git("commit", "-q", "-m", "feature adds 0001");
  const feature = git("rev-parse", "HEAD");

  git("checkout", "-q", "main");
  writeFileSync(join(dir, "README.md"), "main moved on\n");
  git("add", "-A");
  git("commit", "-q", "-m", "main moves");
  git("merge", "-q", "--no-ff", "--no-commit", "feature");
  if (renumber) {
    git("mv", "apps/web/drizzle/0001_feature.sql", "apps/web/drizzle/0002_feature.sql");
    journal("0000_first", "0002_feature");
    git("add", "-A");
  }
  git("commit", "-q", "-m", "merge feature");
  const merge = git("rev-parse", "HEAD");
  return { ...runDigest(["--no-gh", dir]), feature, merge };
}

test("PROD MIGRATIONS attributes a migration first added in a --no-ff merge to the merge commit", () => {
  const { status, stdout, merge } = noFfMergeFixture({ renumber: true });
  assert.equal(status, 0);
  assert.match(stdout, new RegExp(`newest is 0002_feature, added in ${merge.slice(0, 7)}`));
});

test("PROD MIGRATIONS attributes a migration a --no-ff merge brought in to the commit that wrote it", () => {
  // The plain query runs first for this case: the fallback would name the merge.
  const { stdout, feature } = noFfMergeFixture({ renumber: false });
  assert.match(stdout, new RegExp(`newest is 0001_feature, added in ${feature.slice(0, 7)}`));
});
