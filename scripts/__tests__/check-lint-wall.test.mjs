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
// twenty-one happy lines instead of twenty-two. (Thirteen until ADR-043's P2 added the
// assistant kernel's six fixtures and three real-file `--print-config` checks.)
test("passes against the checked-in config, and every rejection names the rule that rejected it", () => {
  const { status, stdout, stderr } = runWall();
  assert.equal(status, 0, `expected the wall to pass; stderr:\n${stderr}`);
  for (const rule of [
    "rejected by no-restricted-imports",
    "rejected by import/no-restricted-paths",
    "rejected by no-restricted-syntax",
    "rejected by testing-library/no-container",
    "rejected by playwright/expect-expect",
    "rejected by playwright/no-wait-for-timeout",
    "rejected by no-restricted-properties",
  ]) {
    assert.ok(stdout.includes(rule), `expected the wall to attribute a rejection to ${rule}`);
  }
  // Bump this deliberately when you add a wall fixture; it is the tripwire that
  // catches one being deleted.
  //
  // **It is also the check that a Tier-2 subset misses, and M9 Phase 0 proved it
  // twice.** P4 and P5 both added assistant-kernel fixtures and both ran
  // `node scripts/check-lint-wall.mjs` — which exits 0, because the wall itself
  // is fine — without running this test OF the wall, which pins the count. The
  // failure surfaced only in Tier 3's `pnpm check`, two phases after it was
  // introduced. If you touch `apps/web/eslint.config.mjs` or
  // `scripts/check-lint-wall.mjs`, the sufficient subset includes THIS FILE, not
  // just the wall it tests.
  //
  // **26 → 29 on 2026-09-14**, for the three `src/app/admin` fixtures that pin
  // the operator console's exemption (one pattern open, two shut). And the trap
  // above caught its third victim on the way: that change touched
  // `eslint.config.mjs` AND `check-lint-wall.mjs`, both named in the paragraph
  // above, and I ran `node scripts/check-lint-wall.mjs` — which exits 0,
  // because the wall is fine — without running this file. It surfaced in
  // `pnpm check`, exactly where the comment says it will. The warning is
  // correct and being correct is not the same as being read.
  //
  // **29 → 31 on 2026-09-23**, the fourth victim: the `geocoding` barrel and
  // `geocoding/locationiq` became the admission pipeline's near-miss checks
  // when `ai/askAnalytics` moved inside the kernel and stopped being one.
  // Same sequence as above — the wall run by hand exited 0, and this file
  // caught it in the full `scripts/**/__tests__` run.
  //
  // **31 → 34 on 2026-09-25**: the fetch wall (KI-2026-09-05-q) — a bare fetch
  // rejected, the element wall still firing on the same `.tsx`, and server code
  // left clean.
  //
  // **34 → 35 on 2026-09-25**: the sleep wall moved in from its own script
  // (`check-sleep-wall.mjs`, deleted — KI-2026-09-05-w item 4).
  //
  // **35 → 36 on 2026-09-25**: the same wall for a page not named `page`
  // (`bob.waitForTimeout`), which the plugin rule does not see (PR #234 review).
  assert.equal(stdout.trim().split("\n").length, 36,`the wall's assertion count changed:\n${stdout}`);
});

// THE REGRESSION THIS ENTRY EXISTS FOR. Both fixtures below trip a second, unrelated rule
// (`playwright/consistent-spacing-between-blocks` and `testing-library/no-node-access`),
// so before the wall named the rule it wanted, either could be deleted from
// eslint.config.mjs with the wall still green.
test("goes red when a rule it guards is switched off, even though a bystander rule still rejects the fixture", () => {
  const { status, stdout, stderr } = runWallWithConfig(
    configPlus(
      '{ files: ["e2e/**/*.ts"], rules: { "playwright/expect-expect": "off", "playwright/no-wait-for-timeout": "off", "no-restricted-properties": "off" } }',
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
  // The sleep wall's fixture trips nothing else, so this one reads "fired instead: nothing".
  assert.match(
    output,
    /LINT WALL BREACHED: sleep wall: waitForTimeout in an e2e spec .* was NOT flagged by playwright\/no-wait-for-timeout \(fired instead: nothing\)/,
  );
  assert.match(
    output,
    /LINT WALL BREACHED: sleep wall: waitForTimeout on a page not named `page` .* was NOT flagged by no-restricted-properties \(fired instead: nothing\)/,
  );
  // Everything else still passes: the wall failed for these reasons, not because
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
