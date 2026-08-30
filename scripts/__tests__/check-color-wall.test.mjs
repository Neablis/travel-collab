import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
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

// The regression this guards: the exclusion could be a no-op (wrong path,
// typo, wrong Set) and the wall would still pass today only because the file
// happens to be clean — it isn't. Confirm the file the exclusion names
// actually trips the color-literal regex the wall enforces, so the exclusion
// is proven necessary, not merely present.
test("the generated-non-product exclusion is non-vacuous: the excluded file really does contain raw color literals", () => {
  const colorLiteral = /(#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\()/;
  const lines = readFileSync(join(REPO_ROOT, SENTRY_PAGE), "utf8").split("\n");
  const violations = lines.filter((line) => colorLiteral.test(line));
  assert.ok(
    violations.length > 0,
    "expected the Sentry scaffold to still carry raw color literals — if this fails, the exclusion may no longer be needed",
  );
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
