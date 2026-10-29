import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";

// THE TYPE FLOOR WALL (design-system.md, type scale; KI-2026-10-05-i): 12px is
// the floor for anything a user reads rather than glances at, and the two
// sizes under it, `text-2xs` (11px) and `text-3xs` (9.5px), are the front
// door's alone, for the micro-labels in its illustrations.
//
// WHY A WALL. The rule was written down and nothing checked it, so each use
// copied a nearby one: by 2026-10-05 there were 33 `text-2xs` in signed-in
// screens, and by the sweep that removed them (2026-10-29) 37. The colour
// wall's token half knows a size exists, not where it may be used.
//
// WHAT IT READS. String literals and template text in `.ts`/`.tsx` under
// `apps/web/src`, outside tests: where a class name lives. A comment naming
// the token is prose, not a use, so the source is parsed rather than grepped.
// `globals.css` is not read: its `var(--text-2xs)` rules are named in the
// KI's resolution, and a size there is a design decision, not a copied class.
//
// WHERE THE SIZES ARE ALLOWED. The front door: `app/(front)/**` and
// `components/front/**`, plus the invite landing, which a signed-out guest
// reaches from a link and which is drawn as front door (listed by file, so a
// new screen under `components/access/` is not exempt by where it sits).
// And `DiscoverCard`, which the front door's sea draws as well as Discover: its
// sizes under the floor are on the sea's branch only (`sea !== null`), which
// its screenshots in `m42-demo-trips.spec.ts` pin.
const FRONT_DOOR = ["app/(front)/", "components/front/"];
const ALSO_FRONT_DOOR = new Set([
  "components/access/InviteLandingScreen.tsx",
  "components/access/InvitePlanCard.tsx",
  "components/access/InviteLookScreen.tsx",
  "components/playbooks/DiscoverCard.tsx",
]);
const UNDER_THE_FLOOR = /(?<![\w-])text-(2xs|3xs)(?![\w-])/g;

/** Every `text-2xs`/`text-3xs` in `source`'s string literals, with its line. */
function scan(fileName, source) {
  const kind = fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, kind);
  const hits = [];
  const visit = (node) => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      for (const match of node.text.matchAll(UNDER_THE_FLOOR)) {
        const { line } = file.getLineAndCharacterOfPosition(node.getStart(file));
        hits.push({ line: line + 1, token: match[0] });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return hits;
}

function sourceFilesUnder(dir) {
  const out = [];
  for (const entry of readdirSync(dir).sort()) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...sourceFilesUnder(path));
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(path);
  }
  return out;
}

const dir = process.argv[2] ?? "apps/web/src";
const files = sourceFilesUnder(dir);

let violations = 0;
for (const file of files) {
  const where = relative(dir, file).split(sep).join("/");
  if (FRONT_DOOR.some((prefix) => where.startsWith(prefix)) || ALSO_FRONT_DOOR.has(where)) continue;
  for (const hit of scan(file, readFileSync(file, "utf8"))) {
    console.error(`${file}:${hit.line}: ${hit.token}`);
    violations += 1;
  }
}

if (violations > 0) {
  console.error(
    `\nTYPE FLOOR WALL BREACHED: ${violations} use(s) of a size under 12px outside the front door.\n` +
      "`text-2xs` and `text-3xs` are the front door's alone; 12px (`text-xs`) is the\n" +
      "floor for anything a user reads (design-system.md, type scale; KI-2026-10-05-i).\n" +
      "Use `text-xs`, or a primitive that carries it (`Badge`, `DataText size=\"xs\"`).",
  );
  process.exit(1);
}

console.log(`type floor wall OK (${files.length} files scanned)`);
