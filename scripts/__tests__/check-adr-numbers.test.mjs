import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const WALL = join(dirname(fileURLToPath(import.meta.url)), "..", "check-adr-numbers.mjs");

/** Writes each named file into a temp `docs/architecture` and runs the wall. */
function runWall(names) {
  const dir = mkdtempSync(join(tmpdir(), "tc-adr-wall-"));
  for (const name of names) writeFileSync(join(dir, name), "# ADR\n");
  const result = spawnSync(process.execPath, [WALL, dir], { encoding: "utf8" });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

// The suggester role's collision (docs/retros/2026-10-04-suggester-role-retro.md):
// a branch picked the next free number from its own stale view, and `main` had
// already taken it. The filenames differ after the number, so git merges both.
test("fails when two ADRs share a number, and names both files", () => {
  const { status, stderr } = runWall([
    "ADR-062-the-assistant-runs-on-eve-and-we-measure-it-ourselves.md",
    "ADR-064-a-suggestion-is-not-planning-state-until-accepted.md",
    "ADR-064-some-other-decision-merged-from-main.md",
  ]);
  assert.equal(status, 1);
  assert.match(stderr, /ADR-064 is used by 2 files/);
  assert.match(stderr, /ADR-064-a-suggestion-is-not-planning-state-until-accepted\.md/);
  assert.match(stderr, /ADR-064-some-other-decision-merged-from-main\.md/);
  assert.match(stderr, /next free number \(ADR-065\)/);
});

test("accepts distinct numbers, and main's grandfathered ADR-063 pair", () => {
  const { status, stdout } = runWall([
    "ADR-001-event-sourced-modular-monolith.md",
    "ADR-063-signup-is-open.md",
    "ADR-063-the-public-library-is-cached-for-a-day.md",
    "ADR-064-a-suggestion-is-not-planning-state-until-accepted.md",
  ]);
  assert.equal(status, 0, stdout);
  assert.match(stdout, /4 files scanned/);
});

// The allow-list names files, not a number. Grandfathering "063" as a number
// would wave through the next branch that picks it too.
test("fails a third file taking a grandfathered number", () => {
  const { status, stderr } = runWall([
    "ADR-063-signup-is-open.md",
    "ADR-063-the-public-library-is-cached-for-a-day.md",
    "ADR-063-a-third-decision.md",
  ]);
  assert.equal(status, 1);
  assert.match(stderr, /ADR-063 is used by 3 files/);
});
