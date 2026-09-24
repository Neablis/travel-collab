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
  const out = run(root, ["close", "M20", "--next", "M21"], { expectFail: true });
  assert.match(out, /appears on 2 TODO\.md rows/);
  assert.match(out, /refuses to guess/);
  rmSync(root, { recursive: true, force: true });
});

test("refuses when an anchor is missing, naming the file, writing nothing", () => {
  // A milestone file with no exit-gate heading at all. The old parser returned
  // an empty result here, which reads as "zero open boxes" — i.e. closeable.
  const root = repo({ "docs/milestones/M20-tiers.md": "# M20\n\n## Scope\n- [x] a\n" });
  const out = run(root, ["close", "M20", "--next", "M21"], { expectFail: true });
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
  const out = run(root, ["close", "M20", "--next", "M21", "--confirm"], { expectFail: true });
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
  const out = run(root, ["close", "M20", "--next", "M21", "--confirm"]);
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
  const out = run(root, ["close", "M20", "--next", "M21"], { expectFail: true });
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
  const out = run(root, ["close", "M20", "--next", "M21"]);
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
  const out = run(root, ["close", "M20", "--next", "M21", "--confirm"]);
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
  const out = run(root, ["close", "M20", "--next", "M21"]);
  assert.match(out, /STILL YOURS TO WRITE/);
  assert.match(out, /retro note/);
  assert.match(out, /STATUS\.md/);
  rmSync(root, { recursive: true, force: true });
});

// --- the order: TODO.md's rows, top down ------------------------------------
//
// KI-2026-09-21-a, closed 2026-09-24 by Mitchell choosing "the rows ARE the
// order": a reorder moves the rows, so the next milestone is the next
// unticked milestone row, skipping PAUSED ones. `--next` is an assertion of
// that answer and a disagreement is refused. Before this the script had to
// REQUIRE `--next`, because the header said "read the marker, not the
// position" — on M26 the row order proposed M12 when the real next was M13.

/** Rows in the intended order, deliberately NOT numeric (M22 before M21). */
function reorderedRepo(extraRows = []) {
  return repo({
    "TODO.md": [
      "# TODO", "",
      "- [ ] **M20 An account knows what it may do** ← **current milestone**",
      "      `docs/milestones/M20-tiers.md`",
      ...extraRows,
      "- [ ] **M22 A later one, reordered ahead of M21**",
      "      `docs/milestones/M22-api.md`",
      "- [ ] **M21 An account can pay for itself**",
      "      `docs/milestones/M21-billing.md`",
      "",
    ].join("\n"),
    "docs/milestones/M22-api.md": "# M22 — A later one, reordered ahead of M21\n\n## Exit gate\n- [ ] a\n",
    "docs/milestones/M9-ai.md": "# M9 — The assistant\n\n## Exit gate\n- [ ] a\n",
  });
}

/**
 * Every file `close` can write. A refusal must leave all of them byte-identical
 * — checking only TODO.md would stay green against a partial write to either of
 * the others, which is the no-write guarantee failing in the one place it
 * matters. CodeRabbit, PR #200.
 */
const WRITTEN_FILES = ["TODO.md", "docs/milestones/README.md", "docs/candidates.md"];

function snapshot(root) {
  return Object.fromEntries(WRITTEN_FILES.map((rel) => [rel, readFileSync(join(root, rel), "utf8")]));
}

function assertUntouched(root, before, context) {
  for (const rel of WRITTEN_FILES) {
    assert.equal(readFileSync(join(root, rel), "utf8"), before[rel], `${rel} must be untouched after: ${context}`);
  }
}

test("without --next it takes the next ROW, not the next number", () => {
  // M22's row sits above M21's. Numeric order (what `idx.items` is sorted by)
  // would say M21; the rows say M22, and the rows are the order.
  const root = reorderedRepo();
  const out = run(root, ["close", "M20", "--confirm"]);
  assert.match(out, /next: M22 — the next un-paused row in TODO\.md/);
  const todo = readFileSync(join(root, "TODO.md"), "utf8");
  const readme = readFileSync(join(root, "docs/milestones/README.md"), "utf8");
  assert.match(todo, /- \[ \] \*\*M22[^\n]*← \*\*current milestone\*\*/, "marker went to M22");
  assert.doesNotMatch(todo, /- \[ \] \*\*M21[^\n]*← \*\*current milestone\*\*/, "and not to M21");
  assert.match(readme, /^Current milestone: M22 — A later one, reordered ahead of M21$/m);
  rmSync(root, { recursive: true, force: true });
});

test("a PAUSED row keeps its place but is skipped", () => {
  const root = reorderedRepo([
    "- [ ] **M9 The assistant** — **PAUSED 2026-09-13**, not cancelled",
    "      `docs/milestones/M9-ai.md`",
  ]);
  const out = run(root, ["close", "M20", "--confirm"]);
  assert.match(out, /next: M22/);
  assert.match(out, /skipped as PAUSED: M9/);
  assert.match(readFileSync(join(root, "TODO.md"), "utf8"), /- \[ \] \*\*M22[^\n]*← \*\*current milestone\*\*/);
  rmSync(root, { recursive: true, force: true });
});

test("--next that disagrees with the rows is REFUSED and says to move the row", () => {
  // Obeying it would put the marker where the rows disagree — the drift this
  // rule exists to end. The fix is one row move, and the message says which.
  const root = reorderedRepo();
  const before = snapshot(root);
  const out = run(root, ["close", "M20", "--next", "M21", "--confirm"], { expectFail: true });
  assert.match(out, /--next M21 disagrees with TODO\.md's row order, whose next un-paused row is M22/);
  assert.match(out, /move M21's row above M22's/);
  assert.match(out, /Nothing written/);
  assertUntouched(root, before, "close M20 --next M21 --confirm");
  rmSync(root, { recursive: true, force: true });
});

test("--next that agrees with the rows is accepted as an assertion", () => {
  const root = reorderedRepo();
  const out = run(root, ["close", "M20", "--next", "M22", "--confirm"]);
  assert.match(out, /next: M22/);
  rmSync(root, { recursive: true, force: true });
});

test("--next refuses an unknown id, a PAUSED one, the id being closed, and a bare flag", () => {
  // Each refusal must leave the files untouched: a close that half-applies is
  // worse than no automation, which is this file's whole premise.
  for (const [args, pattern] of [
    [["close", "M20", "--next", "M99", "--confirm"], /--next M99 is not a milestone in TODO\.md/],
    [["close", "M20", "--next", "M20", "--confirm"], /--next M20 disagrees with TODO\.md's row order/],
    [["close", "M20", "--next", "M9", "--confirm"], /--next M9 disagrees[\s\S]*skipped as PAUSED: M9/],
    [["close", "M20", "--next", "--confirm"], /--next needs a milestone id/],
  ]) {
    const root = reorderedRepo([
      "- [ ] **M9 The assistant** — **PAUSED 2026-09-13**, not cancelled",
      "      `docs/milestones/M9-ai.md`",
    ]);
    const before = snapshot(root);
    const out = run(root, args, { expectFail: true });
    assert.match(out, pattern);
    assert.match(out, /Nothing written/);
    assertUntouched(root, before, args.join(" "));
    rmSync(root, { recursive: true, force: true });
  }
});

test("with no un-paused row after it, close refuses rather than inventing one", () => {
  const root = repo({
    "TODO.md": [
      "# TODO", "",
      "- [ ] **M20 An account knows what it may do** ← **current milestone**",
      "      `docs/milestones/M20-tiers.md`",
      "- [ ] **M21 An account can pay for itself** — **PAUSED**",
      "      `docs/milestones/M21-billing.md`",
      "",
    ].join("\n"),
  });
  const before = snapshot(root);
  const out = run(root, ["close", "M20", "--confirm"], { expectFail: true });
  assert.match(out, /no unticked, un-paused milestone row follows M20/);
  assert.match(out, /skipped as PAUSED: M21/);
  assertUntouched(root, before, "close M20 with only a paused row after it");
  rmSync(root, { recursive: true, force: true });
});
