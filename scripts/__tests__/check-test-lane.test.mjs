// Tests for scripts/hooks/check-test-lane.mjs (KI-2026-09-05-m item 5).
//
// Same two failure modes as draft-pr-guard.test.mjs, in opposite directions:
// a guard that misses the spellings agents actually type is no guard, and one
// that fires on a commit message or a grep gets trained away.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

const HOOK = new URL("../hooks/check-test-lane.mjs", import.meta.url).pathname;

function hook(command, cwd) {
  const out = execFileSync(process.execPath, [HOOK], {
    input: JSON.stringify({ tool_input: { command }, cwd }),
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
  if (!out) return null;
  return JSON.parse(out).hookSpecificOutput;
}

// --- it must fire ------------------------------------------------------------

test("the dev e2e lane is denied, and the reason names the lane that counts", () => {
  const r = hook("pnpm --filter web test:e2e");
  assert.equal(r.permissionDecision, "deny");
  assert.match(r.permissionDecisionReason, /CLAUDE\.md rule 1/);
  assert.match(r.permissionDecisionReason, /pnpm --filter web test:e2e:ci-like/);
  assert.match(r.permissionDecisionReason, /E2E_DEV_LANE=1/);
});

test("the dev e2e lane is denied however it is spelled or wrapped", () => {
  for (const c of [
    "cd apps/web && pnpm test:e2e tests/e2e/trip.spec.ts",
    "pnpm -F web run test:e2e",
    "npm run test:e2e",
    "CI=true pnpm --filter web test:e2e",
    "pnpm build; pnpm --filter web test:e2e --grep notebook",
  ]) {
    assert.equal(hook(c)?.permissionDecision, "deny", c);
  }
});

test("the swallowed passthrough is denied, with the command that does scope", () => {
  const r = hook("pnpm --filter web test -- --run src/lib/dates.test.ts");
  assert.equal(r.permissionDecision, "deny");
  assert.match(r.permissionDecisionReason, /103 passed/);
  assert.match(r.permissionDecisionReason, /vitest run -c vitest\.unit\.config\.ts <file>/);
  assert.match(r.permissionDecisionReason, /minimal-check-subset/);
  assert.equal(hook("cd apps/web && pnpm test -- --run x.test.ts")?.permissionDecision, "deny");
});

test("E2E_DEV_LANE=1 lets the dev lane through, but not the passthrough form", () => {
  assert.equal(hook("E2E_DEV_LANE=1 pnpm --filter web test:e2e tests/e2e/x.spec.ts"), null);
  // The override is for the dev lane, not for the whole suite: a spec is still owed.
  assert.equal(hook("cd apps/web && E2E_DEV_LANE=1 pnpm test:e2e")?.permissionDecision, "deny");
  // The override is per segment: it cannot leak onto a later call.
  assert.equal(
    hook("E2E_DEV_LANE=1 pnpm test:e2e x.spec.ts && pnpm test:e2e")?.permissionDecision,
    "deny",
  );
  assert.equal(
    hook("E2E_DEV_LANE=1 pnpm --filter web test -- --run x.test.ts")?.permissionDecision,
    "deny",
  );
});

test("full local suites are denied with the scoped command and the escape hatch", () => {
  for (const c of [
    "pnpm check",
    "pnpm test",
    "pnpm test:unit",
    "pnpm --filter web test",
    "pnpm -F @tc/domain test",
    "cd apps/web && pnpm exec vitest run",
    "npx vitest run",
    "pnpm --filter web exec node scripts/with-test-db.mjs vitest run",
    "pnpm --filter web test:e2e:ci-like",
    "pnpm --filter web test:e2e:ci-like -g 'Calendar week'",
  ]) {
    const r = hook(c);
    assert.equal(r?.permissionDecision, "deny", c);
    assert.match(r.permissionDecisionReason, /ALLOW_FULL_SUITE=1/, c);
    assert.match(r.permissionDecisionReason, /when Mitchell asks/, c);
  }
  assert.match(hook("pnpm check").permissionDecisionReason, /vitest\.unit\.config\.ts <test files>/);
  assert.match(
    hook("pnpm --filter web test:e2e:ci-like").permissionDecisionReason,
    /test:e2e:ci-like e2e\/<spec>\.ts/,
  );
});

test("a dash-dash before the e2e spec is denied: it drops the filter", () => {
  const r = hook("pnpm --filter web test:e2e:ci-like -- e2e/m26-phone-targets.spec.ts");
  assert.equal(r?.permissionDecision, "deny");
  assert.match(r.permissionDecisionReason, /drops the filter/);
});

test("a web vitest run without -c is denied, because the default config is the int suite", () => {
  for (const c of [
    "pnpm --filter web exec vitest run src/lib/dates.test.ts",
    "cd apps/web && npx vitest run src/lib/dates.test.ts",
  ]) {
    const r = hook(c);
    assert.equal(r?.permissionDecision, "deny", c);
    assert.match(r.permissionDecisionReason, /-c vitest\.unit\.config\.ts/, c);
  }
});

test("ALLOW_FULL_SUITE=1 lets a full suite through, per segment", () => {
  assert.equal(hook("ALLOW_FULL_SUITE=1 pnpm check"), null);
  assert.equal(hook("ALLOW_FULL_SUITE=1 pnpm --filter web test:e2e:ci-like"), null);
  assert.equal(hook("ALLOW_FULL_SUITE=1 pnpm check && pnpm test")?.permissionDecision, "deny");
});

test("an unscoped playwright test in apps/web is denied", () => {
  for (const [c, cwd] of [
    ["pnpm --filter web exec playwright test", undefined],
    ["cd apps/web && npx playwright test --grep notebook", undefined],
    ["playwright test", "/repo/apps/web"],
  ]) {
    const r = hook(c, cwd);
    assert.equal(r?.permissionDecision, "deny", c);
    assert.match(r.permissionDecisionReason, /test:e2e:ci-like e2e\/<spec>\.ts/, c);
  }
});

// --- it must NOT fire --------------------------------------------------------

test("a non-web vitest run is not judged by apps/web's config, wherever it starts", () => {
  // The filter names the package outright; the cwd only decides without one.
  assert.equal(hook("pnpm --filter @tc/domain exec vitest run src/plan.test.ts", "/repo/apps/web"), null);
  assert.equal(hook("cd apps/web && pnpm --filter @tc/factories exec vitest run src/trip.test.ts"), null);
  // Every `cd` is re-evaluated: leaving apps/web leaves its config behind.
  assert.equal(hook("cd apps/web && cd ../.. && npx vitest run packages/domain/src/plan.test.ts"), null);
  // ...and the web rule still holds for a run that stays there.
  assert.equal(
    hook("cd apps/web && cd src && npx vitest run lib/dates.test.ts")?.permissionDecision,
    "deny",
  );
});

test("a quoted separator is text, not a command boundary", () => {
  assert.equal(hook('git commit -m "a" -m "b; pnpm check passed"'), null);
  assert.equal(hook("git commit -m 'x | pnpm test && done'"), null);
});

test("a CRLF command is read, not crashed on", () => {
  assert.equal(hook("cd apps/web\r\npnpm exec vitest run -c vitest.unit.config.ts src/lib/dates.test.ts\r\n"), null);
  assert.equal(hook("echo hi\r\npnpm check\r\n")?.permissionDecision, "deny");
});

test("vitest list and vitest --version run nothing and pass", () => {
  for (const c of [
    "pnpm --filter web exec vitest --version",
    "npx vitest list",
    "cd apps/web && pnpm exec vitest list -c vitest.unit.config.ts",
  ]) {
    assert.equal(hook(c), null, c);
  }
});


test("the lanes that are right are silent", () => {
  for (const c of [
    "pnpm --filter web test:e2e:ci-like e2e/trip.spec.ts",
    "WEB_PORT=3100 pnpm --filter web test:e2e:ci-like e2e/trip.spec.ts -g 'drag'",
    "pnpm --filter web exec vitest run -c vitest.unit.config.ts src/lib/dates.test.ts",
    "cd apps/web && pnpm exec vitest run --config=vitest.unit.config.ts src/lib/",
    "pnpm --filter web test src/lib/dates.test.ts",
    "pnpm --filter web exec node scripts/with-test-db.mjs vitest run src/ask/route.int.test.ts",
    "pnpm --filter @tc/factories exec vitest run src/trip.test.ts",
    "pnpm --filter web test:int",
    "node --test scripts/__tests__/check-test-lane.test.mjs",
    "pnpm --filter web exec eslint src/lib/dates.ts",
    "pnpm --filter web exec playwright test e2e/trip.spec.ts",
  ]) {
    assert.equal(hook(c), null, c);
  }
});

test("naming a banned form without running it is silent", () => {
  for (const c of [
    "git commit -m 'use test:e2e:ci-like, not test:e2e'",
    'grep -rn "test -- --run" docs/',
    "echo pnpm-free: test:e2e",
    "rg 'test:e2e(?!:ci-like)' scripts/",
    "git commit -m \"$(cat <<'EOF'\nfix: thing\n\npnpm test passes\npnpm check\nEOF\n)\"",
    "git commit -m 'fix: thing\n\npnpm check is green'",
  ]) {
    assert.equal(hook(c), null, c);
  }
});

test("a malformed payload or empty command is silent", () => {
  const out = execFileSync(process.execPath, [HOOK], {
    input: "not json at all",
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
  assert.equal(out, "", "a parse failure must fail open");
  assert.equal(hook(""), null);
});
