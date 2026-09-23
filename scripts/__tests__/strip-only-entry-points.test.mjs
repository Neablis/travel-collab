// Every `.ts` entry point this repo runs under plain `node` must LOAD under
// plain `node` (KI-2026-09-23-f).
//
// Node runs `.ts` by stripping types, not by compiling them. It refuses any
// construct that emits code: parameter properties, `enum`, `namespace`,
// `import x = require()`. It refuses them for the whole module, at load time.
// Typecheck, ESLint, Vitest and `next build` all COMPILE TypeScript, so every
// one of them accepts these constructs. That is how
// `constructor(readonly ref: string)` in `server/entitlements/planVersions.ts`
// (#174) broke the production content import for nine days without one red
// check: the import workflow is dispatched by hand, and nothing else ran the
// file the way it runs.
//
// So this test runs each entry point the way it is run: `process.execPath`,
// which CI pins to Node 22, with the real flags, against the real import graph.
// A lint rule could approximate "what those scripts reach", but it would have
// to be told the graph. Spawning the entry point IS the graph.
//
// Each entry point is pointed at something that cannot answer: an unreachable
// DATABASE_URL, an unreachable web server, no geocoder key. So each run is
// either a dry run that writes nothing, or a failure that stops at the first
// piece of I/O. Either way it proves module load got past every file.
//
// The second test keeps the list honest. It reads every `node … x.ts`
// invocation out of the package.json scripts and the workflows, and fails if
// one is missing here. A new entry point cannot join the list by being
// forgotten.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const WEB = join(ROOT, "apps", "web");

// Port 1 on loopback: nothing listens there, so every connection is refused
// at once. There is no timeout to wait on, and nothing can be written anywhere.
const UNREACHABLE_DB = "postgres://nobody@127.0.0.1:1/none";
const UNREACHABLE_WEB = "http://127.0.0.1:1";

const LOADER = ["--import", "./scripts/lib/ts-resolve-register.mjs"];

/**
 * Entry points, keyed by path relative to `apps/web`, the cwd every one of
 * them is run from. `expect` is what a run that got past module load looks
 * like. A strip-only failure never produces it, because it dies before line
 * one of the entry point executes.
 */
const ENTRY_POINTS = {
  // .github/workflows/import-content-production.yml, the Import step.
  "scripts/import-content-production.ts": {
    args: [...LOADER, "scripts/import-content-production.ts", "--dry-run"],
    expect: { status: 0, output: /DRY RUN — nothing will be written/ },
  },
  // `content:verify` (and `content:import`, which is the same file).
  "scripts/import-content.ts": {
    args: ["scripts/import-content.ts", "--dry-run"],
    expect: { status: 0, output: /Dry run: nothing written\./ },
  },
  // `db:seed`. It has no dry run. It talks HTTP to a dev server, so an
  // unreachable one makes it fail on its first fetch, after load.
  "scripts/db-seed.ts": {
    args: ["scripts/db-seed.ts"],
    expect: { status: 1, output: /seed failed: fetch failed/ },
  },
  // Run by hand, never by CI. It is here because it is the same shape of
  // script and would break the same way; without a key it throws before
  // touching the vendor.
  "scripts/geocode-japan-seed.mts": {
    args: ["scripts/geocode-japan-seed.mts"],
    expect: { status: 1, output: /LOCATIONIQ_API_KEY is not set/ },
  },
};

/**
 * Runs one entry point from `apps/web` with every outward-facing variable
 * pointed at nothing.
 */
function run(args) {
  const res = spawnSync(process.execPath, args, {
    cwd: WEB,
    encoding: "utf8",
    timeout: 60_000,
    env: {
      ...process.env,
      DATABASE_URL: UNREACHABLE_DB,
      WEB_BASE_URL: UNREACHABLE_WEB,
      BASE_URL: UNREACHABLE_WEB,
      LOCATIONIQ_API_KEY: "",
      NODE_OPTIONS: "",
    },
  });
  return { status: res.status, output: `${res.stdout}\n${res.stderr}` };
}

for (const [entry, { args, expect }] of Object.entries(ENTRY_POINTS)) {
  test(`${entry} loads under plain node (strip-only TypeScript)`, () => {
    const { status, output } = run(args);
    // Named first and separately, so the failure says WHICH construct and
    // WHICH file, rather than just "expected 0, got 1".
    const strip = output.match(/^file:\/\/\S+:\d+[\s\S]*?ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX[^\n]*/m);
    assert.equal(strip, null, `${entry} failed at module load under strip-only node:\n${strip?.[0]}`);
    assert.match(output, expect.output, `${entry} did not get past module load:\n${output}`);
    assert.equal(status, expect.status, `${entry} exited ${status}:\n${output}`);
  });
}

/** Paths of `.ts`/`.mts` files a shell command runs with `node`. */
function nodeTsTargets(command) {
  const targets = [];
  for (const segment of command.replace(/\\\n/g, " ").split(/&&|\|\||;|\n/)) {
    if (!/(^|\s)node\s/.test(segment)) continue;
    for (const token of segment.split(/\s+/)) {
      if (/\.m?ts$/.test(token)) targets.push(token.replace(/^\.\//, ""));
    }
  }
  return targets;
}

test("every node-run .ts entry point in package.json and the workflows is covered above", () => {
  const found = new Map();
  const note = (target, where) => found.set(target, [...(found.get(target) ?? []), where]);

  const manifests = [
    "package.json",
    "apps/web/package.json",
    ...readdirSync(join(ROOT, "packages")).map((p) => `packages/${p}/package.json`),
  ];
  for (const manifest of manifests) {
    let scripts;
    try {
      scripts = JSON.parse(readFileSync(join(ROOT, manifest), "utf8")).scripts ?? {};
    } catch {
      continue;
    }
    for (const [name, command] of Object.entries(scripts)) {
      for (const target of nodeTsTargets(command)) note(target, `${manifest} "${name}"`);
    }
  }

  const workflows = join(ROOT, ".github", "workflows");
  for (const file of readdirSync(workflows).filter((f) => /\.ya?ml$/.test(f))) {
    for (const target of nodeTsTargets(readFileSync(join(workflows, file), "utf8"))) {
      note(target, `.github/workflows/${file}`);
    }
  }

  // Sanity: the scan must at least see the invocation that motivated it, or
  // it is matching nothing and this test proves nothing.
  assert.ok(found.has("scripts/import-content-production.ts"), "the scan found no workflow invocation");

  const missing = [...found].filter(([target]) => !(target in ENTRY_POINTS));
  assert.deepEqual(
    missing,
    [],
    `node runs these .ts files but ENTRY_POINTS does not cover them. Add each one with an ` +
      `invocation that loads its whole graph and writes nothing:\n` +
      missing.map(([t, w]) => `  ${t}  (${w.join(", ")})`).join("\n"),
  );
});
