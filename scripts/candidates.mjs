#!/usr/bin/env node
// `pnpm candidates` — docs/candidates.md as one line per entry.
//
// The file is ~40KB of unscheduled ideas. This is the index; the file is the
// detail, and every line here cites the offset to open. Same contract as
// scripts/state-digest.mjs: extracted, never summarised, so it cannot be
// stale in a way the file is not.
//
// Read-only and advisory — it degrades on a missing anchor rather than
// throwing, because nothing it prints is written anywhere.

import { readCandidates } from "./lib/roadmap-read.mjs";

const STATE_MARK = { placed: "PLACED", scoped: "scoped", unplaced: "" };

function main() {
  const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
  const argv = process.argv.slice(2);
  const res = readCandidates(root);

  if (argv.includes("--json")) {
    console.log(JSON.stringify(res.items.map(({ lines, ...rest }) => rest), null, 2));
    return;
  }

  if (res.missing) {
    console.error(`candidates: ${res.rel} not found.`);
    process.exit(1);
  }
  if (res.anchorMissing) {
    console.error(
      `candidates: ${res.rel} has list items but none matched the entry syntax ` +
        `(\`- **Title…\`). The file may have been reformatted; printing nothing ` +
        `would read as "no candidates", which is why this says so instead.`,
    );
  }

  const only = argv.find((a) => !a.startsWith("--"));
  const items = only ? res.items.filter((i) => i.state === only) : res.items;

  const bytes = res.items.reduce((n, i) => n + i.bytes, 0);
  console.log(
    `CANDIDATE IDEAS — ${res.items.length} entries, ${bytes.toLocaleString()} B in ${res.rel}`,
  );
  const counts = res.items.reduce((acc, i) => ({ ...acc, [i.state]: (acc[i.state] ?? 0) + 1 }), {});
  console.log(
    `  ${counts.unplaced ?? 0} unplaced · ${counts.placed ?? 0} placed (a gate close deletes these) · ` +
      `${counts.scoped ?? 0} scoped into a milestone but kept`,
  );
  console.log("");

  for (const i of items) {
    const mark = STATE_MARK[i.state];
    const tag = mark ? `${mark}${i.milestone ? `→${i.milestone}` : ""}` : "";
    console.log(`  ${(i.date ?? "").padEnd(10)} ${tag.padEnd(14)} ${i.title}`);
    console.log(`  ${" ".repeat(25)} ${res.rel}:${i.line}`);
  }

  if (counts.placed) {
    console.log("");
    console.log(
      `  ${counts.placed} entry/entries say a gate close deletes them. ` +
        `\`pnpm milestone close\` does that; nobody has to remember it.`,
    );
  }
}

main();
