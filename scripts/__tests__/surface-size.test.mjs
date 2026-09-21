// Tests for scripts/surface-size.mjs.
//
// This wall's job is to fire on growth in a file every session reads first.
// The failure that matters is the one the repo already documents about hooks:
// a check that fires on something a person legitimately chose gets trained
// away, after which it enforces nothing. So the tests pin BOTH directions —
// it must fire when a budget is exceeded, and must not when it is not.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

import { collect } from "../surface-size.mjs";

const SCRIPT = new URL("../surface-size.mjs", import.meta.url).pathname;

function repo(sizes) {
  const root = mkdtempSync(join(tmpdir(), "ss-test-"));
  mkdirSync(join(root, "docs/milestones"), { recursive: true });
  mkdirSync(join(root, "docs/known-issues/open"), { recursive: true });
  for (const [rel, n] of Object.entries(sizes)) {
    const full = join(root, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, "x".repeat(n));
  }
  return root;
}

test("a file within budget is OK; one over is flagged", () => {
  const root = repo({ "TODO.md": 10_000, "CLAUDE.md": 20_000 });
  const rows = collect(root);
  assert.equal(rows.find((r) => r.rel === "TODO.md").over, false);
  assert.equal(rows.find((r) => r.rel === "CLAUDE.md").over, true, "20,000 over a 10,000 budget");
  rmSync(root, { recursive: true, force: true });
});

test("the un-walled directory is never `over`, whatever its size", () => {
  // docs/known-issues/open/ is reported but not walled: its size is a backlog
  // problem, and walling it would pressure people into shorter KI entries,
  // which is the opposite of what those files are for.
  const root = repo({});
  for (let i = 0; i < 40; i += 1) {
    writeFileSync(join(root, `docs/known-issues/open/KI-${i}.md`), "y".repeat(50_000));
  }
  const row = collect(root).find((r) => r.rel === "docs/known-issues/open/");
  assert.ok(row.bytes > 1_000_000);
  assert.equal(row.over, false);
  assert.equal(row.budget, null);
  rmSync(root, { recursive: true, force: true });
});

test("a missing file is not counted as over budget", () => {
  // A file that does not exist must not fail the wall — that would make the
  // check fire on a repo layout change rather than on growth.
  const root = repo({});
  for (const row of collect(root)) assert.equal(row.over, false, row.rel);
  rmSync(root, { recursive: true, force: true });
});

test("--check exits non-zero and names the file and the overage", () => {
  const root = repo({ "CLAUDE.md": 12_345 });
  try {
    execFileSync(process.execPath, [SCRIPT, "--check"], {
      env: { ...process.env, CLAUDE_PROJECT_DIR: root },
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    });
    assert.fail("expected a non-zero exit");
  } catch (err) {
    const out = String(err.stdout ?? "") + String(err.stderr ?? "");
    assert.match(out, /surface wall: CLAUDE\.md is 12,345 B/);
    assert.match(out, /over its 10,000 B budget by 2,345/);
    // The message must say what to DO, or it is just a red build.
    assert.match(out, /Move the narrative/);
    assert.match(out, /Raising the budget is a decision to record/);
  }
  rmSync(root, { recursive: true, force: true });
});

test("--check exits zero when every walled file is within budget", () => {
  const root = repo({ "TODO.md": 100, "CLAUDE.md": 100 });
  const out = execFileSync(process.execPath, [SCRIPT, "--check"], {
    env: { ...process.env, CLAUDE_PROJECT_DIR: root },
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  });
  assert.match(out, /surface wall OK/);
  rmSync(root, { recursive: true, force: true });
});

test("every budget leaves real headroom over the size it was set at", () => {
  // The stated rule is ~1.25x at set time. A budget tuned to the exact current
  // size turns the next legitimate paragraph into a red build — which is how
  // a check gets trained away. This asserts the rule against the LIVE repo.
  const rows = collect(process.env.CLAUDE_PROJECT_DIR ?? process.cwd());
  for (const r of rows) {
    if (r.budget === null || r.bytes === null) continue;
    const headroom = (r.budget - r.bytes) / r.budget;
    assert.ok(
      headroom > 0.1,
      `${r.rel}: only ${(headroom * 100).toFixed(1)}% headroom (${r.bytes}/${r.budget}) — too tight to survive one real edit`,
    );
  }
});
