#!/usr/bin/env node
// `pnpm surface` — how big is the surface every session reads first?
// `pnpm surface --check` — the wall: fail when a file exceeds its budget.
//
// ONE implementation for the report and the wall, on purpose: a wall whose
// thresholds live apart from the report that motivates them is a wall nobody
// can argue with. The budgets below are data, not scattered constants.
//
// WHY THIS IS MEASURED AT ALL
//
// docs/reviews/2026-09-21-development-loop-review.md found this surface had
// DOUBLED in nineteen days — 315,687 B at the 2026-09-02 tooling review to
// 635,502 B — while nobody was watching, because no number was being kept.
// The same review measured a 51.3x cache re-read multiplier: a token at the
// top of a session's context is re-read ~51 times before that session ends,
// so this is the one place where a byte saved is not saved once.
//
// WHAT THIS DOES AND DOES NOT PROVE
//
// It proves the SURFACE shrank. It does not prove sessions got cheaper — a
// session can read just as much from smaller files, or read the commands AND
// the files. The outcome measure is F1/F2 in `pnpm session-metrics`, which
// needs the transcript corpus. Keep the two claims apart when quoting either.
//
// ON THE BUDGETS
//
// Each is set ABOVE the post-split size, not at it. A wall tuned to today's
// exact number turns the next legitimate paragraph into a red build, and the
// repo's own rule is that a check firing on something a person chose is a
// check that gets trained away ("if a hook misfires twice, delete it rather
// than tuning it"). These fire on growth, which is the thing that went wrong.

import { statSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

// path -> byte budget. `null` means reported but not walled: known-issues is
// a directory whose size is a backlog problem (see the review's C1), not a
// prose-discipline one, and walling it would pressure people to write shorter
// KI entries, which is the opposite of what that file set is for.
// The rule, so the numbers are arguable rather than arbitrary: each budget is
// ~1.25x the file's size when it was set (2026-09-21), rounded. That leaves
// real room for the next legitimate section while still catching a return
// toward the sizes that prompted the split — TODO.md was 107,642 B and
// milestones/README.md 104,498 B the day before.
//
// Raising a budget is a decision to record in the commit that raises it, not
// a reflex when the wall goes red.
const BUDGETS = {
  "TODO.md": 55_000, // 40,451 at set
  "docs/milestones/README.md": 85_000, // 69,444 at set
  "docs/STATUS.md": 80_000, // 63,557 at set — and already past its OWN stated
  // "~300 lines is the signal" rule at 969 lines, so this budget is a ceiling
  // on further growth, not an endorsement of the current size.
  "AGENTS.md": 47_000, // 37,515 at set
  "CLAUDE.md": 10_000, // 3,639 at set
  "docs/known-issues/open/": null,
};

function sizeOf(root, rel) {
  const full = join(root, rel);
  if (rel.endsWith("/")) {
    try {
      return readdirSync(full)
        .filter((f) => f.endsWith(".md"))
        .reduce((n, f) => n + statSync(join(full, f)).size, 0);
    } catch {
      return null;
    }
  }
  try {
    return statSync(full).size;
  } catch {
    return null;
  }
}

/** The same paths at a git ref, for a before/after that needs no bookkeeping. */
function sizeAtRef(root, rel, ref) {
  try {
    if (rel.endsWith("/")) {
      const names = execFileSync("git", ["ls-tree", "--name-only", `${ref}:${rel.replace(/\/$/, "")}`], {
        cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
      }).trim().split("\n").filter((n) => n.endsWith(".md"));
      let total = 0;
      for (const n of names) {
        total += Number(
          execFileSync("git", ["cat-file", "-s", `${ref}:${rel}${n}`], {
            cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
          }).trim(),
        );
      }
      return total;
    }
    return Number(
      execFileSync("git", ["cat-file", "-s", `${ref}:${rel}`], {
        cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
      }).trim(),
    );
  } catch {
    return null; // the path did not exist at that ref
  }
}

export function collect(root, { since } = {}) {
  return Object.entries(BUDGETS).map(([rel, budget]) => {
    const bytes = sizeOf(root, rel);
    const was = since ? sizeAtRef(root, rel, since) : null;
    return {
      rel,
      bytes,
      budget,
      was,
      over: budget !== null && bytes !== null && bytes > budget,
    };
  });
}

function fmt(n) {
  return n === null ? "—" : n.toLocaleString();
}

function main() {
  const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
  const argv = process.argv.slice(2);
  const check = argv.includes("--check");
  const i = argv.indexOf("--since");
  const since = i >= 0 ? argv[i + 1] : undefined;

  const rows = collect(root, { since });
  const total = rows.reduce((n, r) => n + (r.bytes ?? 0), 0);
  const totalWas = since ? rows.reduce((n, r) => n + (r.was ?? 0), 0) : null;

  if (argv.includes("--json")) {
    console.log(JSON.stringify({ rows, total, totalWas }, null, 2));
  } else {
    const w = Math.max(...rows.map((r) => r.rel.length));
    console.log(`FIRST-READ SURFACE${since ? `  (vs ${since})` : ""}`);
    console.log("");
    for (const r of rows) {
      // An unchanged file prints nothing rather than "+0 (0%)": a column of
      // zeroes is noise that hides the rows that did move.
      const delta =
        r.was === null || r.was === undefined || r.was === r.bytes
          ? ""
          : `  ${r.was > r.bytes ? "-" : "+"}${fmt(Math.abs(r.was - r.bytes))}` +
            (r.was ? ` (${(((r.bytes - r.was) / r.was) * 100).toFixed(0)}%)` : "");
      const budget = r.budget === null ? "not walled" : `budget ${fmt(r.budget)}`;
      console.log(
        `  ${r.over ? "XX" : "OK"}  ${r.rel.padEnd(w)}  ${fmt(r.bytes).padStart(9)} B` +
          `  ~${fmt(Math.round((r.bytes ?? 0) / 4)).padStart(7)} tok  ${budget}${delta}`,
      );
    }
    console.log("");
    console.log(
      `  TOTAL ${fmt(total)} B  ~${fmt(Math.round(total / 4))} tok` +
        (totalWas ? `   was ${fmt(totalWas)} B  (${(((total - totalWas) / totalWas) * 100).toFixed(0)}%)` : ""),
    );
    console.log("");
    console.log("  Byte counts prove the SURFACE shrank, not that sessions got cheaper.");
    console.log("  The outcome measure is F1/F2 in `pnpm session-metrics`.");
  }

  if (!check) return;
  const over = rows.filter((r) => r.over);
  if (over.length === 0) {
    console.log("");
    console.log(`surface wall OK (${rows.filter((r) => r.budget !== null).length} files within budget)`);
    return;
  }
  console.error("");
  for (const r of over) {
    console.error(
      `surface wall: ${r.rel} is ${fmt(r.bytes)} B, over its ${fmt(r.budget)} B budget by ${fmt(r.bytes - r.budget)}.`,
    );
  }
  console.error(
    `\nThis is a first-read file — every session pays it, and the 2026-09-02 review\n` +
      `measured a 51.3x re-read multiplier on what sits at the top of a context.\n` +
      `Move the narrative to where it belongs (a milestone file, a retro, an archive)\n` +
      `and leave a pointer, per docs/milestones/README.md's gate-close checklist.\n` +
      `Raising the budget is a decision to record, not a way past this.`,
  );
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
