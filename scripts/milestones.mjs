#!/usr/bin/env node
// `pnpm milestones` — the whole milestone table, extracted.
//
// docs/milestones/README.md is ~68KB and TODO.md carries the same milestones
// as checkboxes. This joins them on the id and prints one line each, so the
// usual question ("what is done, what is next, how far into the gate are we")
// costs a command instead of two files.
//
// It prints a DISAGREEMENT rather than picking a side: a milestone ticked in
// TODO whose gate still has open boxes, or the reverse, is exactly the drift
// the gate-close checklist exists to prevent, and a table that silently
// preferred one source would hide it.

import { readMilestoneIndex, findDrift } from "./lib/roadmap-read.mjs";

function main() {
  const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
  const idx = readMilestoneIndex(root);

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(idx.items, null, 2));
    return;
  }
  if (idx.anchorMissing) {
    console.error("milestones: no milestone files matched M<n>-*.md under docs/milestones.");
    process.exit(1);
  }

  console.log(`MILESTONES — ${idx.items.length}, current ${idx.current.id ?? "(unset)"}`);
  console.log("");

  for (const m of idx.items) {
    const tick = m.ticked === undefined ? "?" : m.ticked ? "x" : " ";
    let gate = "";
    if (m.gate?.anchorMissing) gate = "no gate section";
    else if (m.gate) {
      gate = `${m.gate.ticked}/${m.gate.ticked + m.gate.open}`;
      if (m.gate.descoped) gate += ` (+${m.gate.descoped} cut)`;
      if (m.gate.gates?.length > 1) gate += ` over ${m.gate.gates.length} waves`;
    }
    const marker = m.isCurrent ? " ← current" : "";
    console.log(`  [${tick}] ${m.id.padEnd(5)} ${m.title.padEnd(52)} ${gate}${marker}`);
  }

  // The same four-way check the digest runs, so both agree by construction.
  const drift = findDrift({
    milestone: idx.current,
    todo: idx.todo,
    gate: idx.items.find((m) => m.isCurrent)?.gate ?? null,
    status: { rel: "docs/STATUS.md", mentions: "" },
  }).filter((d) => !d.includes("STATUS.md")); // STATUS is the digest's to report

  // A milestone ticked in TODO whose gate is not fully ticked, or the reverse.
  const mismatch = idx.items.filter(
    (m) => m.gate && !m.gate.anchorMissing && m.ticked !== undefined &&
      (m.ticked ? m.gate.open > 0 : m.gate.open === 0 && m.gate.ticked > 0),
  );

  const ambiguous = idx.ambiguous ?? [];

  if (drift.length || mismatch.length || ambiguous.length) {
    console.log("");
    console.log("DISAGREEMENTS — facts, not verdicts. Run /roadmap for the judgement.");
    for (const d of drift) console.log(`  - ${d}`);
    for (const a of ambiguous) {
      console.log(
        `  - ${a.id} appears on ${a.rows.length} checkbox rows in TODO.md with different ` +
          `tick states, so its state is UNKNOWN rather than guessed:`,
      );
      for (const r of a.rows) console.log(`      [${r.ticked ? "x" : " "}] TODO.md:${r.line}  ${r.text}`);
    }
    for (const m of mismatch) {
      console.log(
        `  - ${m.id} is ${m.ticked ? "ticked in TODO.md but its gate has " + m.gate.open + " open box(es)"
          : "unticked in TODO.md but every gate box is ticked"}  [${m.rel}:${m.gate.line}]`,
      );
    }
  }
}

main();
