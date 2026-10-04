import { readdirSync } from "node:fs";

// THE ADR NUMBER WALL: no two decision records share a number.
//
// An ADR's number is the string prose cites — "ADR-041" in CLAUDE.md, source
// comments, retros and milestone files — so a number used twice is a citation
// that names two decisions. It happens the same way known-issue ids collide
// (`check-ki-filenames.mjs` is this file's sibling): two branches open at once,
// each picks "the next free number" from its own view of `docs/architecture/`,
// and both are right until the second one merges. Git reports no conflict,
// because the filenames differ after the number.
//
// It has happened twice. ADR-063 was taken by two decisions on `main` within a
// day of each other (08071e8, the public library cache; b2cf341, open signup),
// and the suggester role's ADR was renumbered to ADR-064 on its branch after
// colliding with them — `docs/retros/2026-10-04-suggester-role-retro.md`,
// "Numbering collisions with `main`". Neither was caught by anything but a
// person reading `ls`.
//
// WHAT IT CANNOT CATCH: a collision with a branch that has not merged yet. The
// wall reads one tree. That is why `docs/guidelines/stacked-prs.md` says to
// merge `main` before picking a number, and to run `pnpm lint` after every
// merge of `main` — that is the moment the two numbers first share a tree.

const ADR = /^ADR-(?<num>\d+)-.+\.md$/;

// Numbers already shared on `main` when this wall was written. Each entry lists
// the exact files allowed to share it, so a THIRD file taking the number still
// fails. They are grandfathered rather than renumbered because other files cite
// them — `grep -rn ADR-063` finds both decisions in prose, and the citations do
// not say which one they mean. Untangling that is its own job, not a drive-by
// in the branch that added the wall. Do not add to this list: a new ADR has no
// citations yet, so renumbering it costs nothing.
const GRANDFATHERED = new Map([
  ["063", ["ADR-063-signup-is-open.md", "ADR-063-the-public-library-is-cached-for-a-day.md"]],
]);

/**
 * Every ADR number used by more than one file in `files`, minus the exact
 * pairs grandfathered above, as `[number, filenames]` with filenames sorted.
 */
export function collisions(files) {
  const byNumber = new Map();
  for (const file of files) {
    const match = ADR.exec(file);
    if (!match) continue;
    // Keyed by value, so `ADR-63-…` and `ADR-063-…` are one number: prose
    // writes it padded, and a typo'd filename is still the same citation.
    const num = String(Number(match.groups.num)).padStart(3, "0");
    byNumber.set(num, [...(byNumber.get(num) ?? []), file]);
  }
  const shared = [];
  for (const [num, names] of byNumber) {
    if (names.length < 2) continue;
    const allowed = GRANDFATHERED.get(num);
    const sorted = [...names].sort();
    if (allowed && sorted.join("\n") === [...allowed].sort().join("\n")) continue;
    shared.push([num, sorted]);
  }
  return shared.sort(([a], [b]) => a.localeCompare(b));
}

const ROOT = process.argv[2] ?? "docs/architecture";
const files = readdirSync(ROOT).filter((file) => file.endsWith(".md"));
const shared = collisions(files);

if (shared.length > 0) {
  for (const [num, names] of shared) {
    console.error(`ADR-${num} is used by ${names.length} files:\n    ${names.join("\n    ")}`);
  }
  const next = Math.max(...files.map((f) => Number(ADR.exec(f)?.groups.num ?? 0))) + 1;
  console.error(
    `\nADR NUMBER WALL BREACHED: ${shared.length} number(s) shared by two or more decisions.\n` +
      `Give the newer ADR the next free number (ADR-${String(next).padStart(3, "0")}) and update its\n` +
      "citations. A number is what prose cites, so two decisions under one number are\n" +
      "a citation nobody can resolve. Merge `main` before picking one\n" +
      "(docs/guidelines/stacked-prs.md).",
  );
  process.exit(1);
}

console.log(`adr number wall OK (${files.length} files scanned, ${GRANDFATHERED.size} grandfathered)`);
