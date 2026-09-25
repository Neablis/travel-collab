import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// KI-2026-09-25-g: two copies of the drag-and-drop core broke auto-scroll with
// every test green. These fixtures are trimmed from the real lockfile before
// and after KI-2026-09-25-c's bump.
const WALL = join(dirname(fileURLToPath(import.meta.url)), "..", "check-singletons.mjs");

function lockfile(pdndVersions) {
  const entry = (version) => [
    `  '@atlaskit/pragmatic-drag-and-drop@${version}':`,
    `    resolution: {integrity: sha512-fixture}`,
    ``,
  ];
  return [
    `lockfileVersion: '9.0'`,
    ``,
    `importers:`,
    ``,
    `  apps/web:`,
    `    dependencies:`,
    `      '@atlaskit/pragmatic-drag-and-drop':`,
    `        specifier: ^${pdndVersions[0]}`,
    `        version: ${pdndVersions[0]}`,
    ``,
    `packages:`,
    ``,
    ...pdndVersions.flatMap(entry),
    `  react-dom@19.2.8:`,
    `    resolution: {integrity: sha512-fixture}`,
    ``,
    `  react@19.2.8:`,
    `    resolution: {integrity: sha512-fixture}`,
    ``,
    `snapshots:`,
    ``,
    `  react-dom@19.2.8(react@19.2.8):`,
    `    dependencies:`,
    `      react: 19.2.8`,
    ``,
  ].join("\n");
}

function runWall(text) {
  const dir = mkdtempSync(join(tmpdir(), "tc-singleton-wall-"));
  try {
    const path = join(dir, "pnpm-lock.yaml");
    writeFileSync(path, text);
    const result = spawnSync(process.execPath, [WALL, path], { encoding: "utf8" });
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("fails when the lockfile holds two versions of the drag-and-drop core, naming both", () => {
  const { status, stderr } = runWall(lockfile(["2.0.2", "3.1.0"]));
  assert.equal(status, 1);
  assert.match(stderr, /@atlaskit\/pragmatic-drag-and-drop → 2\.0\.2, 3\.1\.0/);
});

test("passes when every singleton has exactly one version", () => {
  const { status, stdout } = runWall(lockfile(["3.1.0"]));
  assert.equal(status, 0);
  assert.match(stdout, /singleton check OK/);
});

test("fails rather than passing vacuously when it can find no packages at all", () => {
  const { status, stderr } = runWall(`lockfileVersion: '10.0'\n\nsomethingElse:\n  x: y\n`);
  assert.equal(status, 1);
  assert.match(stderr, /found no packages/);
});
