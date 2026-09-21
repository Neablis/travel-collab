// Tests for scripts/lib/roadmap-read.mjs.
//
// The failure that matters for this lib is never a crash. It is a reader that
// finds nothing and returns an empty result, because "no exit-gate boxes" and
// "this file's headings moved" render identically and only one of them is
// true. Every test below pins a case where silence would read as a fact.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  readCandidates,
  readMilestoneIndex,
  readCurrentMilestone,
  readMilestoneGate,
  readTodo,
  readStatus,
  findDrift,
  assertAnchors,
  AnchorError,
  milestoneId,
} from "../lib/roadmap-read.mjs";

function repo(files) {
  const root = mkdtempSync(join(tmpdir(), "rr-test-"));
  for (const [rel, body] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, body);
  }
  return root;
}

// --- the regression this lib was extracted to fix --------------------------

test("a WAVE-structured gate is read, and summed across its waves", () => {
  // The live bug, 2026-09-21: the old regex was /^##\s+Exit gate/i, and
  // M26-design-parity.md heads its gates `## Wave 1 exit gate` /
  // `## Wave 2 exit gate`. The digest printed no gate tally for the CURRENT
  // milestone at every session start and nobody saw it, because a missing
  // tally looks like a milestone that simply has no gate.
  const root = repo({
    "docs/milestones/M26-design-parity.md": [
      "# M26", "", "## Wave 1 exit gate", "- [x] a", "- [x] b", "",
      "## Wave 2 exit gate", "- [x] c", "- [ ] d", "",
    ].join("\n"),
  });
  const gate = readMilestoneGate(root, "M26");
  assert.equal(gate.anchorMissing, undefined, "a wave gate must not read as a missing anchor");
  assert.equal(gate.ticked, 3);
  assert.equal(gate.open, 1, "M26 is not done when Wave 1 is done — the gate is the UNION");
  assert.equal(gate.gates.length, 2);
});

test("the plain and the decorated heading shapes both read", () => {
  // Surveyed from docs/milestones/ rather than guessed: 23 `## Exit gate`,
  // 5 `## Exit gate — all must be true`, and one carrying a parenthetical.
  for (const heading of [
    "## Exit gate",
    "## Exit gate — all must be true",
    "## Exit gate — all must be true (drafted 2026-07-11; confirmed at kickoff)",
    "### Wave 2 exit gate — all must be true",
  ]) {
    const root = repo({ "docs/milestones/M1-x.md": `# M1\n\n${heading}\n- [x] a\n- [ ] b\n` });
    const gate = readMilestoneGate(root, "M1");
    assert.equal(gate.anchorMissing, undefined, `not matched: ${heading}`);
    assert.equal(gate.ticked, 1, heading);
    assert.equal(gate.open, 1, heading);
  }
});

test("heading DEPTH decides where a gate section ends", () => {
  // A `## Exit gate` is not closed by a `###` nested under it — those boxes
  // are still its boxes. Closing on any heading would undercount the gate and
  // make a milestone look finished.
  const root = repo({
    "docs/milestones/M2-x.md": [
      "# M2", "", "## Exit gate", "- [x] a", "", "### A sub-part of the gate",
      "- [x] b", "- [ ] c", "", "## Something else", "- [ ] not a gate box", "",
    ].join("\n"),
  });
  const gate = readMilestoneGate(root, "M2");
  assert.equal(gate.ticked, 2);
  assert.equal(gate.open, 1, "the `## Something else` box must not be counted");
});

test("a struck-out box is descoped, not outstanding", () => {
  const root = repo({
    "docs/milestones/M3-x.md": "# M3\n\n## Exit gate\n- [x] a\n- [ ] ~~cut from scope~~\n- [ ] real\n",
  });
  const gate = readMilestoneGate(root, "M3");
  assert.equal(gate.ticked, 1);
  assert.equal(gate.open, 1, "a ~~struck~~ box is not work outstanding");
  assert.equal(gate.descoped, 1);
});

test("a milestone file with NO gate heading says so instead of reading as empty", () => {
  const root = repo({ "docs/milestones/M4-x.md": "# M4\n\n## Scope\n- [ ] a\n" });
  const gate = readMilestoneGate(root, "M4");
  assert.equal(gate.anchorMissing, true);
  assert.equal(gate.open, 0, "boxes outside a gate section are not gate boxes");
});

// --- current milestone ------------------------------------------------------

test("readCurrentMilestone takes the LAST Current milestone line", () => {
  // The line lives at the bottom and earlier prose quotes it; a first-match
  // read would return a historical quotation as the live answer.
  const root = repo({
    "docs/milestones/README.md": [
      "# Milestones", "", "Current milestone: M17 — Account customization",
      "…history…", "", "Current milestone: M26 — Design parity", "",
    ].join("\n"),
  });
  const m = readCurrentMilestone(root);
  assert.equal(m.id, "M26");
  assert.equal(m.line, 6);
});

test("a README with no Current milestone line reports anchorMissing", () => {
  const root = repo({ "docs/milestones/README.md": "# Milestones\n\nnothing here\n" });
  assert.equal(readCurrentMilestone(root).anchorMissing, true);
});

// --- TODO -------------------------------------------------------------------

test("readTodo reports the first unchecked item AND the marker separately", () => {
  // They are allowed to disagree: the marker records a decision that overrides
  // position. Collapsing them would hide exactly the drift worth reporting.
  const root = repo({
    "TODO.md": [
      "# TODO", "- [x] **M11 done**", "- [ ] **M12 Reviews and moderation**",
      "- [ ] **M26 Design parity** ← **current milestone**", "",
    ].join("\n"),
  });
  const todo = readTodo(root);
  assert.equal(todo.first.id, "M12");
  assert.equal(todo.marker.id, "M26");
});

test("a TODO with no checkboxes at all reports anchorMissing", () => {
  const root = repo({ "TODO.md": "# TODO\n\nprose only\n" });
  assert.equal(readTodo(root).anchorMissing, true);
});

// --- STATUS -----------------------------------------------------------------

test("mentions covers the WHOLE block even when the printed lines fill early", () => {
  // `said` stops at lineCount, but `mentions` feeds the drift check. If it
  // stopped there too, a STATUS block naming the milestone below the cut
  // would be reported as never mentioning it — a false drift report, which
  // trains readers to ignore real ones.
  const root = repo({
    "docs/STATUS.md": [
      "# STATUS", "", "## Where the work is right now", "one", "two", "three",
      "four", "M26 is named only down here", "", "## Next", "",
    ].join("\n"),
  });
  const status = readStatus(root, { lineCount: 3 });
  assert.equal(status.said.length, 3);
  assert.match(status.mentions, /M26/, "the drift check reads a truncated block");
});

// --- drift ------------------------------------------------------------------

test("findDrift names each of the four mismatches, and stays silent when they agree", () => {
  const agree = findDrift({
    milestone: { id: "M26", rel: "r", line: 1 },
    todo: { rel: "t", first: { id: "M26", line: 2 }, marker: { id: "M26", line: 3 } },
    gate: { rel: "g", line: 4, ticked: 3, open: 1 },
    status: { rel: "s", line: 5, mentions: "M26 is current" },
  });
  assert.deepEqual(agree, []);

  const drift = findDrift({
    milestone: { id: "M26", rel: "r", line: 1 },
    todo: { rel: "t", first: { id: "M12", line: 2 }, marker: { id: "M25", line: 3 } },
    gate: { rel: "g", line: 4, ticked: 3, open: 1 },
    status: { rel: "s", line: 5, mentions: "nothing relevant" },
  });
  assert.equal(drift.length, 3);
  assert.match(drift.join("\n"), /marker says M25/);
  assert.match(drift.join("\n"), /first unchecked item is M12/);
  assert.match(drift.join("\n"), /never mentions M26/);
});

test("findDrift catches a fully-ticked gate whose TODO box is still open", () => {
  const drift = findDrift({
    milestone: { id: "M26", rel: "r", line: 1 },
    todo: { rel: "t", first: { id: "M26", line: 2 }, marker: { id: "M26", line: 3 } },
    gate: { rel: "g", line: 4, ticked: 21, open: 0 },
    status: { rel: "s", line: 5, mentions: "M26" },
  });
  assert.equal(drift.length, 1);
  assert.match(drift[0], /every M26 exit-gate box is ticked/);
});

// --- the writing caller's gate ---------------------------------------------

test("assertAnchors throws and NAMES the file, so a writer never proceeds blind", () => {
  assert.throws(
    () => assertAnchors({ gate: { rel: "docs/milestones/M26-x.md", anchorMissing: true } }),
    (err) => {
      assert.ok(err instanceof AnchorError);
      assert.match(err.message, /docs\/milestones\/M26-x\.md/);
      assert.match(err.message, /Nothing was written/);
      return true;
    },
  );
  assert.throws(() => assertAnchors({ todo: null }), AnchorError);
});

test("assertAnchors passes when every reader found its anchor", () => {
  assert.doesNotThrow(() =>
    assertAnchors({ todo: { rel: "TODO.md" }, gate: { rel: "m.md", ticked: 1 } }),
  );
});

test("milestoneId reads the suffixed ids this repo uses", () => {
  assert.equal(milestoneId("M11a An invite gate"), "M11a");
  assert.equal(milestoneId("**M18b** tag focus"), "M18b");
  assert.equal(milestoneId("no milestone here"), null);
});

// --- candidates -------------------------------------------------------------

test("a WRAPPED 'gate deletes this entry' sentence is still matched", () => {
  // The phrase spans a line break in the real hard-wrapped file:
  //   "… M23's gate deletes this\n  entry at close …"
  // A line-wise match found zero of two real entries on 2026-09-21. The
  // consequence is not a crash — it is a prune that silently does nothing.
  const root = repo({
    "docs/candidates.md": [
      "# Candidates", "",
      "- **PLACED — this is M23 link 3.**", "  Scheduled into the milestone file.",
      "  M23\u2019s gate deletes this", "  entry at close; it stays until then.", "",
      "- **Something nobody has placed (2026-09-16).**", "  Just an idea.", "",
    ].join("\n"),
  });
  const res = readCandidates(root, "docs/candidates.md");
  assert.equal(res.items.length, 2);
  assert.equal(res.items[0].state, "placed");
  assert.equal(res.items[0].milestone, "M23");
  assert.equal(res.items[1].state, "unplaced");
});

test("both the curly and the straight apostrophe match", () => {
  for (const apos of ["\u2019", "'"]) {
    const root = repo({
      "docs/candidates.md": `# C\n\n- **x.**\n  M24${apos}s gate deletes this entry at close.\n`,
    });
    assert.equal(readCandidates(root, "docs/candidates.md").items[0].state, "placed", apos);
  }
});

test("'scoped into' is NOT 'placed' — only placed entries are auto-deleted", () => {
  // An entry that says "now scoped into M9 … kept here only for" has asked to
  // survive. Reading it as placed would delete what its author preserved.
  const root = repo({
    "docs/candidates.md": "# C\n\n- **AI preview before apply — now scoped into M9.**\n  Kept here only for the reasoning.\n",
  });
  const item = readCandidates(root, "docs/candidates.md").items[0];
  assert.equal(item.state, "scoped");
  assert.equal(item.milestone, "M9");
});

test("a candidates file whose entry syntax changed reports anchorMissing", () => {
  const root = repo({ "docs/candidates.md": "# C\n\n- plain bullet, no bold title\n" });
  assert.equal(readCandidates(root, "docs/candidates.md").anchorMissing, true);
});

// --- the milestone index ----------------------------------------------------

test("an id on two checkbox rows with different ticks is UNKNOWN, not guessed", () => {
  // TODO.md carries `- [x] **M9 Phase 0 …**` and `- [ ] **M9 The assistant
  // cites what it plans**`. Guessing either way produced a disagreement that
  // did not exist ("M9 ticked but 10 gate boxes open"), and a drift report
  // that cries wolf is how a real one gets ignored.
  const root = repo({
    "TODO.md": [
      "# TODO",
      "- [x] **M9 Phase 0 — the assistant kernel** — complete",
      "- [ ] **M9 The assistant cites what it plans** — PAUSED",
      "",
    ].join("\n"),
    "docs/milestones/README.md": "Current milestone: M9 — assistant\n",
    "docs/milestones/M9-ai.md": "# M9 — assistant\n\n## Exit gate\n- [ ] a\n",
  });
  const idx = readMilestoneIndex(root);
  assert.equal(idx.items.find((m) => m.id === "M9").ticked, undefined, "must not guess");
  assert.equal(idx.ambiguous.length, 1);
  assert.deepEqual(idx.ambiguous[0].rows.map((r) => r.ticked), [true, false]);
});

test("rows that AGREE resolve to a tick state, ambiguity empty", () => {
  const root = repo({
    "TODO.md": "# TODO\n- [x] **M1 core**\n- [x] **M1 core, mentioned again**\n",
    "docs/milestones/README.md": "Current milestone: M1 — core\n",
    "docs/milestones/M1-core.md": "# M1 — core\n\n## Exit gate\n- [x] a\n",
  });
  const idx = readMilestoneIndex(root);
  assert.equal(idx.items[0].ticked, true);
  assert.deepEqual(idx.ambiguous, []);
});

test("the index joins gate tally and current marker onto each milestone", () => {
  const root = repo({
    "TODO.md": "# TODO\n- [ ] **M26 design**\n",
    "docs/milestones/README.md": "Current milestone: M26 — Design parity\n",
    "docs/milestones/M26-design.md": "# M26 — Design parity\n\n## Wave 1 exit gate\n- [x] a\n\n## Wave 2 exit gate\n- [ ] b\n",
  });
  const idx = readMilestoneIndex(root);
  const m = idx.items[0];
  assert.equal(m.isCurrent, true);
  assert.equal(m.gate.ticked, 1);
  assert.equal(m.gate.open, 1);
  assert.equal(m.ticked, false);
});
