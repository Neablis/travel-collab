import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SPEC_PATH, readSections, render, withoutIndex } from "../spec-section-index.mjs";

// KI-2026-09-14-c, gap 2. `SPEC.md` is ordered by date and never renumbered, so
// §18 begins before §17 and §21–§23 sit after §24. A reader who greps `§17` and
// reads forward from the first hit lands in a different section; that cost four
// review rounds on M20's operator console. The index at the top of the file is
// the fix, and these tests are what stop it rotting into a lie — an index that
// is merely present and wrong is worse than none, because it is believed.
const source = () => readFileSync(SPEC_PATH, "utf8");

/** The rows as the file actually carries them: §number, title, claimed line. */
function indexRows(text) {
  return [...text.matchAll(/^\| §(\d+) \| (.*?) \| (\d+) \|$/gm)].map((m) => ({
    number: Number(m[1]),
    title: m[2],
    line: Number(m[3]),
  }));
}

// The wall itself: whoever appended a section last must have regenerated.
test("the checked-in index is current with the headings", () => {
  const text = source();
  assert.equal(
    render(text),
    text,
    "SPEC.md's section index is stale — run `node scripts/spec-section-index.mjs --write`",
  );
});

// The claim the index actually makes, checked against the file rather than
// against the generator that wrote it: follow every line number and land on
// that section's heading. A generator bug and a test written from the same
// arithmetic would agree with each other and both be wrong.
test("every row's line number lands on that section's heading", () => {
  const text = source();
  const lines = text.split("\n");
  const rows = indexRows(text);
  assert.ok(rows.length > 0, "expected the index table to have rows");
  for (const row of rows) {
    const heading = lines[row.line - 1];
    assert.ok(heading !== undefined, `§${row.number} points at line ${row.line}, past the end of the file`);
    assert.match(
      heading,
      new RegExp(String.raw`^##\s+§?${row.number}\b`),
      `§${row.number} points at line ${row.line}, which is: ${heading}`,
    );
    assert.ok(
      heading.includes(row.title.split(" — ")[0]),
      `§${row.number}'s title in the index does not match the heading at line ${row.line}`,
    );
  }
});

// The other direction, and the one a "generate from the headings" script cannot
// fail on its own: no section may be missing from the table. §13 is the reason
// this is a separate assertion — it is the single heading written `## §13 — …`
// rather than `## 13. …`, so a tighter pattern would drop it silently and the
// test above would still pass on the 33 that remained.
test("every section heading in the file has a row, including the `## §13` form", () => {
  const text = source();
  const headings = readSections(withoutIndex(text));
  const rows = indexRows(text);
  assert.deepEqual(
    rows.map((r) => r.number).sort((a, b) => a - b),
    headings.map((h) => h.number).sort((a, b) => a - b),
  );
  assert.ok(
    headings.some((h) => h.number === 13),
    "expected §13 to be parsed — it is the one heading using the `## §n —` form",
  );
});

test("the table is in numeric order, which is the whole point of it", () => {
  const numbers = indexRows(source()).map((r) => r.number);
  assert.deepEqual(numbers, [...numbers].sort((a, b) => a - b));
  // Anti-vacuity: if the file were already sorted, the index would be a
  // restatement rather than a fix, and this whole mechanism would be dead
  // weight. It is not — the headings really do run out of order.
  const fileOrder = readSections(withoutIndex(source())).map((s) => s.number);
  assert.notDeepEqual(fileOrder, [...fileOrder].sort((a, b) => a - b));
});

// Writing twice must not differ from writing once. The first cut of this
// generator ate one of the two newlines after the end marker and grew a blank
// line per run, so `--write` immediately followed by the check failed.
test("rendering is idempotent", () => {
  const once = render(source());
  assert.equal(render(once), once);
});

// The red proof (CLAUDE.md rule 3). Append a section the way the design side
// does — at the end, out of numeric order — and the checked-in index must stop
// matching. A test that only ever sees a correct file proves nothing.
test("appending a section without regenerating is caught", () => {
  const stale = `${source()}\n## 99. A section the design appended and nobody indexed — 2026-09-19\n\nBody.\n`;
  assert.notEqual(render(stale), stale, "expected an un-indexed new section to make the index stale");
  const rebuilt = render(stale);
  assert.match(rebuilt, /^\| §99 \| A section the design appended and nobody indexed.*\| \d+ \|$/m);
  const line = Number(rebuilt.match(/^\| §99 \| .*\| (\d+) \|$/m)[1]);
  assert.match(rebuilt.split("\n")[line - 1], /^## 99\./);
});

// Two sections wearing one number would make the index ambiguous, and the
// generator would emit two rows that disagree. Fail loudly instead.
test("a duplicated section number is refused rather than indexed twice", () => {
  const clashing = `${source()}\n## 34. A second section numbered 34 — 2026-09-19\n\nBody.\n`;
  assert.throws(() => render(clashing), /two sections share a number: §34/);
});
