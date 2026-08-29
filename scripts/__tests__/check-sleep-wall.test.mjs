import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const WALL = join(dirname(fileURLToPath(import.meta.url)), "..", "check-sleep-wall.mjs");

/** Writes `files` into a fresh temp dir and runs the wall over it. */
function runWall(files) {
  const dir = mkdtempSync(join(tmpdir(), "tc-sleep-wall-"));
  for (const [name, source] of Object.entries(files)) {
    const path = join(dir, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, source);
  }
  const result = spawnSync(process.execPath, [WALL, dir], { encoding: "utf8" });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, dir };
}

// The exact shape the wall exists to catch, lifted from m10-map-rail.spec.ts
// as it stood on 2026-08-28: a sleep buried in a helper the scan loop calls
// 200 times, plus one at each assertion site. Guidance had banned this twice
// (KI-13, KI-21) and it came back anyway — so the wall has to fail on it, not
// merely disapprove.
const PRE_FIX_SPEC = `import { expect, test, type Page } from "@playwright/test";

async function scrollRailBy(page: Page, delta: number): Promise<void> {
  await page.evaluate((by) => {
    document.querySelector('[aria-label="Days"]')!.scrollTop += by;
  }, delta);
  // One frame for the scroll handler's leading edge plus its trailing timer.
  await page.waitForTimeout(120);
}

test("map rail", async ({ page }) => {
  await scrollRailBy(page, 10);
  await page.waitForTimeout(120);
  await page.waitForTimeout(150);
});
`;

test("fails on the spec the wall was written for, naming every site", () => {
  const { status, stderr } = runWall({ "m10-map-rail.spec.ts": PRE_FIX_SPEC });
  assert.equal(status, 1);
  assert.match(stderr, /m10-map-rail\.spec\.ts:8: unjustified sleep/);
  assert.match(stderr, /m10-map-rail\.spec\.ts:13: unjustified sleep/);
  assert.match(stderr, /m10-map-rail\.spec\.ts:14: unjustified sleep/);
  assert.match(stderr, /SLEEP WALL BREACHED: 3 unjustified/);
});

test("passes a directory with no sleeps at all", () => {
  const { status, stdout } = runWall({
    "a.spec.ts": 'await expect(page.getByRole("heading")).toHaveText("Day 7");\n',
    "b.spec.ts": "await expect.poll(() => read()).toBe(7);\n",
  });
  assert.equal(status, 0);
  assert.match(stdout, /sleep wall OK \(2 files scanned, 0 justified\)/);
});

// A one-line reason is rarely a good one, so a wrapped justification has to
// work — the marker sits two lines up here, above its own continuation. A rule
// that only looked at the adjacent line would reject the very example the
// wall's own error message tells people to write.
test("a wrapped justification above the sleep is accepted", () => {
  const { status, stdout } = runWall({
    "a.spec.ts": [
      "// e2e-sleep-allowed: proves the toast does NOT come back, so the only",
      "// signal is elapsed time.",
      "await page.waitForTimeout(500);",
      "",
    ].join("\n"),
  });
  assert.equal(status, 0);
  assert.match(stdout, /1 justified/);
});

test("a justification on the line directly above allows the sleep", () => {
  const { status, stdout } = runWall({
    "a.spec.ts": "// e2e-sleep-allowed: no event exists for a non-appearance.\nawait page.waitForTimeout(500);\n",
  });
  assert.equal(status, 0);
  assert.match(stdout, /1 justified/);
});

test("a justification on the same line allows the sleep", () => {
  const { status, stdout } = runWall({
    "a.spec.ts": "await page.waitForTimeout(500); // e2e-sleep-allowed: no event to await.\n",
  });
  assert.equal(status, 0);
  assert.match(stdout, /1 justified/);
});

// The marker's whole value is the reason attached to it. A bare marker is a
// silencer, which is the thing three rounds of guidance already failed to stop.
test("a marker with no reason does not count as a justification", () => {
  const { status, stderr } = runWall({
    "a.spec.ts": "// e2e-sleep-allowed:\nawait page.waitForTimeout(500);\n",
  });
  assert.equal(status, 1);
  assert.match(stderr, /a\.spec\.ts:2: unjustified sleep/);
});

test("a comment two lines up does not excuse a sleep", () => {
  const { status, stderr } = runWall({
    "a.spec.ts": "// e2e-sleep-allowed: for the call below.\nawait doSomething();\nawait page.waitForTimeout(500);\n",
  });
  assert.equal(status, 1);
  assert.match(stderr, /a\.spec\.ts:3: unjustified sleep/);
});

test("catches any receiver, not just `page`", () => {
  const { status, stderr } = runWall({ "a.spec.ts": "await frame.waitForTimeout(50);\n" });
  assert.equal(status, 1);
  assert.match(stderr, /a\.spec\.ts:1/);
});

test("scans nested directories and ignores non-TypeScript files", () => {
  const { status, stdout } = runWall({
    "fixtures/README.md": "await page.waitForTimeout(500);\n",
    "nested/deep/a.spec.ts": "// e2e-sleep-allowed: documented.\nawait page.waitForTimeout(1);\n",
  });
  assert.equal(status, 0);
  assert.match(stdout, /sleep wall OK \(1 files scanned, 1 justified\)/);
});
