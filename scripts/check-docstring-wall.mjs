import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import ts from "typescript";
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
// ## Why this parses TypeScript instead of matching lines
//
// It did match lines, for exactly one review cycle. CodeRabbit caught the hole
// on PR #203 and it was worse than reported — this file passed clean:
//
//     const build = () => {};
//     export { build };
//
//     export const multiline = (
//       a: string,
//     ) => a;
//
//     export { helper };
//     function helper() {}
//
// Three undocumented exported functions, reported as *"0 exported
// functions/classes, 100.0% documented"*. A wall that returns green for a file
// it could not read is worse than no wall: it is the "a green run that proves
// nothing" failure this repo already refuses elsewhere, and it would have been
// invisible for exactly as long as nobody wrote an export list.
//
// Patching the regexes was the obvious answer and is the wrong one — each
// missed shape (a multi-line arrow, `export {}` across lines, `as` renames)
// costs another pattern and the next shape is always unlisted. `typescript` is
// already in this repo's toolchain, so the parser that decides what an export
// IS can be the same one `tsc` uses.
//
// ## What counts as an export here
//
// Exported **functions and classes**, reached however they are exported:
// `export function`, `export default function`, `export class`, an arrow or
// function expression bound to an exported `const`, and a local declaration
// named in an `export { … }` list (with or without `as`).
//
// Deliberately NOT types, interfaces, enums or plain value constants: the
// check this mirrors counts functions ("analyzed 9 functions across 7 files"),
// and a wall that demands a sentence above every exported Zod schema in
// `packages/contracts` would produce 267 sentences nobody asked for.
//
// Also NOT `export { x } from "./y"`. That re-exports someone else's symbol;
// the docstring belongs on the declaration, which this wall scans where it
// lives.
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
 * Whether an expression is a FUNCTION OR CLASS rather than a value.
 * `export const schema = z.object(…)` is a value and out of scope;
 * `export const f = () => …`, `export const f = function () {}` and
 * `export const Widget = class {}` are not.
 *
 * **The unwrapping loop is not defensive programming.** Each wrapper was
 * measured to bypass the wall: `export const memoized = (() => {}) as () =>
 * void` reported *"0 exported functions/classes, 100.0% documented"*, same as
 * `export const Widget = class {}` and `export default () => {}`. A type
 * assertion, a `satisfies`, a parenthesis or a `!` does not stop something
 * being a function, and a wall that a pair of brackets defeats is not a wall —
 * which is the whole argument this file's header makes about the regexes it
 * replaced. Found by CodeRabbit on PR #203, one round after the same class of
 * hole.
 */
function isFunctionValued(node) {
  while (
    node &&
    (ts.isParenthesizedExpression(node) ||
      ts.isAsExpression(node) ||
      ts.isSatisfiesExpression(node) ||
      ts.isTypeAssertionExpression(node) ||
      ts.isNonNullExpression(node))
  ) {
    node = node.expression;
  }
  if (!node) return false;
  return ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isClassExpression(node);
}

/**
 * True when `node` carries a JSDoc block.
 *
 * `ts.getJSDocCommentsAndTags` is the same lookup the language service uses
 * for hover text, which is the useful definition: it is attached if an editor
 * would show it at the call site. A `//` block above the symbol is not, and
 * that is the convention rather than an oversight — `//` is still the right
 * home for a decision, a citation or a war story, and it belongs ABOVE the
 * JSDoc. See docs/guidelines/commenting.md.
 *
 * **It handles the arrow case by itself, which is not obvious.** A block above
 * `export const f = () => …` is parsed onto the VariableStatement rather than
 * the declarator inside it, so this looked like it needed a second lookup on
 * the parent. It does not: TypeScript walks up for exactly this shape.
 * Measured before the fallback was deleted — with it removed, the repo's whole
 * 993-symbol scan is byte-identical, and a test written against it could not
 * be made to fail. An untestable branch is not a safeguard.
 */
function hasJsDoc(node) {
  return ts.getJSDocCommentsAndTags(node).length > 0;
}

/** True when `node` has the `export` modifier on itself. */
function isExported(node) {
  return (ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Export) !== 0;
}

/**
 * Every exported function or class in `source`, each flagged documented or
 * not.
 *
 * Two passes, because an `export { … }` list can name a declaration written
 * anywhere in the file — above it or below it. The first pass records every
 * top-level function and class declaration by name; the second decides which
 * of them are exported, directly or by list. Overload signatures collapse onto
 * one entry per name, keeping the documented half.
 */
export function scan(source, fileName = "scan.ts") {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    fileName.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  /** name -> { line, documented } for every top-level function/class. */
  const declared = new Map();
  /** Names that are exported, however they got there. */
  const exported = new Set();

  const record = (name, node) => {
    if (!name) return;
    const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
    const documented = hasJsDoc(node);
    const seen = declared.get(name);
    // An overload pair documents the group once; keep the documented half.
    if (!seen || (!seen.documented && documented)) declared.set(name, { line, documented });
  };

  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) {
      // `export default function () {}` is anonymous; name it for the report
      // rather than skipping it, because it is still an exported function.
      const name = statement.name?.text ?? (isExported(statement) ? "default" : undefined);
      record(name, statement);
      if (name && isExported(statement)) exported.add(name);
      continue;
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue;
        if (!isFunctionValued(declaration.initializer)) continue;
        // `hasJsDoc` finds a block written above the STATEMENT from here; see
        // its comment for why that needs no help.
        record(declaration.name.text, declaration);
        if (isExported(statement)) exported.add(declaration.name.text);
      }
      continue;
    }
    if (ts.isExportDeclaration(statement) && statement.exportClause) {
      // `export { x } from "./y"` re-exports someone else's symbol; the
      // docstring belongs on the declaration, wherever that file is.
      if (statement.moduleSpecifier) continue;
      if (!ts.isNamedExports(statement.exportClause)) continue;
      for (const element of statement.exportClause.elements) {
        // `export { build as make }` — `build` is the local declaration.
        exported.add((element.propertyName ?? element.name).text);
      }
      continue;
    }
    if (ts.isExportAssignment(statement)) {
      if (ts.isIdentifier(statement.expression)) {
        // `export default build`, where `build` is declared in this file.
        exported.add(statement.expression.text);
      } else if (isFunctionValued(statement.expression)) {
        // `export default () => {}` — anonymous, so it is reported as
        // `default`, the same name `export default function () {}` gets. It
        // is still an exported function and still needs a docstring.
        record("default", statement);
        exported.add("default");
      }
    }
  }

  const out = [];
  for (const [name, info] of declared) {
    if (!exported.has(name)) continue;
    out.push({ name, line: info.line, documented: info.documented });
  }
  return out;
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
  for (const symbol of scan(readFileSync(join(repoRoot, file), "utf8"), file)) {
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
