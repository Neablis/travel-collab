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

// `activeRuns` scans from the git common dir, so this reminder reaches
// sessions whose cwd is an unrelated sibling worktree of the same repo. The
// message therefore has to be self-locating and has to tell a reader who was
// never dispatched into the run that it is not theirs to act on — otherwise
// an uninvolved agent starts triaging notes and asking to delete branches.

test("the reminder names the run directory's absolute path", () => {
  const root = makeRepo();
  const dir = makeUnitDir(root, "u1");
  const runDir = writeManifest(root, {
    runId: "r1",
    teardown: null,
    units: [{ id: "u1", worktree: dir, fileScope: ["**"], state: "closed" }],
    resources: {},
  });
  const res = runHook("run-teardown-reminder.mjs", { cwd: root, stop_hook_active: false });
  assert.equal(res.status, 2);
  assert.ok(res.stderr.includes(runDir), `stderr must name ${runDir}`);
});

test("the reminder tells a reader the run may not be theirs to act on", () => {
  const root = repoWith((dir) => [{ id: "u1", worktree: dir, fileScope: ["**"], state: "closed" }]);
  const res = runHook("run-teardown-reminder.mjs", { cwd: root, stop_hook_active: false });
  assert.match(res.stderr, /not yours to act on/i);
});

test("two pending runs read as plural, not as one run named 'r1, r2'", () => {
  const root = makeRepo();
  for (const runId of ["r1", "r2"]) {
    writeManifest(root, {
      runId,
      teardown: null,
      units: [
        { id: "u1", worktree: makeUnitDir(root, runId), fileScope: ["**"], state: "closed" },
      ],
      resources: {},
    });
  }
  const res = runHook("run-teardown-reminder.mjs", { cwd: root, stop_hook_active: false });
  assert.equal(res.status, 2);
  assert.match(res.stderr, /^Runs\b/m);
  assert.doesNotMatch(res.stderr, /^Run r1/m);
});

// The units/unit guard below is correct today, but nothing pinned it. A
// revert to `manifest.units ?? []` throws an uncaught TypeError out of a Stop
// hook — the one hook that can block the end of every turn in this repo.

// Both shapes, because only one of them discriminates. An object has no
// `length`, so `units.length > 0` short-circuits and an unguarded version
// survives it; a string has a length and reaches `.every`, which it does not
// have. Dropping the string case leaves the Array.isArray guard unpinned.
for (const units of [{ u1: { id: "u1", state: "closed" } }, "closed"]) {
  test(`a non-array units field (${typeof units}) never fires the reminder`, () => {
    const root = makeRepo();
    writeManifest(root, { runId: "r1", teardown: null, units, resources: {} });
    const res = runHook("run-teardown-reminder.mjs", { cwd: root, stop_hook_active: false });
    assert.equal(res.status, 0);
    assert.equal(res.stderr, "");
  });
}

test("a non-object unit entry never fires the reminder", () => {
  const root = repoWith((dir) => [
    null,
    { id: "u1", worktree: dir, fileScope: ["**"], state: "closed" },
  ]);
  const res = runHook("run-teardown-reminder.mjs", { cwd: root, stop_hook_active: false });
  assert.equal(res.status, 0);
  assert.equal(res.stderr, "");
});
