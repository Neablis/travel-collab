import { spawnSync } from "node:child_process";
import { globSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// `pnpm arch:baseline` — regenerate `.dependency-cruiser-known-violations.json`
// with ERROR-severity violations only (KI-2026-09-25-e).
//
// Plain `depcruise-baseline` records every current violation, warn level
// included. The warn-level ones here are the `no-folder-cycle-known` clusters,
// which `.dependency-cruiser.cjs` promises are printed on every `pnpm arch`
// run; a baseline is the list of things `--ignore-known` stops printing, so a
// warning has no business in it. dependency-cruiser 18.4 happens not to soften
// folder-level entries yet (a TODO in `soften-known-violations.mjs`), which is
// the only reason a regenerated file did not already silence them — the day it
// does, or the day a module-level rule is set to `warn`, it would. Filtering at
// the source keeps the file meaning one thing: accepted errors, shrinking.
//
// Usage:
//   node scripts/arch-baseline.mjs                    cruise the workspace
//   node scripts/arch-baseline.mjs --from <file>      filter an existing
//                                                     baseline-format JSON
//   --output-to <file>                                where to write (default
//                                                     the repo's baseline)

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE = ".dependency-cruiser-known-violations.json";

/** The violations a baseline may carry: error severity, nothing softer. */
export function keepErrorSeverity(violations) {
  return violations.filter((violation) => violation.rule?.severity === "error");
}

function cruise() {
  const targets = [
    "apps/web/src",
    ...globSync("packages/*/src", { cwd: ROOT }).sort(),
  ];
  const result = spawnSync(
    "pnpm",
    ["exec", "depcruise", "--output-type", "baseline", ...targets],
    {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }
  return result.stdout;
}

function main(argv) {
  const from = argv.includes("--from")
    ? argv[argv.indexOf("--from") + 1]
    : undefined;
  const outputTo = argv.includes("--output-to")
    ? argv[argv.indexOf("--output-to") + 1]
    : join(ROOT, BASELINE);

  const all = JSON.parse(from ? readFileSync(from, "utf8") : cruise());
  const kept = keepErrorSeverity(all);
  // Same shape depcruise-baseline writes: the reporter's sort order, two-space
  // indent, trailing newline — so a regeneration diffs only on real change.
  writeFileSync(outputTo, `${JSON.stringify(kept, null, 2)}\n`);
  console.log(
    `arch:baseline: ${kept.length} error-severity violation(s) written to ${outputTo}; ` +
      `${all.length - kept.length} warn/info-level left out so \`pnpm arch\` keeps printing them.`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  main(process.argv.slice(2));
