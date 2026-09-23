import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

// THE DOCSTRING WALL: every exported function or class carries JSDoc, and the
// backlog of ones that do not can only shrink.
//
// ## Why this exists rather than a percentage
//
// CodeRabbit runs a **Docstring Coverage** pre-merge check against an 80%
// floor, measured on the functions a PR changes. This repo failed it on three
// consecutive PRs — 66.67% (#198, 9 functions), 51.39% (#199, 72), 41.18%
// (#201) — not because those functions were unexplained but because their
// explanations sit in `//` blocks above the symbol rather than in `/** */`
// attached to it. KI-2026-09-20-i laid out three honest answers and Mitchell
// picked one on 2026-09-22: **yes, JSDoc is the convention, and the 80% floor
// is worth having.** KI-2026-09-22-a is the work; this is the half of it that
// is a mechanism.
//
// The reason it is a wall and not left to the percentage is the line that
// KI-2026-09-20-i itself used as the objection: *"the wall this repo actually
// enforces is `check-lint-wall.mjs`, not a coverage figure."* A number on a PR
// page is advice. This fails `pnpm lint`.
//
// ## Why a baseline, and why it can only shrink
//
// 475 exported functions and classes predate the decision (52.4% documented,
// measured 2026-09-23). Rewriting them in the commit that adds the wall would
// be a 475-file change hiding inside a config change, and KI-2026-09-22-a
// rules it out in writing: *"not a request to convert everything at once …
// the prose is already written in every one of these files; what is wrong is
// its shape."*
//
// So they are grandfathered in `docstring-wall-baseline.json`, and the wall
// fails in BOTH directions:
//
//   - an undocumented export that is NOT in the baseline is a new violation;
//   - a baseline entry whose symbol is now documented, renamed or deleted is
//     ALSO a failure, with the instruction to remove the entry.
//
// The second half is the important one and it is borrowed from a mechanism
// this repo already trusts: `eslint.config.mjs` sets
// `reportUnusedDisableDirectives: "error"` so the test-quality backlog
// (KI-2026-09-02-b) cannot be silently re-grown. A baseline nobody is forced
// to prune is a backlog that only grows.
//
// ## What counts as an export here
//
// Exported **functions and classes**, including `export const f = () => …`.
// Deliberately NOT types, interfaces, enums or plain value constants: the
// check this mirrors counts functions ("analyzed 9 functions across 7 files"),
// and a wall that demands a sentence above every exported Zod schema in
// `packages/contracts` would produce 267 sentences nobody asked for. Widening
// the wall later is a one-line change to EXPORT_PATTERNS; starting wide would
// have meant grandfathering 1180 symbols instead of 475.
//
// Tests are out of scope. `*.test.ts(x)` and `*.spec.ts(x)` export almost
// nothing, and KI-2026-09-20-i's surviving objection is specifically about
// e2e helpers: converting them *"for a number rather than for a reader"* would
// make those files internally inconsistent.
//
// ## Usage
//
//   node scripts/check-docstring-wall.mjs                 # check (pnpm lint)
//   node scripts/check-docstring-wall.mjs --update-baseline
//   node scripts/check-docstring-wall.mjs <dir>           # scan one tree
//
// `--update-baseline` exists for the commit that landed the wall and for a
// deliberate re-baseline. It is not a way past a failure: regenerating it to
// silence a new violation shows up in the diff as an ADDED baseline line,
// which is exactly the review signal a line-level `eslint-disable` gives.

/** Trees the wall scans by default: application and package source only. */
const DEFAULT_ROOTS = ["apps/web/src", "packages"];

/** Anything generated, installed, or built — never hand-written, never ours. */
const SKIP_DIR = /(^|\/)(node_modules|\.next|drizzle|dist|build|coverage|\.turbo)(\/|$)/;

// Only `src` inside a package: a package's own `test` directory holds test
// helpers, which are out of scope for the same reason `*.test.ts` is.
const PACKAGE_SOURCE = /^packages\/[^/]+\/src(\/|$)/;

/** A TypeScript source file that is not a test and not a declaration file. */
function isScannable(path) {
  return /\.tsx?$/.test(path) && !/\.(test|spec)\.tsx?$/.test(path) && !/\.d\.ts$/.test(path);
}

/**
 * The three shapes an exported function or class is written in here. Each
 * captures the symbol's name, which is what the baseline keys on — a line
 * number would be invalidated by every edit above it, and a backlog that
 * churns on unrelated diffs is one people stop reading.
 */
const EXPORT_PATTERNS = [
  /^export\s+(?:default\s+)?(?:async\s+)?function\s*\*?\s+([A-Za-z_$][\w$]*)/,
  /^export\s+(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/,
  /^export\s+(?:const|let)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?::[^=]*?)?=>/,
];

/**
 * True when the nearest non-blank line above `index` closes a JSDoc block —
 * i.e. the documentation is attached to the symbol rather than merely nearby.
 *
 * A `//` block above the symbol deliberately does NOT count, and that is the
 * whole point of the convention rather than an oversight: `//` is still the
 * right home for a decision, a citation or a war story, and it belongs ABOVE
 * the JSDoc. See docs/guidelines/commenting.md.
 */
function hasJsDocAbove(lines, index) {
  let i = index - 1;
  while (i >= 0 && lines[i].trim() === "") i -= 1;
  if (i < 0 || !lines[i].trim().endsWith("*/")) return false;
  // Walk back to the opening delimiter: `/**` is JSDoc, a bare `/*` is not.
  for (let j = i; j >= 0; j -= 1) {
    if (lines[j].includes("/**")) return true;
    if (lines[j].includes("/*")) return false;
  }
  return false;
}

/**
 * Every exported function or class in `source`, each flagged documented or
 * not. Overload signatures collapse onto the implementation's name, so a
 * symbol is reported once however many times it is declared.
 */
export function scan(source) {
  const lines = source.split("\n");
  const byName = new Map();
  lines.forEach((line, i) => {
    for (const pattern of EXPORT_PATTERNS) {
      const match = pattern.exec(line);
      if (!match) continue;
      const name = match[1];
      const documented = hasJsDocAbove(lines, i);
      // An overload pair documents the group once; keep the documented half.
      const seen = byName.get(name);
      if (!seen || (!seen.documented && documented)) {
        byName.set(name, { name, line: i + 1, documented });
      }
      return;
    }
  });
  return [...byName.values()];
}

/** Every scannable source file under `dir`, depth-first and sorted. */
function sourceFilesUnder(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir).sort();
  } catch {
    return out;
  }
  for (const entry of entries) {
    const path = join(dir, entry);
    if (SKIP_DIR.test(path)) continue;
    if (statSync(path).isDirectory()) out.push(...sourceFilesUnder(path));
    else if (isScannable(path)) out.push(path);
  }
  return out;
}

const repoRoot = process.cwd();
const explicitDir = process.argv.find((a) => !a.startsWith("-") && a !== process.argv[0] && a !== process.argv[1]);
const updating = process.argv.includes("--update-baseline");
const roots = explicitDir ? [explicitDir] : DEFAULT_ROOTS;
const BASELINE = join(repoRoot, "scripts", "docstring-wall-baseline.json");

const files = roots
  .flatMap((root) => sourceFilesUnder(join(repoRoot, root)))
  .map((p) => relative(repoRoot, p))
  .filter((p) => !p.startsWith("packages/") || PACKAGE_SOURCE.test(p));

let total = 0;
let documented = 0;
/** `path::symbol` for every export currently missing JSDoc. */
const undocumented = new Map();
for (const file of files) {
  for (const symbol of scan(readFileSync(join(repoRoot, file), "utf8"))) {
    total += 1;
    if (symbol.documented) documented += 1;
    else undocumented.set(`${file}::${symbol.name}`, symbol.line);
  }
}

const coverage = total === 0 ? 100 : (documented / total) * 100;

if (updating) {
  writeFileSync(BASELINE, `${JSON.stringify([...undocumented.keys()].sort(), null, 2)}\n`);
  console.log(
    `docstring wall baseline rewritten: ${undocumented.size} grandfathered ` +
      `export(s), ${coverage.toFixed(1)}% documented across ${files.length} files.`,
  );
  process.exit(0);
}

const baseline = existsSync(BASELINE) ? new Set(JSON.parse(readFileSync(BASELINE, "utf8"))) : new Set();

const added = [...undocumented.keys()].filter((key) => !baseline.has(key)).sort();
const stale = [...baseline].filter((key) => !undocumented.has(key)).sort();

if (added.length > 0) {
  for (const key of added) {
    const [file, name] = key.split("::");
    console.error(`${file}:${undocumented.get(key)}: ${name} is exported without JSDoc`);
  }
  console.error(
    `\nDOCSTRING WALL BREACHED: ${added.length} exported function(s) or class(es) ` +
      "without JSDoc.\nJSDoc is this repo's convention as of 2026-09-22 " +
      "(KI-2026-09-22-a) — one `/** … */` block\nattached to the symbol, saying " +
      "what it returns and what it is for. A `//` block above\nthe symbol is " +
      "still right for a decision, a citation or a war story; put it ABOVE the\n" +
      "JSDoc rather than instead of it. See docs/guidelines/commenting.md.",
  );
}

if (stale.length > 0) {
  for (const key of stale) console.error(`${key}: baseline entry is stale — delete this line`);
  console.error(
    `\nDOCSTRING BASELINE IS STALE: ${stale.length} entr(y/ies) in ` +
      "scripts/docstring-wall-baseline.json\nno longer match an undocumented " +
      "export — the symbol was documented, renamed or removed.\nDelete them. " +
      "The backlog is allowed to shrink and nothing else, which is the only\n" +
      "reason a grandfathered wall stays honest (same mechanism as ESLint's\n" +
      "reportUnusedDisableDirectives, which holds KI-2026-09-02-b's backlog down).",
  );
}

if (added.length > 0 || stale.length > 0) process.exit(1);

console.log(
  `docstring wall OK (${files.length} files, ${total} exported functions/classes, ` +
    `${coverage.toFixed(1)}% documented, ${baseline.size} grandfathered)`,
);
