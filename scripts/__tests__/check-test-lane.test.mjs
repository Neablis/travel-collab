// Tests for scripts/hooks/check-test-lane.mjs (KI-2026-09-05-m item 5).
//
// Same two failure modes as draft-pr-guard.test.mjs, in opposite directions:
// a guard that misses the spellings agents actually type is no guard, and one
// that fires on a commit message or a grep gets trained away.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

const HOOK = new URL("../hooks/check-test-lane.mjs", import.meta.url).pathname;

function hook(command) {
  const out = execFileSync(process.execPath, [HOOK], {
    input: JSON.stringify({ tool_input: { command } }),
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
  assert.equal(hook("cd apps/web && E2E_DEV_LANE=1 pnpm test:e2e"), null);
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

// --- it must NOT fire --------------------------------------------------------

test("the lanes that are right are silent", () => {
  for (const c of [
    "pnpm --filter web test:e2e:ci-like",
    "pnpm --filter web test:e2e:ci-like -- tests/e2e/trip.spec.ts",
    "pnpm --filter web exec vitest run -c vitest.unit.config.ts src/lib/dates.test.ts",
    "pnpm --filter web test",
    "pnpm --filter web test:int",
    "pnpm test",
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
