import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// KI-2026-09-05-s: `check-lint-wall.mjs` sits in `pnpm lint` asserting that a dozen ESLint
// rules fire, and nothing had ever demonstrated the wall itself failing. It could not: the
// old helper read "eslint exited non-zero" as "the wall fired", and several fixtures trip
// more than one rule, so a rule could be deleted and the wall would still print
// "correctly rejected". Reproduced by turning `playwright/expect-expect` off — the wall
// printed all thirteen OK lines and exited 0. These tests are the red-first proof.
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const WALL = join(REPO_ROOT, "scripts", "check-lint-wall.mjs");
const WEB = join(REPO_ROOT, "apps", "web");

// Each call spawns the real wall, which shells out to ESLint once per fixture — about
// 16s a run. That is the price of testing a wall rather than a pure function, and it is
// why this file has four runs rather than one per assertion.
//
// The sabotaged config MUST live directly in apps/web: flat config resolves `files`
// patterns against the config file's own directory, so a config in a temp dir elsewhere
// would match nothing and every fixture would come back clean for the wrong reason.
// The name is minted per call and removed in `finally`, so a crashed run cannot leave a
// fixed path behind for the next one to trip over.
function runWallWithConfig(configBody) {
  const scratch = mkdtempSync(join(WEB, "eslint.config.__walltest__"));
  const configPath = join(WEB, `${basename(scratch)}.mjs`);
  try {
    rmSync(scratch, { recursive: true, force: true });
    writeFileSync(configPath, configBody);
    const result = spawnSync(process.execPath, [WALL], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: { ...process.env, LINT_WALL_ESLINT_CONFIG: basename(configPath) },
    });
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
  } finally {
    rmSync(configPath, { force: true });
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** The real config, plus flat-config blocks appended last. */
const configPlus = (...blocks) =>
  `import base from "./eslint.config.mjs";\nexport default [...base, ${blocks.join(", ")}];\n`;

function runWall() {
  const result = spawnSync(process.execPath, [WALL], { cwd: REPO_ROOT, encoding: "utf8" });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

// The inventory. An assertion silently dropped from the wall is the same failure as an
// assertion that never fires, and nothing else would notice — the wall would just print
// twelve happy lines instead of thirteen.
test("passes against the checked-in config, and every rejection names the rule that rejected it", () => {
  const { status, stdout, stderr } = runWall();
  assert.equal(status, 0, `expected the wall to pass; stderr:\n${stderr}`);
  for (const rule of [
    "rejected by no-restricted-imports",
    "rejected by import/no-restricted-paths",
    "rejected by no-restricted-syntax",
    "rejected by testing-library/no-container",
    "rejected by playwright/expect-expect",
  ]) {
    assert.ok(stdout.includes(rule), `expected the wall to attribute a rejection to ${rule}`);
  }
  assert.equal(stdout.trim().split("\n").length, 13, `the wall's assertion count changed:\n${stdout}`);
});

// THE REGRESSION THIS ENTRY EXISTS FOR. Both fixtures below trip a second, unrelated rule
// (`playwright/consistent-spacing-between-blocks` and `testing-library/no-node-access`),
// so before the wall named the rule it wanted, either could be deleted from
// eslint.config.mjs with the wall still green.
test("goes red when a rule it guards is switched off, even though a bystander rule still rejects the fixture", () => {
  const { status, stdout, stderr } = runWallWithConfig(
    configPlus(
      '{ files: ["e2e/**/*.ts"], rules: { "playwright/expect-expect": "off" } }',
      '{ files: ["src/**/*.test.{ts,tsx}"], rules: { "testing-library/no-container": "off" } }',
    ),
  );
  assert.equal(status, 1);
  const output = stdout + stderr;
  assert.match(
    output,
    /LINT WALL BREACHED: test-quality wall: e2e spec without an assertion .* was NOT flagged by playwright\/expect-expect \(fired instead: playwright\/consistent-spacing-between-blocks\)/,
  );
  assert.match(
    output,
    /LINT WALL BREACHED: test-quality wall: container\.querySelector .* was NOT flagged by testing-library\/no-container \(fired instead: testing-library\/no-node-access\)/,
  );
  // Everything else still passes: the wall failed for these two reasons, not because
  // pointing it at another config broke it wholesale.
  assert.match(output, /lint wall OK: forbidden @tc\/domain import from UI correctly rejected/);
});

// The other half of every wall. Adding a restriction is as much a defect as losing one —
// `@tc/predict` is deliberately reachable from the UI, and a wall that banned it would be
// wrong in a way no "does the rule fire" fixture can see. This block also demonstrates the
// flat-config replace semantics eslint.config.mjs warns about in its own comments: a later
// block setting `no-restricted-imports` REPLACES the earlier block's options rather than
// merging, so the domain wall disappears from src/app in the same stroke.
test("goes red when the wall becomes too strict, and when a replaced block drops the domain wall", () => {
  const { status, stdout, stderr } = runWallWithConfig(
    configPlus(
      '{ files: ["src/app/**"], rules: { "no-restricted-imports": ["error", { patterns: [' +
        '{ group: ["@tc/predict"], message: "fixture" }] }] } }',
    ),
  );
  assert.equal(status, 1);
  const output = stdout + stderr;
  assert.match(
    output,
    /LINT WALL TOO STRICT: @tc\/predict import \(predict subpath allowed\) correctly passes — flagged by no-restricted-imports/,
  );
  assert.match(
    output,
    /LINT WALL BREACHED: forbidden @tc\/domain import from UI .* was NOT flagged by no-restricted-imports \(fired instead: nothing\)/,
  );
});

// The blindness that outranks all the others: if ESLint cannot start at all, every
// `execSync` throws, and a wall reading a throw as "the rule fired" reports a clean sheet
// for a lint lane that ran zero rules. That is KI-13/76's shape ("`pnpm check` exiting 0
// having run zero integration tests") transplanted into `pnpm lint`.
test("reports that it could not run, rather than a clean sheet, when eslint cannot start", () => {
  const { status, stdout, stderr } = runWallWithConfig('throw new Error("fixture: broken eslint config");\n');
  assert.notEqual(status, 0);
  const output = stdout + stderr;
  assert.match(output, /LINT WALL CANNOT RUN: eslint produced no JSON report/);
  assert.doesNotMatch(output, /correctly rejected/);
});
