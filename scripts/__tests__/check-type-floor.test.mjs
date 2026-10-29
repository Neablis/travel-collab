import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const WALL = join(dirname(fileURLToPath(import.meta.url)), "..", "check-type-floor.mjs");

/** Writes `files` into a fresh temp dir and runs the wall over it. */
function runWall(files) {
  const dir = mkdtempSync(join(tmpdir(), "tc-type-floor-"));
  for (const [name, source] of Object.entries(files)) {
    const path = join(dir, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, source);
  }
  const result = spawnSync(process.execPath, [WALL, dir], { encoding: "utf8" });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

// The shapes KI-2026-10-05-i found: a class string, a `cn` argument, a
// constant holding classes, and the smaller size by the same route.
test("fails on a size under 12px in a signed-in screen, naming each site", () => {
  const { status, stderr } = runWall({
    "components/ui/settings-card.tsx": 'export const A = () => <div className="px-4 text-2xs uppercase" />;\n',
    "components/ui/day-grid.tsx": 'export const B = (on: boolean) => <span className={cn("text-2xs", on && "x")} />;\n',
    "components/nav/PhoneTabBar.tsx": 'const TAB =\n  "flex gap-1 text-2xs leading-none";\n',
    "components/lenses/Lens.tsx": "export const C = (n: number) => <b className={`text-3xs w-${n}`} />;\n",
  });
  assert.equal(status, 1);
  assert.match(stderr, /settings-card\.tsx:1: text-2xs/);
  assert.match(stderr, /day-grid\.tsx:1: text-2xs/);
  assert.match(stderr, /PhoneTabBar\.tsx:2: text-2xs/);
  assert.match(stderr, /Lens\.tsx:1: text-3xs/);
  assert.match(stderr, /TYPE FLOOR WALL BREACHED: 4 use\(s\)/);
});

// What must stay allowed: the front door, the invite landing, a comment that
// names the token, a longer token that only starts the same, and tests.
test("passes the front door, the invite landing, comments, other tokens and tests", () => {
  const { status, stdout, stderr } = runWall({
    "app/(front)/page.tsx": 'export const F = () => <i className="text-3xs" />;\n',
    "components/front/LandingSea.tsx": 'export const L = () => <i className="text-2xs" />;\n',
    "components/access/InviteLandingScreen.tsx": 'export const I = () => <i className="text-2xs" />;\n',
    "components/ui/avatar.tsx": "// The invite landing is where `text-2xs` is allowed.\nexport const V = () => null;\n",
    "components/ui/other.tsx": 'export const O = () => <i className="text-xs text-2xsish" />;\n',
    "components/ui/Thing.test.tsx": 'expect(el.className).toContain("text-2xs");\n',
  });
  assert.equal(status, 0, stderr);
  assert.match(stdout, /type floor wall OK \(5 files scanned\)/);
});

// The same sizes by other routes (PR 633 review): the custom property, read
// through `var()` or Tailwind's `text-(length:…)`, and an inline font size.
test("fails on the token's custom property and on an inline size under 12px", () => {
  const { status, stderr } = runWall({
    "components/ui/A.tsx": 'export const A = () => <i className="text-(length:--text-2xs)" />;\n',
    "components/ui/B.tsx": 'export const B = { fontSize: "var(--text-3xs)" };\n',
    "components/ui/C.tsx": 'export const C = () => <i style={{ fontSize: "10px" }} />;\n',
    "components/ui/D.tsx": "export const D = { fontSize: 11 };\n",
    "components/ui/E.tsx": 'export const E = { fontSize: "12px", lineHeight: "10px" };\n',
  });
  assert.equal(status, 1);
  assert.match(stderr, /A\.tsx:1: --text-2xs/);
  assert.match(stderr, /B\.tsx:1: --text-3xs/);
  assert.match(stderr, /C\.tsx:1: fontSize 10px/);
  assert.match(stderr, /D\.tsx:1: fontSize 11px/);
  assert.doesNotMatch(stderr, /E\.tsx/);
  assert.match(stderr, /TYPE FLOOR WALL BREACHED: 4 use\(s\)/);
});

// `DiscoverCard` is drawn by the front door's sea too, and only its sea branch
// may go under the floor: a size outside `sea !== null` fails like any other.
test("allows DiscoverCard its sizes on the sea's branch only", () => {
  const { status, stderr } = runWall({
    "components/playbooks/DiscoverCard.tsx": [
      'export const A = (sea: unknown) => cn("px-2", sea !== null ? "text-2xs" : "text-xs");',
      'export const B = (sea: unknown) => cn("w-15", sea !== null && "text-2xs");',
      'export const C = (sea: unknown) => (sea !== null ? <li className="text-2xs" /> : null);',
      'export const D = () => <span className="text-2xs" />;',
      'export const E = (sea: unknown) => (sea !== null ? null : <li className="text-2xs" />);',
      "",
    ].join("\n"),
  });
  assert.equal(status, 1);
  assert.match(stderr, /DiscoverCard\.tsx:4: text-2xs/);
  assert.match(stderr, /DiscoverCard\.tsx:5: text-2xs/);
  assert.match(stderr, /TYPE FLOOR WALL BREACHED: 2 use\(s\)/);
});
