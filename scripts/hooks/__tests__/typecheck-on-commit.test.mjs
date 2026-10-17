import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeRepo, runHook } from "./fixture.mjs";

// A real repo with stub `tsc` binaries: each records that it ran, and fails
// with compiler-shaped output when its package holds a file named `bad.ts`.
function repoWithPackages(names = ["apps/web", "packages/contracts", "packages/domain"]) {
  const root = makeRepo();
  for (const dir of names) {
    const bin = join(root, dir, "node_modules", ".bin");
    mkdirSync(bin, { recursive: true });
    const tsc = join(bin, "tsc");
    writeFileSync(
      tsc,
      `#!/bin/sh\ntouch ran\nif [ -f bad.ts ]; then echo "bad.ts(1,1): error TS2322: nope"; exit 2; fi\nexit 0\n`,
    );
    chmodSync(tsc, 0o755);
  }
  return root;
}

function stage(root, path, body = "export const x = 1;\n") {
  mkdirSync(join(root, path, ".."), { recursive: true });
  writeFileSync(join(root, path), body);
  execFileSync("git", ["add", path], { cwd: root });
}

const run = (command, cwd) => runHook("typecheck-on-commit.mjs", { tool_input: { command }, cwd });
const ran = (root, dir) => existsSync(join(root, dir, "ran"));

test("a staged type error in a package blocks the commit, naming the package", () => {
  const root = repoWithPackages();
  stage(root, "apps/web/bad.ts");
  const res = run("git commit -m 'feat: x'", root);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /Typecheck failed for web/);
  assert.match(res.stderr, /TS2322/);
});

test("only the packages the commit touches are checked", () => {
  const root = repoWithPackages();
  stage(root, "packages/domain/src/a.ts");
  assert.equal(run("git commit -m x", root).status, 0);
  assert.ok(ran(root, "packages/domain"));
  assert.ok(!ran(root, "apps/web"));
});

test("a contracts change checks every package", () => {
  const root = repoWithPackages();
  stage(root, "packages/contracts/src/a.ts");
  stage(root, "apps/web/bad.ts", "x\n");
  execFileSync("git", ["reset", "-q", "apps/web/bad.ts"], { cwd: root });
  // web holds an unstaged bad.ts, so its stub fails: proof that web ran.
  const res = run("git commit -m x", root);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /web/);
  assert.ok(ran(root, "packages/domain"));
});

test("a commit with no TypeScript in it runs nothing", () => {
  const root = repoWithPackages();
  stage(root, "docs/a.md", "# a\n");
  assert.equal(run("git commit -m docs", root).status, 0);
  assert.ok(!ran(root, "apps/web") && !ran(root, "packages/domain"));
});

test("`git add … && git commit` counts the files about to be added", () => {
  const root = repoWithPackages();
  mkdirSync(join(root, "apps/web"), { recursive: true });
  writeFileSync(join(root, "apps/web/bad.ts"), "x\n");
  assert.equal(run("git add -A && git commit -m x", root).status, 2);
});

test("non-commit commands pass without running anything", () => {
  const root = repoWithPackages();
  stage(root, "apps/web/bad.ts");
  for (const command of ["git status", "git log --grep commit", "echo git commit"]) {
    assert.equal(run(command, root).status, 0, command);
  }
  assert.ok(!ran(root, "apps/web"));
});

test("a package with no tsc installed is skipped out loud, not passed silently", () => {
  const root = repoWithPackages(["apps/web"]);
  stage(root, "packages/domain/src/a.ts");
  const res = run("git commit -m x", root);
  assert.equal(res.status, 0);
  assert.match(res.stderr, /skipped @tc\/domain/);
});
