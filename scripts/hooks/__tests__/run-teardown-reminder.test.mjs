import { test } from "node:test";
import assert from "node:assert/strict";
import { makeRepo, makeUnitDir, runHook, writeManifest } from "./fixture.mjs";

function repoWith(units, teardown = null) {
  const root = makeRepo();
  const dir = makeUnitDir(root, "u1");
  writeManifest(root, { runId: "r1", teardown, units: units(dir), resources: {} });
  return root;
}

test("an open unit means no reminder", () => {
  const root = repoWith((dir) => [{ id: "u1", worktree: dir, fileScope: ["**"], state: "open" }]);
  const res = runHook("run-teardown-reminder.mjs", { cwd: root, stop_hook_active: false });
  assert.equal(res.status, 0);
});

test("all units closed and no teardown blocks once with the checklist", () => {
  const root = repoWith((dir) => [{ id: "u1", worktree: dir, fileScope: ["**"], state: "closed" }]);
  const res = runHook("run-teardown-reminder.mjs", { cwd: root, stop_hook_active: false });
  assert.equal(res.status, 2);
  assert.match(res.stderr, /r1/);
  assert.match(res.stderr, /promot/i);
});

test("a recorded teardown silences it", () => {
  const root = repoWith(
    (dir) => [{ id: "u1", worktree: dir, fileScope: ["**"], state: "closed" }],
    "2026-08-28T12:00:00Z",
  );
  const res = runHook("run-teardown-reminder.mjs", { cwd: root, stop_hook_active: false });
  assert.equal(res.status, 0);
});

test("stop_hook_active short-circuits", () => {
  const root = repoWith((dir) => [{ id: "u1", worktree: dir, fileScope: ["**"], state: "closed" }]);
  const res = runHook("run-teardown-reminder.mjs", { cwd: root, stop_hook_active: true });
  assert.equal(res.status, 0);
});

test("no run directory means no opinion", () => {
  const root = makeRepo();
  const res = runHook("run-teardown-reminder.mjs", { cwd: root, stop_hook_active: false });
  assert.equal(res.status, 0);
});

test("zero units never fires (the [].every() foot-gun)", () => {
  const root = repoWith(() => []);
  const res = runHook("run-teardown-reminder.mjs", { cwd: root, stop_hook_active: false });
  assert.equal(res.status, 0);
});
