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
// WHAT IT READS, in `.ts`/`.tsx` under `apps/web/src`, outside tests:
//   - the class, `text-2xs`/`text-3xs`, in any string literal or template text;
//   - the token's custom property, `--text-2xs`/`--text-3xs`, however it is
//     read (`var(--text-2xs)`, Tailwind's `text-(length:--text-2xs)`);
//   - an inline font size under 12px: a `fontSize` property or attribute set
//     to `"Npx"` or a bare number (PR 633 review found `Preview`'s 10px chip
//     and `MapLegend`'s 11px text that way, both since moved to `text-xs`).
// A comment naming the token is prose, not a use, so the source is parsed
// rather than grepped. `globals.css` is not read: its `var(--text-2xs)` rules
// for the notebook's widget tables are named in the KI's resolution as still
// under the floor.
//
// WHERE THE SIZES ARE ALLOWED. The front door: `app/(front)/**` and
// `components/front/**`, plus the invite landing, which a signed-out guest
// reaches from a link and which is drawn as front door (listed by file, so a
// new screen under `components/access/` is not exempt by where it sits).
const FRONT_DOOR = ["app/(front)/", "components/front/"];
const ALSO_FRONT_DOOR = new Set([
  "components/access/InviteLandingScreen.tsx",
  "components/access/InvitePlanCard.tsx",
  "components/access/InviteLookScreen.tsx",
]);
// `DiscoverCard` is drawn by the front door's sea as well as by Discover, and
// the sea's screenshots (`m42-demo-trips.spec.ts`) pin its micro sizes. Only
// the sea's branch may use them: a literal under `sea !== null ? … : …`'s true
// side, or right of `sea !== null && …`. Anywhere else in the file fails.
const SEA_BRANCH = { file: "components/playbooks/DiscoverCard.tsx", condition: "sea !== null" };
// Inline sizes under the floor that predate the wall (counted 2026-10-29: 15
// in these seven files), named so the list can only shrink. Each draws a
// design handoff's 10-11.5px label as an inline style, each with its own
// eslint-disable citing `dc.html`, on tight surfaces (the map's rail and strip,
// the day chips, the calendar's cells, the rack) where 12px needs a layout
// walk this wall did not do (KI-2026-10-29-a). Their classes are still checked here; a new
// inline size anywhere else fails, and so does one more in a listed file: each
// is allowed only the count it had. Lowering a count, or taking a file off the
// list, is the fix.
const GRANDFATHERED_INLINE = new Map([
  ["components/AccountMenu.tsx", 1],
  ["components/lenses/CalendarLens.tsx", 4],
  ["components/lenses/MapDayStrip.tsx", 1],
  ["components/lenses/MapLens.tsx", 1],
  ["components/lenses/MapRail.tsx", 4],
  ["components/trip/DayChips.tsx", 2],
  ["components/trip/UnscheduledRack.tsx", 2],
]);

const CLASS = /(?<![\w-])text-(2xs|3xs)(?![\w-])/g;
const PROPERTY = /--text-(2xs|3xs)(?![\w-])/g;
const FLOOR_PX = 12;

/** Is `node` on the true side of a `<condition> ? … : …` or right of `<condition> && …`? */
function underCondition(node, condition, file) {
  for (let child = node, parent = node.parent; parent !== undefined; child = parent, parent = parent.parent) {
    if (ts.isConditionalExpression(parent) && parent.whenTrue === child && parent.condition.getText(file) === condition) {
      return true;
    }
    if (
      ts.isBinaryExpression(parent) &&
      parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken &&
      parent.right === child &&
      parent.left.getText(file) === condition
    ) {
      return true;
    }
  }
  return false;
}

/** The px an inline `fontSize` value sets, when it is a literal: `"10px"` or `10`. */
function inlinePx(value) {
  if (value === undefined) return null;
  if (ts.isJsxExpression(value)) return inlinePx(value.expression);
  if (ts.isNumericLiteral(value)) return Number(value.text);
  if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) {
    const match = /^\s*(\d+(?:\.\d+)?)px\s*$/.exec(value.text);
    return match === null ? null : Number(match[1]);
  }
  return null;
}

/** Every size under the floor in `source`, with its line, for the file at `where`. */
function scan(fileName, where, source) {
  const kind = fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, kind);
  const seaOnly = where === SEA_BRANCH.file;
  const inlineAllowed = GRANDFATHERED_INLINE.get(where) ?? 0;
  const hits = [];
  const inline = [];
  const lineOf = (node) => file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
  const visit = (node) => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      const exempt = seaOnly && underCondition(node, SEA_BRANCH.condition, file);
      if (!exempt) {
        for (const match of node.text.matchAll(CLASS)) hits.push({ line: lineOf(node), token: match[0] });
        for (const match of node.text.matchAll(PROPERTY)) hits.push({ line: lineOf(node), token: match[0] });
      }
    }
    const named = (ts.isPropertyAssignment(node) || ts.isJsxAttribute(node)) && node.name.getText(file).replace(/["']/g, "") === "fontSize";
    if (named) {
      const px = inlinePx(node.initializer);
      if (px !== null && px < FLOOR_PX) inline.push({ line: lineOf(node), token: `fontSize ${px}px` });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  // A grandfathered file passes while it holds no more inline sizes than its
  // count; one more names them all, since the new one cannot be told apart.
  if (inline.length > inlineAllowed) {
    const over = inlineAllowed > 0 ? ` (${inline.length} here, ${inlineAllowed} grandfathered)` : "";
    hits.push(...inline.map((hit) => ({ ...hit, token: hit.token + over })));
  }
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
  for (const hit of scan(file, where, readFileSync(file, "utf8"))) {
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
