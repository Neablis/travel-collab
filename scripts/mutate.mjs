// Mutation testing, on demand and narrowly scoped.
//
// WHY THIS IS A SCRIPT AND NOT A CI JOB. Coverage says a line RAN. It does not
// say a test would NOTICE that line changing, and that gap is where a test with
// no value lives — `scripts/coverage-overlap.mjs` says the same thing in its
// own header and points here. Mutation testing closes it: change the code
// deliberately, and see whether anything goes red.
//
// The test-overhaul plan (Phase 5 Task 5.3) evaluated a permanent Stryker CI
// job and REJECTED it, correctly: it is a tax on every PR to catch a defect on
// a few, and it would take hours across this repo. It did not reject the
// instrument. This is the instrument, made cheap enough to reach for:
//
//   pnpm mutate packages/domain/src/trip/diff.ts
//   pnpm mutate packages/domain/src/trip/{decide,evolve}.ts
//   pnpm mutate apps/web/src/lib/kmLabel.ts
//
// WHEN TO USE IT. The default proof that a test is worth its cost is the
// red-first drill in docs/guidelines/testing.md §3 — break the code, watch the
// test fail. Reach for this instead when "break the code" has too many meanings
// to pick one: a function with many branches, a reducer, a conflict rule. Also
// use it before deleting a test you believe is redundant — the retention rule
// is that removing a test must not produce a surviving mutant.
//
// HOW TO READ THE OUTPUT. A SURVIVED mutant is the finding: Stryker changed
// the code and every test still passed. That is either a missing assertion or
// a line nothing needs. Both are worth knowing; neither is automatically a bug.
// A NO COVERAGE mutant means no test executes that line at all. Ignore the
// overall percentage — it is not a target, and treating it as one produces the
// same per-branch filler a coverage gate does.
import { execFileSync } from "node:child_process";
import { writeFileSync, rmSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative, resolve } from "node:path";

const ROOT = process.cwd();

// Same package boundaries the minimal-check-subset skill uses, for the same
// reason: Stryker has to run where the tests and the vitest config are.
const PACKAGES = [
  "apps/web",
  "packages/contracts",
  "packages/domain",
  "packages/factories",
  "packages/fixtures",
  "packages/pages",
  "packages/predict",
];

const targets = process.argv.slice(2);
if (targets.length === 0) {
  console.error("usage: pnpm mutate <path> [<path>...]   (source files, not test files)");
  console.error("e.g.:  pnpm mutate packages/domain/src/trip/diff.ts");
  process.exit(2);
}

const owners = new Set();
for (const target of targets) {
  const rel = relative(ROOT, resolve(ROOT, target));
  const owner = PACKAGES.find((p) => rel === p || rel.startsWith(`${p}/`));
  if (!owner) {
    console.error(`Cannot tell which package owns ${target}. Pass a path under one of:\n  ${PACKAGES.join("\n  ")}`);
    process.exit(2);
  }
  if (/\.test\.[cm]?[jt]sx?$/.test(rel)) {
    console.error(`${target} is a test file. Mutate the SOURCE it covers — the point is whether the test notices a change to it.`);
    process.exit(2);
  }
  owners.add(owner);
}

if (owners.size > 1) {
  console.error(`Targets span ${owners.size} packages (${[...owners].join(", ")}). Run one package at a time — Stryker runs one test suite.`);
  process.exit(2);
}

const owner = [...owners][0];
const mutate = targets.map((t) => relative(join(ROOT, owner), resolve(ROOT, t)));
const configPath = join(ROOT, owner, "stryker.tmp.json");

// Written per run rather than committed, because the only field that varies is
// `mutate` and a committed config would invite someone to widen it into the
// whole-repo run this script exists not to be.
// Stryker resolves plugins relative to the config file, which sits inside the
// target package — and pnpm's strict node_modules means a root devDependency is
// NOT visible from there. Without this the run dies with "Cannot find
// TestRunner plugin \"vitest\". In fact, no TestRunner plugins were loaded",
// which reads like a missing install and is not one. Resolve it from the root,
// where it actually lives, and hand Stryker the absolute path.
const vitestRunner = createRequire(import.meta.url).resolve("@stryker-mutator/vitest-runner");

const config = {
  packageManager: "pnpm",
  testRunner: "vitest",
  plugins: [vitestRunner],
  reporters: ["clear-text", "progress"],
  coverageAnalysis: "perTest",
  mutate,
  // A run that finds nothing is a useful answer here, so neither threshold
  // failing the process is deliberate: this reports, it does not gate.
  thresholds: { high: 100, low: 0, break: null },
  tempDirName: ".stryker-tmp",
};

writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
console.log(`Mutating ${mutate.length} file(s) in ${owner}:`);
for (const m of mutate) console.log(`  ${m}`);
console.log("");

try {
  execFileSync("pnpm", ["exec", "stryker", "run", "stryker.tmp.json"], {
    cwd: join(ROOT, owner),
    stdio: "inherit",
  });
} catch {
  process.exitCode = 1;
} finally {
  rmSync(configPath, { force: true });
  const tmp = join(ROOT, owner, ".stryker-tmp");
  if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
}
