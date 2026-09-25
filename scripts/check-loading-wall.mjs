import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

// THE LOADING WALL: no component renders the bare word `Loading…`.
//
// KI-2026-09-20-e. Mitchell saw it flicker on opening a trip, the trip board's
// was removed, and then it was seen again on Overview → Edit Overview, from a
// different component. His ask, on the PR #221 preview: *"confirm we arent
// doing the 'Loading...' text anymore."* A grep done once confirms it once;
// this is the grep, run on every lint.
//
// The rule, on Mitchell's call: *"dont even have the loading state. KEep it
// simple."* A surface whose data is not here yet renders its real chrome, or
// nothing — never a word standing in for it. Where a shaped placeholder is
// warranted, `ui/skeleton.tsx` has one.
//
// What counts is text a person SEES: a JSX text node, or a string literal that
// is not an attribute's value, reading `Loading` and ending in an ellipsis
// (`Loading…`, `Loading your trips...`). Attribute values are allowed, because
// `SkeletonRegion`'s `label="Loading notebooks"` is a screen reader's name for
// a placeholder, which is exactly what should say it. Comments are not in the
// syntax tree at all, and tests are not scanned. No allowlist: a real need to
// print the word is a conversation, not a marker.
const WORD = /^\s*Loading\b[\s\S]*(…|\.\.\.)\s*$/;

/** Is `node` an attribute's value — `label="…"` or `label={"…"}`? */
function isAttributeValue(node) {
  let parent = node.parent;
  // Through `{ … }` and any parentheses/conditionals inside it, up to the
  // attribute that owns them.
  while (
    parent !== undefined &&
    (ts.isJsxExpression(parent) || ts.isParenthesizedExpression(parent) || ts.isConditionalExpression(parent))
  ) {
    if (ts.isJsxExpression(parent)) return parent.parent !== undefined && ts.isJsxAttribute(parent.parent);
    parent = parent.parent;
  }
  return parent !== undefined && ts.isJsxAttribute(parent);
}

function scan(fileName, source) {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const hits = [];
  const visit = (node) => {
    let text = null;
    if (ts.isJsxText(node)) text = node.text;
    else if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && !isAttributeValue(node)) {
      text = node.text;
    }
    if (text !== null && WORD.test(text)) {
      // A JSX text node starts right after the opening tag, newline and all,
      // so point at the word itself rather than at the line of the tag.
      const lead = ts.isJsxText(node) ? text.length - text.trimStart().length : 0;
      const { line } = file.getLineAndCharacterOfPosition(node.getStart(file) + lead);
      hits.push({ line: line + 1, text: text.trim() });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return hits;
}

function componentFilesUnder(dir) {
  const out = [];
  for (const entry of readdirSync(dir).sort()) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...componentFilesUnder(path));
    else if (entry.endsWith(".tsx") && !/\.test\.tsx$/.test(entry)) out.push(path);
  }
  return out;
}

// A directory walk, not `git ls-files`, so a brand-new untracked component is
// scanned too (the sleep wall's reasoning). The directory is an argument so
// the wall's own test can point it at a fixture.
const dir = process.argv[2] ?? "apps/web/src";
const files = componentFilesUnder(dir);

let violations = 0;
for (const file of files) {
  for (const hit of scan(file, readFileSync(file, "utf8"))) {
    console.error(`${file}:${hit.line}: renders "${hit.text}"`);
    violations += 1;
  }
}

if (violations > 0) {
  console.error(
    `\nLOADING WALL BREACHED: ${violations} bare loading string(s) in ${dir}.\n` +
      "A surface whose data is not here yet renders its real chrome, or nothing\n" +
      "(KI-2026-09-20-e). If it genuinely needs a placeholder, use the shaped\n" +
      "ones in apps/web/src/components/ui/skeleton.tsx — their screen-reader\n" +
      'label (label="Loading …") is an attribute and is allowed.',
  );
  process.exit(1);
}

console.log(`loading wall OK (${files.length} files scanned)`);
