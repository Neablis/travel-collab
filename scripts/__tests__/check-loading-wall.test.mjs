import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const WALL = join(dirname(fileURLToPath(import.meta.url)), "..", "check-loading-wall.mjs");

/** Writes `files` into a fresh temp dir and runs the wall over it. */
function runWall(files) {
  const dir = mkdtempSync(join(tmpdir(), "tc-loading-wall-"));
  for (const [name, source] of Object.entries(files)) {
    const path = join(dir, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, source);
  }
  const result = spawnSync(process.execPath, [WALL, dir], { encoding: "utf8" });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

// The three shapes KI-2026-09-20-e found in the tree, as they stood: a whole
// surface returning the word, a card body announcing it, and a longer sentence
// ending in an ellipsis — plus a literal in a conditional child, which is the
// same text by another route.
test("fails on every shape the entry found, naming each site", () => {
  const { status, stderr } = runWall({
    "PageScreen.tsx": 'export const A = () => {\n  if (x) return <PageContainer>Loading…</PageContainer>;\n};\n',
    "PlansScreen.tsx": "export const B = () => (\n  <Text>\n    Loading…\n  </Text>\n);\n",
    "TokensSection.tsx": "export const C = () => <Text>Loading your trips...</Text>;\n",
    "Other.tsx": 'export const D = () => <div>{ready ? null : "Loading…"}</div>;\n',
  });
  assert.equal(status, 1);
  assert.match(stderr, /PageScreen\.tsx:2: renders "Loading…"/);
  assert.match(stderr, /PlansScreen\.tsx:3: renders "Loading…"/);
  assert.match(stderr, /TokensSection\.tsx:1: renders "Loading your trips\.\.\."/);
  assert.match(stderr, /Other\.tsx:1: renders "Loading…"/);
  assert.match(stderr, /LOADING WALL BREACHED: 4 bare loading string\(s\)/);
});

// What must stay allowed: a placeholder's screen-reader name, prose that
// mentions the word, comments, a sentence that is not an announcement, and
// tests.
test("passes attributes, comments, other sentences and tests", () => {
  const { status, stdout, stderr } = runWall({
    "Skeleton.tsx":
      'export const S = () => <SkeletonRegion label="Loading notebooks" aria-label={"Loading…"} />;\n',
    "Commented.tsx": "// It used to render `Loading…`.\nexport const C = () => null; /* \"Loading…\" */\n",
    "Prose.tsx": "export const P = () => <p>Working out what this costs…</p>;\n",
    "Screen.test.tsx": 'expect(screen.queryByText("Loading…")).toBeNull();\n',
  });
  assert.equal(status, 0, stderr);
  assert.match(stdout, /loading wall OK \(3 files scanned\)/);
});
