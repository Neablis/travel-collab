// One version of each tool, declared once (KI-2026-09-02-a, KI-2026-09-08-b).
//
// Both of those entries are the same defect: a second declaration of a tool
// version that nothing kept in step with the first. `apps/web/package.json`
// carried `packageManager: pnpm@10.28.0` beside the root's `pnpm@11.25.0`, and
// Vercel, whose project root is `apps/web`, installed and built with 10.28
// while CI and every laptop used 11 ("Done in 7.4s using pnpm v10.28.0" in the
// build log, 2026-09-23). Node was 22 in CI and 24 on Vercel for the same
// reason. These tests pin the single-source rule so a third copy fails `pnpm
// test` rather than a production build.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..", "..");
const readJson = (p) => JSON.parse(readFileSync(join(root, p), "utf8"));

/** Every package.json in the workspace, root first, as repo-relative paths. */
function workspaceManifests() {
  const out = ["package.json"];
  for (const group of ["apps", "packages"]) {
    for (const name of readdirSync(join(root, group))) {
      const p = join(group, name, "package.json");
      if (existsSync(join(root, p))) out.push(p);
    }
  }
  return out;
}

const workflowDir = join(root, ".github", "workflows");
const workflows = readdirSync(workflowDir)
  .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
  .map((f) => [f, readFileSync(join(workflowDir, f), "utf8")]);

test("only the root package.json declares packageManager", () => {
  const declaring = workspaceManifests().filter((p) => readJson(p).packageManager !== undefined);
  assert.deepEqual(declaring, ["package.json"]);
  assert.match(readJson("package.json").packageManager, /^pnpm@\d+\.\d+\.\d+/);
});

test("pnpm/action-setup reads packageManager rather than naming a version", () => {
  for (const [file, text] of workflows) {
    // A `version:` input on the action overrides packageManager, and is how
    // a workflow would quietly pin a different pnpm again.
    const blocks = text.split(/\n\s*- /).filter((b) => b.includes("pnpm/action-setup"));
    for (const block of blocks) {
      assert.doesNotMatch(block, /^\s*version:/m, `${file} pins a pnpm version on action-setup`);
    }
  }
});

test("every engines.node, and every setup-node step, agrees with .nvmrc", () => {
  const pinned = readFileSync(join(root, ".nvmrc"), "utf8").trim();
  assert.match(pinned, /^\d+$/, ".nvmrc should hold a bare major");
  for (const p of workspaceManifests()) {
    const engines = readJson(p).engines?.node;
    if (engines === undefined) continue;
    assert.equal(engines, `${pinned}.x`, `${p} engines.node`);
  }
  let steps = 0;
  for (const [file, text] of workflows) {
    for (const block of text.split(/\n\s*- /).filter((b) => b.includes("actions/setup-node"))) {
      steps++;
      assert.match(block, /node-version-file:\s*\.nvmrc/, `${file}: setup-node must read .nvmrc`);
      assert.doesNotMatch(block, /node-version:\s/, `${file}: setup-node names a literal version`);
    }
  }
  assert.ok(steps > 0, "found no setup-node steps; the parse above is wrong, not the repo");
});
