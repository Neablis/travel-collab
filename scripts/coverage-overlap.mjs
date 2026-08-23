// Per-test-file coverage overlap analysis.
//
// Answers, deterministically, the question the Phase 0 inventory's "also
// covered by" column asks: which OTHER test files execute the same source
// lines this one does?
//
// Method: run every test file in isolation with v8 coverage, record the set of
// covered statements per source file, then intersect. Aggregate coverage from
// one whole-suite run cannot do this — it collapses every test's contribution
// into one map, which is exactly the information we need to keep separate.
//
// WHAT THIS PROVES AND WHAT IT DOES NOT.
// Coverage says a line RAN. It does not say a test would NOTICE that line
// changing. Two tests with identical coverage footprints can differ entirely
// in value — an assertion on a Tailwind class and an assertion on behavior
// both "cover" the same component. So: high overlap is a CANDIDATE for
// redundancy, never a verdict. Mutation testing (Phase 5 Task 5.3) is the
// instrument that answers the value question; this one narrows where to point
// it. Conversely, a source line covered by exactly ONE test file is a hard
// keep-signal, and that half IS deterministic.
//
// Usage:
//   node scripts/coverage-overlap.mjs collect      # slow (~10 min), writes raw maps
//   node scripts/coverage-overlap.mjs report       # fast, reads them back

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const OUT = process.env.COVERAGE_OUT ?? join(ROOT, ".coverage-overlap");

const SUITES = [
  { name: "web-unit", cwd: "apps/web", config: "vitest.unit.config.ts", glob: "src/**/*.test.{ts,tsx}", exclude: /\.int\.test\./ },
  { name: "domain", cwd: "packages/domain", config: null, glob: "test/**/*.test.ts" },
  { name: "contracts", cwd: "packages/contracts", config: null, glob: "test/**/*.test.ts" },
  { name: "pages", cwd: "packages/pages", config: null, glob: "src/**/*.test.ts" },
];

function testFilesFor(suite) {
  const out = execFileSync("find", [suite.glob.split("/")[0], "-name", "*.test.ts", "-o", "-name", "*.test.tsx"], {
    cwd: join(ROOT, suite.cwd), encoding: "utf8",
  });
  return out.split("\n").filter(Boolean).filter((f) => !suite.exclude?.test(f)).sort();
}

function collect(only) {
  const resume = only && existsSync(join(OUT, "index.json"));
  if (existsSync(OUT) && !resume) rmSync(OUT, { recursive: true });
  mkdirSync(OUT, { recursive: true });
  const index = resume
    ? JSON.parse(readFileSync(join(OUT, "index.json"), "utf8")).filter((e) => !only.includes(e.suite))
    : [];

  for (const suite of SUITES.filter((s) => !only || only.includes(s.name))) {
    for (const file of testFilesFor(suite)) {
      const dir = join(OUT, "raw", suite.name, file.replace(/[/.]/g, "_"));
      const args = ["exec", "vitest", "run"];
      if (suite.config) args.push("-c", suite.config);
      args.push(file, "--coverage", "--coverage.provider=v8", "--coverage.reporter=json",
                "--coverage.all=false", `--coverage.reportsDirectory=${dir}`, "--reporter=dot");
      try {
        execFileSync("pnpm", args, { cwd: join(ROOT, suite.cwd), stdio: "pipe", timeout: 180_000 });
        index.push({ suite: suite.name, file, dir, ok: true });
        process.stderr.write(".");
      } catch (err) {
        index.push({ suite: suite.name, file, dir, ok: false, error: String(err.message).slice(0, 200) });
        process.stderr.write("!");
      }
    }
  }
  writeFileSync(join(OUT, "index.json"), JSON.stringify(index, null, 2));
  process.stderr.write(`\ncollected ${index.filter((e) => e.ok).length}/${index.length}\n`);
}

// Set of "sourceFile:statementId" strings a given test file actually executed.
function coveredKeys(entry) {
  const path = join(entry.dir, "coverage-final.json");
  if (!existsSync(path)) return new Set();
  const map = JSON.parse(readFileSync(path, "utf8"));
  const keys = new Set();
  for (const [absFile, data] of Object.entries(map)) {
    if (absFile.includes("node_modules")) continue;
    if (/\.test\.|\.spec\./.test(absFile)) continue;
    const src = relative(ROOT, absFile);
    for (const [id, hits] of Object.entries(data.s ?? {})) {
      if (hits > 0) keys.add(`${src}#${id}`);
    }
  }
  return keys;
}
// A test file's SUBJECT: the source file it is named after.
// `MapRail.test.tsx` -> `MapRail.tsx`.
function subjectCandidates(testFile) {
  const base = testFile.replace(/\.(test|spec)\.(ts|tsx)$/, "");
  return [`${base}.ts`, `${base}.tsx`];
}

function report() {
  const index = JSON.parse(readFileSync(join(OUT, "index.json"), "utf8")).filter((e) => e.ok);
  const cov = new Map();
  for (const e of index) cov.set(`${e.suite}/${e.file}`, { keys: coveredKeys(e), file: e.file });

  // Per SOURCE file: which test files touch it.
  //
  // WHY THIS IS SCOPED. The first draft of this script measured overlap over a
  // test's WHOLE coverage footprint. That number is meaningless: every domain
  // test transitively loads evolve/decide/contracts, so `equality.test.ts`
  // scored "0% unique, 100% overlapped" and looked deletable — while
  // `tripStatesEqual` is tested NOWHERE else. Same false positive for
  // `formatMoney.test.ts`, the single source of truth for money formatting.
  // Shared imports drown the signal. Scope to the subject or don't bother.
  const bySource = new Map();
  const stmtTotals = new Map();
  for (const [test, { keys }] of cov) {
    for (const k of keys) {
      const i = k.lastIndexOf("#");
      const src = k.slice(0, i), id = k.slice(i + 1);
      if (!bySource.has(src)) { bySource.set(src, new Map()); stmtTotals.set(src, new Set()); }
      stmtTotals.get(src).add(id);
      bySource.get(src).set(test, (bySource.get(src).get(test) ?? 0) + 1);
    }
  }

  const out = { overTested: [], sole: [], subsumed: [] };

  console.log("## A. Over-tested source files (>=4 different test files execute them)\n");
  console.log("| testers | stmts | source file | test files |");
  console.log("|---|---|---|---|");
  out.overTested = [...bySource.entries()]
    .map(([src, m]) => ({ src, testers: m.size, stmts: stmtTotals.get(src).size, tests: [...m.keys()].map((t) => t.split("/").pop()) }))
    .filter((r) => r.testers >= 4)
    .sort((a, b) => b.testers - a.testers);
  for (const r of out.overTested.slice(0, 25)) {
    console.log(`| ${r.testers} | ${r.stmts} | \`${r.src}\` | ${r.tests.slice(0, 8).join(", ")}${r.tests.length > 8 ? ` +${r.tests.length - 8}` : ""} |`);
  }

  console.log("\n## B. Sole-coverage: source files exactly ONE test file reaches (hard keeps)\n");
  console.log("| stmts | source file | only tested by |");
  console.log("|---|---|---|");
  out.sole = [...bySource.entries()]
    .filter(([, m]) => m.size === 1)
    .map(([src, m]) => ({ src, stmts: stmtTotals.get(src).size, test: [...m.keys()][0] }))
    .sort((a, b) => b.stmts - a.stmts);
  for (const r of out.sole.slice(0, 40)) console.log(`| ${r.stmts} | \`${r.src}\` | \`${r.test.split("/").pop()}\` |`);

  console.log("\n## C. Subject-scoped subsumption (>=80% of a test's OWN subject covered elsewhere)\n");
  console.log("| test file | subject | stmts it covers | best other tester | covers |");
  console.log("|---|---|---|---|---|");
  for (const [test, { keys, file }] of cov) {
    const cands = subjectCandidates(file);
    const subject = [...bySource.keys()].find((src) => cands.some((c) => src.endsWith(c.replace(/^(src|test)\//, "/"))  || src.endsWith(c)));
    if (!subject) continue;
    const mine = new Set([...keys].filter((k) => k.startsWith(`${subject}#`)).map((k) => k.slice(subject.length + 1)));
    if (mine.size === 0) continue;
    let best = null;
    for (const [other, { keys: ok }] of cov) {
      if (other === test) continue;
      const theirs = new Set([...ok].filter((k) => k.startsWith(`${subject}#`)).map((k) => k.slice(subject.length + 1)));
      if (theirs.size === 0) continue;
      const pct = Math.round(([...mine].filter((id) => theirs.has(id)).length / mine.size) * 100);
      if (!best || pct > best.pct) best = { other, pct, size: theirs.size };
    }
    if (best && best.pct >= 80) out.subsumed.push({ test, subject, mine: mine.size, best });
  }
  out.subsumed.sort((a, b) => b.best.pct - a.best.pct || b.mine - a.mine);
  for (const r of out.subsumed) {
    console.log(`| \`${r.test.split("/").pop()}\` | \`${r.subject.split("/").pop()}\` | ${r.mine} | \`${r.best.other.split("/").pop()}\` | ${r.best.pct}% (${r.best.size}) |`);
  }

  writeFileSync(join(OUT, "overlap.json"), JSON.stringify(out, null, 2));
}

const cmd = process.argv[2] ?? "report";
if (cmd === "collect") collect(process.argv[3] ? process.argv[3].split(",") : null);
else if (cmd === "report") report();
else { console.error("usage: coverage-overlap.mjs collect|report"); process.exit(1); }
