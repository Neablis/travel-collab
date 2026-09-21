// Tests for scripts/milestone.mjs (`pnpm milestone close`).
//
// This is the only script in the set that WRITES, and it writes to four files
// at once. So the tests are weighted towards what it must REFUSE: a close that
// half-applies, or that applies off a parse that found nothing, is worse than
// no automation, because the checklist it replaces at least fails visibly.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { execFileSync } from "node:child_process";

const SCRIPT = new URL("../milestone.mjs", import.meta.url).pathname;

function repo(overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), "mc-test-"));
  const files = {
    "TODO.md": [
      "# TODO", "",
      "- [ ] **M20 An account knows what it may do** ← **current milestone**",
      "      `docs/milestones/M20-tiers.md`",
      "- [ ] **M21 An account can pay for itself**",
      "      `docs/milestones/M21-billing.md`",
      "",
    ].join("\n"),
    "docs/milestones/README.md": [
      "# Milestones", "", "## Table", "", "Current milestone: M20 — An account knows what it may do", "",
    ].join("\n"),
    "docs/milestones/M20-tiers.md": "# M20 — An account knows what it may do\n\n## Exit gate\n- [x] a\n- [x] b\n",
    "docs/milestones/M21-billing.md": "# M21 — An account can pay for itself\n\n## Exit gate\n- [ ] a\n",
    "docs/STATUS.md": "# STATUS\n\n## Where the work is right now\n\nM20 is current.\n",
    "docs/candidates.md": [
      "# Candidates", "",
      "- **PLACED — this is M20 link 2.**", "  M20’s gate deletes this", "  entry at close.", "",
      "- **Something else entirely (2026-09-01).**", "  Unplaced.", "",
      "- **A thing now scoped into M20.**", "  Kept here only for the reasoning.", "",
    ].join("\n"),
    ...overrides,
  };
  for (const [rel, body] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, body);
  }
  return root;
}

function run(root, args, { expectFail = false } = {}) {
  try {
    const out = execFileSync(process.execPath, [SCRIPT, ...args], {
      env: { ...process.env, CLAUDE_PROJECT_DIR: root },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    assert.ok(!expectFail, "expected a non-zero exit but it succeeded");
    return out;
  } catch (err) {
    assert.ok(expectFail, `unexpected failure:\n${err.stdout}\n${err.stderr}`);
    return String(err.stdout ?? "") + String(err.stderr ?? "");
  }
}

// --- what it must refuse ----------------------------------------------------

test("refuses to close a milestone whose exit gate has open boxes", () => {
  const root = repo();
  const out = run(root, ["close", "M21"], { expectFail: true });
  assert.match(out, /M21 has 1 unticked exit-gate box/);
  assert.match(out, /definition of done/);
  // and nothing moved
  assert.match(readFileSync(join(root, "TODO.md"), "utf8"), /- \[ \] \*\*M21/);
  rmSync(root, { recursive: true, force: true });
});

test("refuses when the TODO rows for the id disagree — it does not guess which to tick", () => {
  const root = repo({
    "TODO.md": [
      "# TODO", "",
      "- [x] **M20 Phase 0 — the kernel** — complete",
      "- [ ] **M20 An account knows what it may do** ← **current milestone**",
      "- [ ] **M21 An account can pay for itself**", "",
    ].join("\n"),
  });
  const out = run(root, ["close", "M20"], { expectFail: true });
  assert.match(out, /appears on 2 TODO\.md rows/);
  assert.match(out, /refuses to guess/);
  rmSync(root, { recursive: true, force: true });
});

test("refuses when an anchor is missing, naming the file, writing nothing", () => {
  // A milestone file with no exit-gate heading at all. The old parser returned
  // an empty result here, which reads as "zero open boxes" — i.e. closeable.
  const root = repo({ "docs/milestones/M20-tiers.md": "# M20\n\n## Scope\n- [x] a\n" });
  const out = run(root, ["close", "M20"], { expectFail: true });
  assert.match(out, /anchor not found/);
  assert.match(out, /M20-tiers\.md/);
  assert.match(out, /Nothing was written/);
  assert.match(readFileSync(join(root, "TODO.md"), "utf8"), /- \[ \] \*\*M20/);
  rmSync(root, { recursive: true, force: true });
});

test("a TODO with NO row for the id aborts before any file is touched", () => {
  // CodeRabbit, PR #199: the first draft returned a note and carried on, so
  // the marker moved, Current milestone bumped and candidates were pruned
  // while the milestone stayed unticked — the half-applied state this
  // command's own header calls worse than no automation.
  const root = repo({
    "TODO.md": "# TODO\n\n- [ ] **M21 An account can pay for itself**\n",
  });
  const before = readFileSync(join(root, "docs/candidates.md"), "utf8");
  const out = run(root, ["close", "M20", "--confirm"], { expectFail: true });
  assert.match(out, /has no row for M20 at all/);
  assert.match(out, /refusing before any write/);
  assert.equal(readFileSync(join(root, "docs/candidates.md"), "utf8"), before, "pruned anyway");
  assert.match(
    readFileSync(join(root, "docs/milestones/README.md"), "utf8"),
    /Current milestone: M20/,
    "Current milestone bumped anyway",
  );
  rmSync(root, { recursive: true, force: true });
});

test("an ALREADY-TICKED milestone is not fatal — a half-finished close can resume", () => {
  const root = repo({
    "TODO.md": [
      "# TODO", "",
      "- [x] **M20 An account knows what it may do**",
      "      `docs/milestones/M20-tiers.md`",
      "- [ ] **M21 An account can pay for itself**",
      "      `docs/milestones/M21-billing.md`", "",
    ].join("\n"),
  });
  const out = run(root, ["close", "M20", "--confirm"]);
  assert.match(out, /already ticked/);
  assert.match(readFileSync(join(root, "docs/milestones/README.md"), "utf8"), /Current milestone: M21/);
  rmSync(root, { recursive: true, force: true });
});

test("a missing docs/candidates.md is refused, not an ENOENT stack trace", () => {
  // The shared readers gate TODO.md and the milestones README; candidates has
  // no such gate and readCandidates runs later, so the raw read reached it
  // first. CodeRabbit, PR #199.
  const root = repo();
  rmSync(join(root, "docs/candidates.md"));
  const out = run(root, ["close", "M20"], { expectFail: true });
  assert.match(out, /docs\/candidates\.md not found or unreadable/);
  assert.match(out, /Nothing was written/);
  assert.doesNotMatch(out, /ENOENT/, "a stack trace is not an error message");
  rmSync(root, { recursive: true, force: true });
});

// --- the dry run ------------------------------------------------------------

test("without --confirm it prints a diff and writes NOTHING", () => {
  const root = repo();
  const before = ["TODO.md", "docs/milestones/README.md", "docs/candidates.md"].map((f) =>
    readFileSync(join(root, f), "utf8"),
  );
  const out = run(root, ["close", "M20"]);
  assert.match(out, /Nothing written\. Re-run with --confirm/);
  assert.match(out, /^--- TODO\.md$/m);
  const after = ["TODO.md", "docs/milestones/README.md", "docs/candidates.md"].map((f) =>
    readFileSync(join(root, f), "utf8"),
  );
  assert.deepEqual(after, before, "a dry run must not touch the tree");
  rmSync(root, { recursive: true, force: true });
});

// --- the happy path ---------------------------------------------------------

test("--confirm performs every mechanical step in one pass", () => {
  const root = repo();
  const out = run(root, ["close", "M20", "--confirm"]);
  const todo = readFileSync(join(root, "TODO.md"), "utf8");
  const readme = readFileSync(join(root, "docs/milestones/README.md"), "utf8");
  const cands = readFileSync(join(root, "docs/candidates.md"), "utf8");

  assert.match(todo, /- \[x\] \*\*M20/, "step 1: M20 ticked");
  assert.doesNotMatch(
    todo.split("\n").find((l) => l.includes("M20")),
    /current milestone/,
    "the marker must leave a closed milestone",
  );
  assert.match(todo, /- \[ \] \*\*M21[^\n]*← \*\*current milestone\*\*/, "marker moved to M21");
  assert.match(readme, /^Current milestone: M21 — An account can pay for itself$/m, "step 4");
  assert.doesNotMatch(cands, /this is M20 link 2/, "step 6: the placed entry is pruned");
  assert.match(cands, /Something else entirely/, "an unrelated entry survives");
  assert.match(cands, /now scoped into M20/, "a SCOPED entry is kept — it asked to be");
  assert.match(out, /Applied to 3 file\(s\)/);
  rmSync(root, { recursive: true, force: true });
});

test("it lists steps 3 and 5 as still manual rather than inventing prose", () => {
  // A script that generated the retro note and STATUS's pointer would be
  // writing narrative nobody asked it for — the annotation-layer mistake the
  // architecture-map design names explicitly.
  const root = repo();
  const out = run(root, ["close", "M20"]);
  assert.match(out, /STILL YOURS TO WRITE/);
  assert.match(out, /retro note/);
  assert.match(out, /STATUS\.md/);
  rmSync(root, { recursive: true, force: true });
});

// --- --next: the row-order trap, and the escape hatch -----------------------
//
// KI-2026-09-21-a. `next` defaults to the first unticked TODO row, i.e. row
// ORDER — which TODO.md's own header says carries no information ("read the
// marker, not the position ... a reorder moves the marker without moving the
// rows"). These tests pin the trap as well as the escape hatch, so the day
// somebody makes the default smarter, the test that must change says why.

/** A repo whose ROW order and whose intended order disagree, as the real one did. */
function reorderedRepo() {
  return repo({
    "TODO.md": [
      "# TODO", "",
      "- [ ] **M20 An account knows what it may do** ← **current milestone**",
      "      `docs/milestones/M20-tiers.md`",
      "- [ ] **M21 An account can pay for itself**",
      "      `docs/milestones/M21-billing.md`",
      "- [ ] **M22 A later one, reordered ahead of M21**",
      "      `docs/milestones/M22-api.md`",
      "",
    ].join("\n"),
    "docs/milestones/M22-api.md": "# M22 — A later one, reordered ahead of M21\n\n## Exit gate\n- [ ] a\n",
  });
}

test("without --next it takes the first unticked ROW, which is the trap", () => {
  const root = reorderedRepo();
  const out = run(root, ["close", "M20"]);
  assert.match(out, /next: M21/, "row order wins by default — this is the documented defect");
  rmSync(root, { recursive: true, force: true });
});

test("--next overrides the row-order default and says that it did", () => {
  const root = reorderedRepo();
  const out = run(root, ["close", "M20", "--next", "M22", "--confirm"]);
  assert.match(out, /NOTE: --next M22 overrides the row-order default \(M21\)/);
  const todo = readFileSync(join(root, "TODO.md"), "utf8");
  const readme = readFileSync(join(root, "docs/milestones/README.md"), "utf8");
  assert.match(todo, /- \[ \] \*\*M22[^\n]*← \*\*current milestone\*\*/, "marker went to M22");
  assert.doesNotMatch(todo, /- \[ \] \*\*M21[^\n]*← \*\*current milestone\*\*/, "and not to M21");
  assert.match(readme, /^Current milestone: M22 — A later one, reordered ahead of M21$/m);
  rmSync(root, { recursive: true, force: true });
});

test("--next refuses an unknown id, an already-ticked one, the id being closed, and a bare flag", () => {
  // Each refusal must leave the files untouched: a close that half-applies is
  // worse than no automation, which is this file's whole premise.
  for (const [args, pattern] of [
    [["close", "M20", "--next", "M99", "--confirm"], /--next M99 is not a milestone in TODO\.md/],
    [["close", "M20", "--next", "M20", "--confirm"], /--next M20 is the milestone being closed/],
    [["close", "M20", "--next", "--confirm"], /--next needs a milestone id/],
  ]) {
    const root = reorderedRepo();
    const out = run(root, args, { expectFail: true });
    assert.match(out, pattern);
    assert.match(out, /Nothing written/);
    assert.match(readFileSync(join(root, "TODO.md"), "utf8"), /- \[ \] \*\*M20[^\n]*← \*\*current milestone\*\*/,
      `files must be untouched after: ${args.join(" ")}`);
    rmSync(root, { recursive: true, force: true });
  }

  // Already-ticked needs a repo where something IS ticked.
  const root = repo({
    "TODO.md": [
      "# TODO", "",
      "- [x] **M19 A done one**",
      "      `docs/milestones/M19-done.md`",
      "- [ ] **M20 An account knows what it may do** ← **current milestone**",
      "      `docs/milestones/M20-tiers.md`",
      "- [ ] **M21 An account can pay for itself**",
      "      `docs/milestones/M21-billing.md`",
      "",
    ].join("\n"),
    "docs/milestones/M19-done.md": "# M19 — A done one\n\n## Exit gate\n- [x] a\n",
  });
  const out = run(root, ["close", "M20", "--next", "M19", "--confirm"], { expectFail: true });
  assert.match(out, /--next M19 is already ticked/);
  assert.match(out, /Nothing written/);
  rmSync(root, { recursive: true, force: true });
});
