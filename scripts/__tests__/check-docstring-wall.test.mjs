import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const WALL = join(dirname(fileURLToPath(import.meta.url)), "..", "check-docstring-wall.mjs");

/**
 * Writes `files` into a fresh temp repo, seeds
 * `scripts/docstring-wall-baseline.json` with `baseline`, and runs the wall
 * over `src/`.
 *
 * The wall reads its baseline relative to `process.cwd()`, so the temp
 * directory has to look like a repo root rather than a bare source tree —
 * which is also the only way to exercise the stale-entry half at all.
 */
function runWall(files, baseline = []) {
  const dir = mkdtempSync(join(tmpdir(), "tc-docstring-wall-"));
  mkdirSync(join(dir, "scripts"), { recursive: true });
  writeFileSync(join(dir, "scripts", "docstring-wall-baseline.json"), JSON.stringify(baseline));
  for (const [name, source] of Object.entries(files)) {
    const path = join(dir, "src", name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, source);
  }
  const result = spawnSync(process.execPath, [WALL, "src"], { cwd: dir, encoding: "utf8" });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

// The exact shape the wall exists to catch, and the reason the decision was
// hard: this function is NOT unexplained. It carries three lines of real
// reasoning — in `//` above the symbol, which is the convention most of this
// repo was written to and which CodeRabbit's Docstring Coverage check scores
// as zero. KI-2026-09-20-i is the argument; 2026-09-22 is the answer.
const PROSE_IN_SLASHES = `// Chooses the model for this call. Deliberately NOT the cheapest one: M20
// measured the cheap tier re-asking for the same tool twice, which cost more
// than the tier it was avoiding.
export function selectAiModel(kind: string): string {
  return kind;
}
`;

const SAME_PROSE_AS_JSDOC = `/**
 * Chooses the model for this call.
 *
 * Deliberately NOT the cheapest one: M20 measured the cheap tier re-asking
 * for the same tool twice, which cost more than the tier it was avoiding.
 */
export function selectAiModel(kind: string): string {
  return kind;
}
`;

test("fails on an export whose reasoning is in `//` above the symbol", () => {
  const { status, stderr } = runWall({ "modelSelection.ts": PROSE_IN_SLASHES });
  assert.equal(status, 1);
  assert.match(stderr, /modelSelection\.ts:4: selectAiModel is exported without JSDoc/);
  assert.match(stderr, /DOCSTRING WALL BREACHED: 1 exported/);
});

test("passes once the same prose is attached as JSDoc", () => {
  const { status, stdout } = runWall({ "modelSelection.ts": SAME_PROSE_AS_JSDOC });
  assert.equal(status, 0);
  assert.match(stdout, /100\.0% documented/);
});

test("a grandfathered export passes, and only while it stays undocumented", () => {
  const baseline = ["src/modelSelection.ts::selectAiModel"];
  const grandfathered = runWall({ "modelSelection.ts": PROSE_IN_SLASHES }, baseline);
  assert.equal(grandfathered.status, 0);
  assert.match(grandfathered.stdout, /1 grandfathered/);

  // The half that makes the backlog one-way: documenting the symbol without
  // pruning the baseline is a failure, not a silent no-op. Without this the
  // file fills up and stops being read — the failure mode KI-2026-09-02-b's
  // backlog avoids only because `reportUnusedDisableDirectives` is an error.
  const fixed = runWall({ "modelSelection.ts": SAME_PROSE_AS_JSDOC }, baseline);
  assert.equal(fixed.status, 1);
  assert.match(fixed.stderr, /src\/modelSelection\.ts::selectAiModel: baseline entry is stale/);
  assert.match(fixed.stderr, /DOCSTRING BASELINE IS STALE: 1 entr/);
});

test("counts arrow-function and class exports, and ignores types and re-exports", () => {
  const { status, stderr } = runWall({
    "shapes.ts": `export type TripId = string;
export interface Trip { id: TripId }
export { selectAiModel } from "./modelSelection";
export const dayKey = (n: number) => \`day-\${n}\`;
export class ConflictEngine {}
`,
  });
  assert.equal(status, 1);
  // Exactly two: the arrow function and the class. A type, an interface and a
  // re-export are not functions, and the check this wall mirrors counts
  // functions — see the header for why widening it was rejected.
  assert.match(stderr, /shapes\.ts:4: dayKey is exported without JSDoc/);
  assert.match(stderr, /shapes\.ts:5: ConflictEngine is exported without JSDoc/);
  assert.match(stderr, /BREACHED: 2 exported/);
});

test("a `//` war story ABOVE the JSDoc still counts as documented", () => {
  // The convention allows both on one symbol, and this is the ordering it
  // prescribes — so the wall has to accept it or the guideline is a lie.
  const { status, stdout } = runWall({
    "geo.ts": `// ADR-041: coordinates come from the importer's geocoder, never from the
// model — KI-15 is what happens when they do not.
/** Distance in kilometres between two located stops. */
export function distanceKm(a: number, b: number): number {
  return Math.abs(a - b);
}
`,
  });
  assert.equal(status, 0);
  assert.match(stdout, /100\.0% documented/);
});

// THE SHAPES THAT GOT PAST THE REGEX SCANNER, kept as a group because they
// are one defect: the wall reported this exact file as "0 exported
// functions/classes, 100.0% documented" while it held three undocumented
// exported functions. CodeRabbit found the first on PR #203; probing it found
// the other two. A wall returning green for a file it cannot read is the
// failure mode the whole mechanism exists to prevent, so each shape gets a
// case rather than a shared one.
const BYPASSED_THE_REGEXES = `const build = () => {};
export { build };

export const multiline = (
  a: string,
) => a;

export {
  helper,
};
function helper() {}
`;

test("catches the three shapes the regex scanner reported as 100% documented", () => {
  const { status, stderr } = runWall({ "bypass.ts": BYPASSED_THE_REGEXES });
  assert.equal(status, 1);
  // A local declaration exported through a list, the list written inline...
  assert.match(stderr, /bypass\.ts:1: build is exported without JSDoc/);
  // ...and across lines, naming a function declared AFTER it.
  assert.match(stderr, /bypass\.ts:11: helper is exported without JSDoc/);
  // And a plainly-exported arrow whose `=\>` is not on the declaration line.
  assert.match(stderr, /bypass\.ts:4: multiline is exported without JSDoc/);
  assert.match(stderr, /BREACHED: 3 exported/);
});

test("an `export { local as renamed }` is the LOCAL declaration's docstring", () => {
  // The exported name is `renamed`; the thing that needs the docstring is
  // `build`, and that is what the report has to name or nobody can find it.
  const { status, stderr } = runWall({
    "renamed.ts": "const build = () => {};\nexport { build as make };\n",
  });
  assert.equal(status, 1);
  assert.match(stderr, /renamed\.ts:1: build is exported without JSDoc/);
});

test("a re-export from another module is not this file's to document", () => {
  // `export { x } from "./y"` does not declare anything here. The docstring
  // belongs on y's declaration, which the wall scans where it lives — counting
  // it twice would make one missing docstring two failures in two files.
  const { status, stdout } = runWall({
    "barrel.ts": 'export { selectAiModel } from "./modelSelection";\n',
  });
  assert.equal(status, 0);
  assert.match(stdout, /0 exported functions\/classes/);
});

test("JSDoc above an exported arrow counts, though it sits on the statement", () => {
  // The parser hangs a block above `export const f = …` on the
  // VariableStatement rather than on the declarator inside it. Getting this
  // wrong would fail every documented arrow function in the repo.
  const { status, stdout } = runWall({
    "arrow.ts": "/** The day's key. */\nexport const dayKey = (n: number) => `day-${n}`;\n",
  });
  assert.equal(status, 0);
  assert.match(stdout, /100\.0% documented/);
});

// THE SECOND ROUND OF BYPASSES, found by CodeRabbit one round after the
// export-list ones and measured the same way: each of these reported
// "0 exported functions/classes, 100.0% documented" before the fix. Grouped
// because they are one defect — a function is still a function behind a
// wrapper, and a wall a pair of brackets defeats is not a wall.
test("counts a function behind a type assertion, a `satisfies` or parentheses", () => {
  const { status, stderr } = runWall({
    "wrapped.ts": `export const asserted = (() => {}) as () => void;
export const parenthesised = (function () {});
export const bang = (() => {})!;
`,
  });
  assert.equal(status, 1);
  assert.match(stderr, /wrapped\.ts:1: asserted is exported without JSDoc/);
  assert.match(stderr, /wrapped\.ts:2: parenthesised is exported without JSDoc/);
  assert.match(stderr, /wrapped\.ts:3: bang is exported without JSDoc/);
});

test("counts a class expression bound to an exported const", () => {
  const { status, stderr } = runWall({
    "klass.ts": "export const Widget = class {\n  render() {}\n};\n",
  });
  assert.equal(status, 1);
  assert.match(stderr, /klass\.ts:1: Widget is exported without JSDoc/);
});

test("counts an anonymous `export default` arrow, naming it `default`", () => {
  // `export default function () {}` was already counted as `default`; the
  // arrow form was not, though it is the same export with the same need.
  const { status, stderr } = runWall({ "anon.ts": "export default () => {};\n" });
  assert.equal(status, 1);
  assert.match(stderr, /anon\.ts:1: default is exported without JSDoc/);
});

test("a wrapped VALUE is still not a function", () => {
  // The unwrapping must not turn every asserted export into a function — the
  // reason types and plain constants are out of scope in the first place.
  const { status, stdout } = runWall({
    "value.ts": 'export const schema = ({ a: 1 }) as Record<string, number>;\nexport const name = "trip";\n',
  });
  assert.equal(status, 0);
  assert.match(stdout, /0 exported functions\/classes/);
});

test("skips tests, specs and declaration files", () => {
  const { status, stdout } = runWall({
    "a.test.ts": "export function helper() {}\n",
    "b.spec.ts": "export function fixture() {}\n",
    "c.d.ts": "export function declared(): void;\n",
  });
  assert.equal(status, 0);
  assert.match(stdout, /0 exported functions\/classes/);
});
