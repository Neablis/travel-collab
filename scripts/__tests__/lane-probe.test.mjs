// Tests for scripts/lane-probe.mjs.
//
// The probe's whole value is telling a session the truth about its container
// BEFORE it promises a verification it cannot perform. The failure that
// matters is therefore not a crash — it is a probe that reports OK, or
// reports UNKNOWN, on a container where the lane is in fact broken. Each test
// below pins one such case to a known issue.

import { test } from "node:test";
import assert from "node:assert/strict";

import { pnpmMajorSkew, nodeLaneStatus, pinnedNodeMajor, probeDeps } from "../lane-probe.mjs";

// --- pnpm major skew (KI-2026-09-08-b) ------------------------------------

test("pnpmMajorSkew reads the QUOTED .modules.yaml form pnpm 11 writes", () => {
  // The real file in this repo, verified 2026-09-21:
  //   "packageManager": "pnpm@11.25.0",
  // The first draft of the probe matched only the KI's unquoted spelling and
  // therefore reported UNKNOWN on every modern tree — silently not probing
  // the one lane it exists to probe.
  const yaml = '  "packageManager": "pnpm@11.25.0",\n  "storeDir": "/root/.../store/v11",';
  assert.deepEqual(pnpmMajorSkew(yaml, "11.25.0"), {
    recorded: "11", onPath: "11", skewed: false,
  });
});

test("pnpmMajorSkew reads the BARE form the known issue quotes", () => {
  // KI-2026-09-08-b quotes: packageManager: pnpm@10.28.0
  const yaml = "packageManager: pnpm@10.28.0\nstoreDir: /x/store/v10";
  assert.deepEqual(pnpmMajorSkew(yaml, "11.25.0"), {
    recorded: "10", onPath: "11", skewed: true,
  });
});

test("pnpmMajorSkew compares MAJORS only — a patch difference is not a skew", () => {
  // pnpm's deps-status check objects at major granularity. Reporting BLOCKED
  // on 11.25.0 vs 11.25.1 would be a false alarm, and a probe that cries wolf
  // is trained away within a day.
  const yaml = '"packageManager": "pnpm@11.25.0"';
  assert.equal(pnpmMajorSkew(yaml, "11.26.3").skewed, false);
});

test("pnpmMajorSkew returns null when it cannot tell — never a false OK", () => {
  assert.equal(pnpmMajorSkew("nothing useful here", "11.25.0"), null);
  assert.equal(pnpmMajorSkew('"packageManager": "pnpm@11.0.0"', ""), null);
  assert.equal(pnpmMajorSkew(null, null), null);
});

// --- node major vs the pinned version (KI-2026-09-02-a) ------------------

test("nodeLaneStatus passes only the major .nvmrc pins", () => {
  assert.equal(nodeLaneStatus("v24.21.0", 24).status, "OK");
  for (const other of ["v22.22.2", "v26.0.0", "v20.0.0"]) {
    const r = nodeLaneStatus(other, 24);
    assert.equal(r.status, "BLOCKED", other);
    assert.equal(r.ki, "KI-2026-09-02-a");
    assert.match(r.note, /pins 24/);
  }
});

test("nodeLaneStatus says UNKNOWN rather than OK when either side is unreadable", () => {
  assert.equal(nodeLaneStatus("not-a-version", 24).status, "UNKNOWN");
  assert.equal(nodeLaneStatus(undefined, 24).status, "UNKNOWN");
  assert.equal(nodeLaneStatus("v24.21.0", null).status, "UNKNOWN");
});

test("pinnedNodeMajor reads the forms .nvmrc takes", () => {
  assert.equal(pinnedNodeMajor("24\n"), 24);
  assert.equal(pinnedNodeMajor("v24.21.0"), 24);
  assert.equal(pinnedNodeMajor("lts/*"), null);
  assert.equal(pinnedNodeMajor(null), null);
});

// --- node_modules presence (KI-2026-09-12-b) ------------------------------

test("probeDeps reports BLOCKED when a worktree has no node_modules", () => {
  // The 2026-09-12 sweep found a ki-fixer worktree with neither node_modules
  // nor apps/web/node_modules, because SessionStart had not run.
  const none = probeDeps({ existsSync: () => false }, "/w");
  assert.equal(none.status, "BLOCKED");
  assert.equal(none.ki, "KI-2026-09-12-b");
  assert.match(none.note, /root \+ apps\/web/);
});

test("probeDeps catches the HALF-installed tree, not just the empty one", () => {
  // Root present but apps/web missing is the shape a stale worktree actually
  // has; treating "root exists" as good enough would report OK on it.
  const half = probeDeps({ existsSync: (p) => String(p).endsWith("/w/node_modules") }, "/w");
  assert.equal(half.status, "BLOCKED");
  assert.match(half.note, /apps\/web/);
  assert.doesNotMatch(half.note, /root \+/);
});

test("probeDeps reports OK only when BOTH trees exist", () => {
  assert.equal(probeDeps({ existsSync: () => true }, "/w").status, "OK");
});
