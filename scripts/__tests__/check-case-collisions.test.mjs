import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// KI-2026-09-05-s: this wall had never been shown to fail. It shipped in `pnpm lint`
// asserting the KI-33 invariant (no two tracked paths differing only in case) and
// nothing anywhere demonstrated it against a violation — the same species as KI-51,
// where the colour wall turned out to be blind to untracked files.
const WALL = join(dirname(fileURLToPath(import.meta.url)), "..", "check-case-collisions.mjs");

// The wall reads `git ls-files` from its own cwd and takes no argument, so the sandbox
// has to be a real git repository. It cannot be a copy of THIS repo: the collisions it
// exists to catch cannot be created in the working tree on macOS APFS or Windows NTFS —
// which is precisely why KI-33 was invisible to every developer machine's `ls` and had
// to be found in the index. `update-index --cacheinfo` writes index entries directly,
// so the fixture works identically on a case-insensitive and a case-sensitive filesystem.
function repoWith(trackedPaths, { untracked = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "tc-case-wall-"));
  const git = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
  git("init", "-q");
  if (trackedPaths.length > 0) {
    const blob = execFileSync("git", ["hash-object", "-w", "--stdin"], {
      cwd: dir,
      input: "fixture\n",
      encoding: "utf8",
    }).trim();
    for (const path of trackedPaths) git("update-index", "--add", "--cacheinfo", `100644,${blob},${path}`);
  }
  for (const [name, source] of Object.entries(untracked)) writeFileSync(join(dir, name), source);
  return dir;
}

function runWall(trackedPaths, options) {
  const dir = repoWith(trackedPaths, options);
  try {
    const result = spawnSync(process.execPath, [WALL], { cwd: dir, encoding: "utf8" });
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// The shape the wall does catch: two tracked paths whose only difference is letter case.
// On macOS APFS and Windows NTFS these are ONE file, and which content the module graph
// gets depends on which landed first — the KI-33 failure mode.
test("fails on two paths differing only in case, naming both sides and how to fix it", () => {
  const { status, stderr } = runWall([
    "apps/web/src/components/trip/UnscheduledRack.tsx",
    "apps/web/src/components/trip/unscheduledRack.tsx",
  ]);
  assert.equal(status, 1);
  assert.match(stderr, /case-only collision:/);
  // Both sides, not just the one that sorted first — a message naming one file leaves
  // the reader guessing which other path it collided with.
  assert.match(stderr, /apps\/web\/src\/components\/trip\/UnscheduledRack\.tsx/);
  assert.match(stderr, /apps\/web\/src\/components\/trip\/unscheduledRack\.tsx/);
  assert.match(stderr, /Rename one/);
});

test("catches a collision that differs only in the directory's case, not the basename's", () => {
  const { status, stderr } = runWall(["src/Trip/day.ts", "src/trip/day.ts"]);
  assert.equal(status, 1);
  assert.match(stderr, /src\/Trip\/day\.ts {2}↔ {2}src\/trip\/day\.ts/);
});

test("reports every colliding group, not just the first", () => {
  const { status, stderr } = runWall(["A.ts", "a.ts", "b/B.ts", "b/b.ts"]);
  assert.equal(status, 1);
  assert.equal(stderr.match(/case-only collision:/g).length, 2);
});

// SCOPE, the half a fixture alone cannot show: what the wall must NOT flag.
test("passes a repo whose paths differ by more than case, and counts what it scanned", () => {
  const { status, stdout } = runWall(["src/Trip.tsx", "src/trip/fitIntoDay.ts", "README.md"]);
  assert.equal(status, 0);
  assert.match(stdout, /case collision check OK \(3 paths\)/);
});

// `Foo.ts` and `foo.ts` in DIFFERENT directories are two distinct paths on every
// filesystem — the comparison is over whole paths, not basenames. A wall that compared
// basenames would fire on most of this repo.
test("does not flag the same basename in two different directories", () => {
  const { status, stdout } = runWall(["src/server/Trip.ts", "src/components/trip.ts"]);
  assert.equal(status, 0, stdout);
});

// SCOPE, closed by KI-2026-09-05-s's follow-up: the wall previously read a plain
// `git ls-files`, so a collision introduced by an untracked file was invisible until it
// was committed — the KI-51 blind spot. It now reads `--cached --others
// --exclude-standard`. An untracked file therefore counts toward the scan.
//
// NOTE the pair itself cannot be built in this test's working tree: on macOS APFS and
// Windows NTFS `Alpha.ts` and `alpha.ts` ARE one file, which is the whole reason KI-33
// was invisible locally. So the tracked side is injected via `update-index --cacheinfo`
// and the untracked side asserts reach (the count), not detection.
test("reaches untracked files, so an uncommitted path counts toward the scan", () => {
  const { status, stdout } = runWall(["Trip.ts"], { untracked: { "other.ts": "// not added\n" } });
  assert.equal(status, 0);
  assert.match(stdout, /2 paths/, "the untracked file must be counted, not skipped");
});

// RED-FIRST FIXTURE for the behaviour that replaced this file's former characterisation
// test. The wall now compares MODULE SPECIFIERS as well as whole paths, so KI-33's own
// pair — cited in the wall's header comment and, until now, not caught by it — fails.
// `@/components/trip/UnscheduledRack` resolves extension-last, so both files answer to
// one specifier on a case-insensitive filesystem.
test("catches the KI-33 pair itself: differing extensions no longer defeat the comparison", () => {
  const { status, stderr } = runWall([
    "apps/web/src/components/trip/UnscheduledRack.tsx",
    "apps/web/src/components/trip/unscheduledRack.ts",
  ]);
  assert.equal(status, 1, "the pair the wall exists to catch must fail it");
  assert.match(stderr, /UnscheduledRack\.tsx/);
  assert.match(stderr, /unscheduledRack\.ts/);
});

// The narrowing that makes the specifier comparison safe: `foo.ts` + `foo.tsx` share a
// specifier but differ in NO case, and `index.ts` + `index.css` are not both resolvable
// from one extensionless specifier. Neither is this wall's business; flagging either
// would be the false positive that made this fix look risky.
test("does not flag an extension ambiguity, or a non-module file sharing a stem", () => {
  assert.equal(runWall(["a/foo.ts", "a/foo.tsx"]).status, 0, "same specifier, no case difference");
  assert.equal(runWall(["a/index.ts", "a/index.css"]).status, 0, "css is not specifier-reachable");
});

// A pure-case pair with matching extensions trips BOTH comparisons; it must be reported
// once, not twice.
test("reports a pair caught by both comparisons exactly once", () => {
  const { status, stderr } = runWall(["a/Bar.ts", "a/bar.ts"]);
  assert.equal(status, 1);
  assert.equal(stderr.match(/case-only collision:/g).length, 1);
});
