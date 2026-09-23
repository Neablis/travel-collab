import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// KI-2026-09-14-c, gap 2: `SPEC.md` IS ORDERED BY DATE, NOT BY SECTION NUMBER,
// and that is on purpose — the design side appends a new section each pass and
// never renumbers, so history reads in order. The cost lands on the reader:
// §18 begins at line 184 and §17 at line 744, so someone who greps `§17` and
// reads forward from the first hit lands in the middle of a different section,
// and someone who assumes the file is sorted gives up on a section that is
// present. That cost was paid building M20's operator console.
//
// The fix is not to sort the file. It is to put a numerically-ordered index at
// the top, and to keep it true mechanically rather than by discipline —
// `scripts/__tests__/spec-section-index.test.mjs` fails when the index and the
// headings disagree, and this script with `--write` is how you fix it.
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const SPEC_PATH = join(REPO_ROOT, ".design-sync", "handoff", "SPEC.md");

const START = "<!-- SPEC-INDEX:START -->";
const END = "<!-- SPEC-INDEX:END -->";

// Two heading shapes are in the file and both are load-bearing: `## 17. Billing
// surfaces — …` is the common one, and `## §13 — Mobile foundations` is the
// single section that wrote its own number with the section mark. Accepting
// only the first would silently drop §13 from the index, which is worse than
// not having an index at all.
const HEADING = /^##\s+§?(\d+)\s*(?:\.|—|-|:)?\s*(.*)$/;

/** Strip the generated block, so parsing always runs against the authored file. */
export function withoutIndex(source) {
  const start = source.indexOf(START);
  if (start === -1) return source;
  const end = source.indexOf(END);
  if (end === -1) throw new Error(`${SPEC_PATH}: found ${START} with no matching ${END}`);
  const after = end + END.length;
  // The block is written with a blank line on each side of it, and the text
  // before START already carries the leading one — so BOTH newlines after END
  // belong to the block. Eating only one grows a blank line per run, which
  // makes `--write` non-idempotent and the check fail straight after a write.
  const trailing = source.slice(after).startsWith("\n\n") ? after + 2 : after;
  return source.slice(0, start) + source.slice(trailing);
}

export function readSections(bodySource) {
  const sections = [];
  bodySource.split("\n").forEach((line, i) => {
    const m = line.match(HEADING);
    if (m === null) return;
    sections.push({ number: Number(m[1]), title: m[2].trim(), lineInBody: i + 1 });
  });
  return sections;
}

export function buildIndex(bodySource) {
  const sections = readSections(bodySource);
  if (sections.length === 0) throw new Error(`${SPEC_PATH}: no \`## <n>.\` section headings found`);

  const duplicates = sections
    .map((s) => s.number)
    .filter((n, i, all) => all.indexOf(n) !== i);
  if (duplicates.length > 0) {
    throw new Error(`${SPEC_PATH}: two sections share a number: §${[...new Set(duplicates)].join(", §")}`);
  }

  const head = [
    START,
    "",
    "## Sections, by number",
    "",
    "**Generated — do not edit by hand.** Run `node scripts/spec-section-index.mjs --write`",
    "after adding a section; `pnpm test` fails when this table and the headings disagree.",
    "",
    "This file is append-by-date and is never renumbered, so the sections below are **not**",
    "in file order — §17 sits after §18, and §21–§23 after §24. Jump by the line number here",
    "rather than grepping for `§n` and reading forward (KI-2026-09-14-c).",
    "",
    "| § | Section | Line |",
    "|---|---|---|",
  ];
  const foot = ["", END, ""];
  // The rows carry line numbers of the FINAL file, and inserting this block is
  // what moves them. The block's height does not depend on those numbers —
  // only on how many sections there are — so the offset is known before the
  // rows are rendered and needs no second pass.
  const offset = head.length + sections.length + foot.length;

  const rows = [...sections]
    .sort((a, b) => a.number - b.number)
    .map((s) => `| §${s.number} | ${s.title} | ${s.lineInBody + offset} |`);

  return [...head, ...rows, ...foot];
}

export function render(source) {
  const body = withoutIndex(source);
  const bodyLines = body.split("\n");
  const firstHeading = bodyLines.findIndex((line) => HEADING.test(line));
  const block = buildIndex(body);
  return [...bodyLines.slice(0, firstHeading), ...block, ...bodyLines.slice(firstHeading)].join("\n");
}

// Run the CLI only when invoked directly. The test imports `render` and
// friends, and a looser guard (matching on the filename) runs the whole check
// as a side effect of that import.
const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
if (invokedDirectly) {
  const source = readFileSync(SPEC_PATH, "utf8");
  const next = render(source);
  if (process.argv.includes("--write")) {
    if (next === source) {
      console.log("SPEC.md section index already current");
    } else {
      writeFileSync(SPEC_PATH, next);
      console.log(`SPEC.md section index written (${readSections(withoutIndex(source)).length} sections)`);
    }
  } else if (next !== source) {
    console.error(
      "SPEC.md's section index is out of date with its headings — run `node scripts/spec-section-index.mjs --write`",
    );
    process.exit(1);
  } else {
    console.log(`SPEC.md section index OK (${readSections(withoutIndex(source)).length} sections)`);
  }
}
