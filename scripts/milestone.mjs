#!/usr/bin/env node
// `pnpm milestone close <id>` — the gate-close checklist, executed.
//
// WHY THIS EXISTS
//
// docs/milestones/README.md's checklist has five steps across four files, and
// it says in its own text why: flipping every flag in one commit is "never a
// trailing manual step (that is how M2 stayed unticked)". The checklist has
// already GROWN once for the same reason — step 5, STATUS.md, was missing, and
// the cost is recorded: neither M11a's nor M11b's gate-close commit touched
// it, so the file CLAUDE.md tells every session to read first spent two gates
// claiming both were still open PRs.
//
// The defect is not that anybody is careless. It is that a five-step edit
// across four files is remembered rather than executed, and on 2026-09-21
// TODO.md's header still opened "M21 is the current work" four milestones
// after M21 closed. `pnpm state` has been printing DRIFT at every session
// start because of it.
//
// A sixth manual step would be one more thing to forget. This performs them.
//
// WHAT IT REFUSES TO DO
//
// - Close a milestone with open exit-gate boxes. The gate is the definition of
//   done; a close that ignores it is the bookkeeping without the meaning.
// - Proceed on a parse that found nothing. assertAnchors() throws first — see
//   the anchor contract in scripts/lib/roadmap-read.mjs. Writing four files
//   off a silent miss is how you corrupt four files.
// - Apply anything without --confirm. It prints a unified diff and stops.
//
// WHAT IT DOES THAT NO CHECKLIST STEP SAYS
//
// Step 6, in effect: it PRUNES the candidate entries that say this gate
// deletes them. docs/milestones/README.md states that rule — entries absorbed
// into a milestone are "annotated in place and deleted at those gates" — and
// the rule was being skipped. M23's entry survived its own gate closing on
// 2026-09-19 and was still there two days later. Making the deletion a
// consequence of closing is the only version that holds.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  readCurrentMilestone,
  readMilestoneGate,
  readTodo,
  readStatus,
  readCandidates,
  readMilestoneIndex,
  milestoneFile,
  assertAnchors,
  plain,
} from "./lib/roadmap-read.mjs";

const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();

function read(rel) {
  return readFileSync(join(root, rel), "utf8");
}

/** A minimal unified-diff view: only the lines that change, with context. */
function diffPreview(rel, before, after) {
  if (before === after) return null;
  const a = before.split("\n");
  const b = after.split("\n");
  const out = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (a[i] === b[j]) {
      i += 1;
      j += 1;
      continue;
    }
    // Find the next resync point; a bounded look-ahead keeps this honest about
    // being a preview rather than a real diff algorithm.
    let k = 1;
    let resync = null;
    for (; k < 40 && !resync; k += 1) {
      if (a[i + k] !== undefined && a[i + k] === b[j]) resync = { da: k, db: 0 };
      else if (b[j + k] !== undefined && b[j + k] === a[i]) resync = { da: 0, db: k };
      else if (a[i + k] !== undefined && a[i + k] === b[j + k]) resync = { da: k, db: k };
    }
    const da = resync?.da ?? a.length - i;
    const db = resync?.db ?? b.length - j;
    for (let n = 0; n < da; n += 1) out.push(`  - ${a[i + n]}`);
    for (let n = 0; n < db; n += 1) out.push(`  + ${b[j + n]}`);
    i += da;
    j += db;
  }
  return { rel, lines: out };
}

// --- the five steps ---------------------------------------------------------

/** Step 1 — tick the milestone in TODO.md. */
function stepTickTodo(text, id) {
  const lines = text.split("\n");
  let hit = null;
  for (let i = 0; i < lines.length; i += 1) {
    const m = /^(\s*[-*]\s*)\[ \](\s*\*\*)(M\d+[a-z]?)\b/.exec(lines[i]);
    if (!m || m[3] !== id) continue;
    // The milestone's own row is the one carrying the current marker, or the
    // last unticked one for this id. Ambiguity here is fatal, not guessed:
    // readMilestoneIndex reports it and close() refuses before reaching this.
    hit = i;
  }
  if (hit === null) return { text, note: `TODO.md: no unticked row for ${id} (already ticked?)` };
  lines[hit] = lines[hit].replace(/\[ \]/, "[x]");
  // The `← current milestone` marker moves off a closed milestone; step 4
  // puts it on the next one.
  lines[hit] = lines[hit].replace(/\s*←\s*\*\*current milestone\*\*/i, "");
  return { text: lines.join("\n"), note: `TODO.md:${hit + 1} ticked ${id}` };
}

/** Step 4 — bump "Current milestone" in docs/milestones/README.md. */
function stepBumpCurrent(text, nextId, nextTitle) {
  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (!/^Current milestone:/.test(lines[i])) continue;
    lines[i] = `Current milestone: ${nextId} — ${nextTitle}`;
    return { text: lines.join("\n"), note: `milestones/README.md:${i + 1} -> ${nextId}` };
  }
  return { text, note: "milestones/README.md: no Current milestone line" };
}

/** Step 1b — put the marker on the next milestone's TODO row. */
function stepMoveMarker(text, nextId) {
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const m = /^(\s*[-*]\s*\[ \]\s*\*\*)(M\d+[a-z]?)\b/.exec(lines[i]);
    if (!m || m[2] !== nextId) continue;
    if (/←\s*\*\*current milestone\*\*/i.test(lines[i])) return { text, note: "marker already set" };
    lines[i] = `${lines[i].replace(/\s*$/, "")} ← **current milestone**`;
    return { text: lines.join("\n"), note: `TODO.md:${i + 1} marker -> ${nextId}` };
  }
  return { text, note: `TODO.md: no unticked row for ${nextId} to mark` };
}

/** Step 6 — prune candidate entries this gate deletes. */
function stepPruneCandidates(text, id, cands) {
  const doomed = cands.items.filter((i) => i.state === "placed" && i.milestone === id);
  if (doomed.length === 0) return { text, note: "no candidate entries to prune" };
  const lines = text.split("\n");
  const drop = new Set();
  for (const d of doomed) {
    for (let n = 0; n < d.lines.length; n += 1) drop.add(d.line - 1 + n);
  }
  return {
    text: lines.filter((_, k) => !drop.has(k)).join("\n"),
    note: `candidates.md: pruned ${doomed.length} entry/entries (${doomed.map((d) => d.milestone).join(", ")})`,
  };
}

// --- driver -----------------------------------------------------------------

function close(id, { confirm }) {
  const readers = {
    "current milestone": readCurrentMilestone(root),
    "TODO.md": readTodo(root),
    "STATUS.md": readStatus(root),
    [`${id} exit gate`]: readMilestoneGate(root, id),
  };
  // Throws and names the file. A writing caller never proceeds on a parse that
  // found nothing — see the anchor contract in lib/roadmap-read.mjs.
  assertAnchors(readers);

  const gate = readers[`${id} exit gate`];
  if (gate.open > 0) {
    console.error(
      `milestone close: ${id} has ${gate.open} unticked exit-gate box(es) ` +
        `[${gate.rel}:${gate.line}].\n` +
        `The gate is the definition of done. Closing around it is the bookkeeping ` +
        `without the meaning — tick the boxes, or amend the gate (Mitchell's call, recorded).`,
    );
    process.exit(1);
  }

  const idx = readMilestoneIndex(root);
  const ambiguous = (idx.ambiguous ?? []).find((a) => a.id === id);
  if (ambiguous) {
    console.error(
      `milestone close: ${id} appears on ${ambiguous.rows.length} TODO.md rows with ` +
        `different tick states, so which row to tick is not knowable:\n` +
        ambiguous.rows.map((r) => `  TODO.md:${r.line}  ${r.text}`).join("\n") +
        `\nResolve the rows first; this refuses to guess.`,
    );
    process.exit(1);
  }

  // The next milestone is the first unticked one after this in the index.
  const order = idx.items.filter((m) => m.ticked === false && m.id !== id);
  const next = order[0];
  if (!next) {
    console.error(`milestone close: no unticked milestone left to become current.`);
    process.exit(1);
  }

  const files = {
    "TODO.md": read("TODO.md"),
    "docs/milestones/README.md": read("docs/milestones/README.md"),
    "docs/candidates.md": read("docs/candidates.md"),
  };
  const notes = [];

  let r = stepTickTodo(files["TODO.md"], id);
  files["TODO.md"] = r.text;
  notes.push(r.note);

  r = stepMoveMarker(files["TODO.md"], next.id);
  files["TODO.md"] = r.text;
  notes.push(r.note);

  r = stepBumpCurrent(files["docs/milestones/README.md"], next.id, plain(next.title).replace(/^M\d+[a-z]?\s*—\s*/, ""));
  files["docs/milestones/README.md"] = r.text;
  notes.push(r.note);

  r = stepPruneCandidates(files["docs/candidates.md"], id, readCandidates(root));
  files["docs/candidates.md"] = r.text;
  notes.push(r.note);

  console.log(`MILESTONE CLOSE — ${id} (gate ${gate.ticked}/${gate.ticked} ticked), next: ${next.id}`);
  console.log("");
  for (const n of notes) console.log(`  · ${n}`);
  console.log("");

  const diffs = Object.entries(files)
    .map(([rel, after]) => diffPreview(rel, read(rel), after))
    .filter(Boolean);

  for (const d of diffs) {
    console.log(`--- ${d.rel}`);
    for (const l of d.lines) console.log(l);
    console.log("");
  }

  // Steps 3 and 5 are PROSE — a retro note and STATUS.md's pointer. A script
  // that generated them would be writing the narrative nobody asked it to
  // write, which is the annotation-layer mistake the architecture-map design
  // names. They are listed, not done.
  console.log("STILL YOURS TO WRITE — this script does not invent prose:");
  console.log(`  3. the retro note, appended to ${milestoneFile(root, id)}`);
  console.log(`  5. docs/STATUS.md's "Where the work is right now" and "Next action"`);
  console.log("");

  if (!confirm) {
    console.log("Nothing written. Re-run with --confirm to apply.");
    return;
  }
  for (const [rel, text] of Object.entries(files)) writeFileSync(join(root, rel), text);
  console.log(`Applied to ${diffs.length} file(s). Steps 3 and 5 above are still open.`);
}

function main() {
  const [cmd, id, ...rest] = process.argv.slice(2);
  if (cmd !== "close" || !id) {
    console.error("usage: pnpm milestone close <id> [--confirm]");
    console.error("  Runs the gate-close checklist across TODO.md, milestones/README.md");
    console.error("  and candidates.md. Prints a diff and stops unless --confirm.");
    process.exit(1);
  }
  close(id, { confirm: rest.includes("--confirm") });
}

main();
