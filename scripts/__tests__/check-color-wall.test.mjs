import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// check-color-wall.mjs scans the real repo via `git ls-files` rather than
// taking a directory argument (unlike check-sleep-wall.mjs), so these tests
// run it against the actual tree instead of a fixture sandbox.
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const WALL = join(REPO_ROOT, "scripts", "check-color-wall.mjs");
const SENTRY_PAGE = "apps/web/src/app/sentry-example-page/page.tsx";

function runWall() {
  const result = spawnSync(process.execPath, [WALL], { encoding: "utf8", cwd: REPO_ROOT });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

// The wall reads the working tree, not an argument, so the only way to show it
// on a given input is to put that input in the tree. `--others
// --exclude-standard` means an unstaged file counts, so nothing has to be
// staged; the directory is removed again whatever the assertions do.
const FIXTURE_DIR = "apps/web/src/__color-wall-fixture__";
function runWallAgainst(basename, contents) {
  const dir = join(REPO_ROOT, FIXTURE_DIR);
  const relative = `${FIXTURE_DIR}/${basename}`;
  mkdirSync(dir, { recursive: true });
  try {
    writeFileSync(join(REPO_ROOT, relative), contents);
    return { ...runWall(), relative };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// The regression this guards: the exclusion could be a no-op (wrong path,
// typo, wrong Set) and the wall would still pass today only because the file
// happens to be clean — it isn't. Feed the excluded file's own contents back
// through the wall at a path the exclusion does not cover, so the exclusion is
// proven necessary by the wall itself rather than by a second copy of its
// matcher living here and silently drifting out of sync with it.
test("the generated-non-product exclusion is non-vacuous: the excluded file really does contain raw color literals", () => {
  const contents = readFileSync(join(REPO_ROOT, SENTRY_PAGE), "utf8");
  const { status, stderr, relative } = runWallAgainst("sentry-copy.tsx", contents);
  assert.equal(
    status,
    1,
    "expected the Sentry scaffold to still carry raw color literals — if this fails, the exclusion may no longer be needed",
  );
  assert.match(stderr, new RegExp(`${relative}:\\d+: raw color literal`));
});

test("the wall passes end-to-end and names the generated-non-product exclusion separately from the shrinking pending list", () => {
  const { status, stdout } = runWall();
  assert.equal(status, 0, `expected the wall to pass; got: ${stdout}`);
  assert.match(stdout, /1 generated non-product excluded/);
});

test("the exclusion is scoped to the named file only, not the whole directory", () => {
  const source = readFileSync(WALL, "utf8");
  const match = source.match(/const generatedNonProduct = new Set\(\[([\s\S]*?)\]\);/);
  assert.ok(match, "expected a generatedNonProduct Set literal in check-color-wall.mjs");
  const entries = [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(entries, [SENTRY_PAGE]);
});

// KI-20260830: every decimal PR number from #100 to #99999999 is also a valid
// 3-to-8 digit hex string, so `#[0-9a-fA-F]{3,8}\b` flagged code comments that
// cited a pull request and had no color anywhere near them. This repo minted
// PR #100 on 2026-08-30, so the false positive arrives with every PR from here
// on; the workaround was to write "PR 100" without the `#`.
test("a comment citing a pull request by number is not a color literal (KI-20260830)", () => {
  const contents = [
    "// Fixed in review on PR #100 — see the thread.",
    "// Also discussed in pull request #4271 and issue #12345678.",
    "export const x = 1;",
    "",
  ].join("\n");
  const { status, stdout, stderr } = runWallAgainst("pr-reference.ts", contents);
  assert.equal(status, 0, `expected the wall to pass; got: ${stdout}${stderr}`);
});

// The anti-vacuity half of the pair above: a matcher that stopped flagging PR
// numbers by flagging less would pass that test too. Every line here is a real
// raw color that must still fail the wall — including the two all-decimal
// hexes, which are exactly the shape a PR reference takes and are told apart
// from one only by the color context they sit in.
test("real raw color literals are still caught, including all-decimal hexes in color context", () => {
  const lines = [
    'export const A = () => <div style={{ color: "#0c6b58" }} />;',
    'export const B = () => <div style={{ background: "#111" }} />;',
    'export const C = () => <div className="bg-[#100]" />;',
    'export const D = () => <div style={{ borderColor: "rgba(0, 0, 0, 0.2)" }} />;',
    'export const E = () => <div style={{ outlineColor: "hsl(120 50% 50%)" }} />;',
    'export const F = () => <div style={{ border: "1px solid #553DB8" }} />;',
    'export const G = () => <div style={{ color: "#FFFFFF" }} />;',
  ];
  const { status, stderr, relative } = runWallAgainst("raw-colors.tsx", `${lines.join("\n")}\n`);
  assert.equal(status, 1, "expected the wall to fail on a file full of raw colors");
  for (const [index, line] of lines.entries()) {
    assert.match(
      stderr,
      new RegExp(`${relative}:${index + 1}: raw color literal`),
      `expected line ${index + 1} to be flagged: ${line}`,
    );
  }
});
