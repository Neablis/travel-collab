import { execSync } from "node:child_process";

// KI-33 GUARD: no two paths may differ only in case.
//
// `UnscheduledRack.tsx` and `unscheduledRack.ts` coexisted happily on CI's
// ext4 and were invisible there, while on macOS APFS and Windows NTFS the
// specifier `@/components/trip/UnscheduledRack` could resolve to whichever
// landed in the module graph first. That cost 25 failing unit tests, a TS1149,
// and — the expensive part — `next build` failing outright on every developer
// machine, which took `test:e2e:ci-like` with it and left CI as the only
// trustworthy signal for four days.
//
// CI is precisely where that bug class is invisible, so this check has to be
// explicit rather than emergent: nothing else in the pipeline can see it.
//
// Two blind spots, both found by KI-2026-09-05-s's self-test and closed here:
//
//   * `git ls-files` alone sees only TRACKED paths, so a collision introduced
//     by an untracked file was invisible until it was committed — the same
//     blind spot KI-51 found in the colour wall. `--others
//     --exclude-standard` adds untracked-but-not-ignored files.
//   * The whole-path compare could not see KI-33's OWN pair, cited above.
//     `UnscheduledRack.tsx` and `unscheduledRack.ts` differ in EXTENSION as
//     well as case, so lowercased they are two different strings. The real
//     collision was one level up, at the module specifier: extensions resolve
//     last, so both files answer to `@/components/trip/UnscheduledRack`.
const files = execSync("git ls-files --cached --others --exclude-standard", {
  encoding: "utf8",
  // `execSync` truncates at 1MB by default and THROWS ENOBUFS rather than
  // returning short — but adding `--others` grew this list, and a wall that
  // dies on a big checkout is a wall that stops running. 64MB is far past any
  // plausible path list. (CodeRabbit, PR #147.)
  maxBuffer: 64 * 1024 * 1024,
})
  .split("\n")
  .filter(Boolean);

/** Extensions the TS/Next resolver will try for an extensionless specifier. */
const RESOLVED_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"];

/** `a/B.tsx` -> `a/B`, but only for files a specifier can reach extensionless. */
function moduleSpecifier(file) {
  const ext = RESOLVED_EXTENSIONS.find((candidate) => file.endsWith(candidate));
  return ext === undefined ? null : file.slice(0, -ext.length);
}

/** Group `keyOf(file)` -> files, keeping only groups holding >1 distinct key. */
function collisionsBy(keyOf, distinctOf) {
  const byLower = new Map();
  for (const file of files) {
    const key = keyOf(file);
    if (key === null) continue;
    const lower = key.toLowerCase();
    if (!byLower.has(lower)) byLower.set(lower, new Map());
    byLower.get(lower).set(distinctOf(file), file);
  }
  return [...byLower.values()].filter((group) => group.size > 1).map((group) => [...group.values()]);
}

// Two files whose full paths differ only in case.
const pathCollisions = collisionsBy(
  (file) => file,
  (file) => file,
);

// Two files whose module SPECIFIERS differ only in case. Keyed on the
// specifier rather than the path, so a `.tsx`/`.ts` pair is caught — and
// distinct-keyed on the specifier too, so `foo.ts` + `foo.tsx` (identical
// specifier, no case difference) is NOT reported: that is an extension
// ambiguity, a different problem, and not this wall's to raise.
const specifierCollisions = collisionsBy(moduleSpecifier, (file) => moduleSpecifier(file));

// A pure-case pair with matching extensions is found by BOTH checks; report it
// once. Keyed on the group's own members, so the dedupe cannot merge two
// genuinely different groups.
const collisions = [
  ...new Map(
    [...pathCollisions, ...specifierCollisions].map((group) => [
      [...group].sort().join("\u0000"),
      group,
    ]),
  ).values(),
];

if (collisions.length > 0) {
  for (const group of collisions) {
    console.error(`case-only collision: ${group.join("  ↔  ")}`);
  }
  console.error(
    "\nThese resolve to one file on macOS/Windows. Rename one — prefer naming a " +
      "module after what it exports (KI-33 renamed unscheduledRack.ts to fitIntoDay.ts).",
  );
  process.exit(1);
}

console.log(`case collision check OK (${files.length} paths)`);
