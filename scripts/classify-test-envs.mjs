// Classifies each apps/web unit test file as needing "node" or "jsdom".
// Phase 0 Task 0.2 of docs/plans/test-overhaul/phase-0-baseline.md: most
// `.ts` unit test files never touch the DOM but still pay ~600ms of jsdom
// construction because vitest.unit.config.ts sets environment: "jsdom" for
// everything under src/**/*.test.{ts,tsx}. This finds the files that don't
// need it, so Phase 1 can environment-split them.
//
// A file needs jsdom if it (transitively, through its own relative imports)
// matches any of:
//   - is a .test.tsx (renders React)
//   - imports @testing-library/*
//   - references document./window./navigator./localStorage
//
// Dependency-free ESM, same style as apps/web/scripts/db-reset.mjs.
//
// Usage:
//   node scripts/classify-test-envs.mjs            # prints "path: node|jsdom" per file
//   node scripts/classify-test-envs.mjs --node-only # prints only node-safe paths, space-joined, for shell interpolation
import { readFileSync } from "node:fs";
import { globSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const webRoot = path.join(repoRoot, "apps/web");
const srcRoot = path.join(webRoot, "src");

const DOM_REFERENCE = /\b(document|window|navigator|localStorage)\./;
const TESTING_LIBRARY_IMPORT = /@testing-library\//;

function needsJsdomDirectly(source, filePath) {
  if (filePath.endsWith(".tsx") && filePath.includes(".test.")) return true;
  if (TESTING_LIBRARY_IMPORT.test(source)) return true;
  if (DOM_REFERENCE.test(source)) return true;
  return false;
}

// Relative-import specifiers only — node_modules packages are covered by
// the direct TESTING_LIBRARY_IMPORT check, and walking into node_modules
// for every test file is neither necessary nor fast.
const IMPORT_RE = /(?:import|export)\s+(?:[^'"]*?\s+from\s+)?["'](\.[^"']+)["']/g;

function resolveImport(fromFile, specifier) {
  const base = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ];
  for (const candidate of candidates) {
    try {
      readFileSync(candidate, "utf8");
      return candidate;
    } catch {
      // try next candidate
    }
  }
  return null;
}

function needsJsdomTransitive(filePath, visited = new Set()) {
  if (visited.has(filePath)) return false;
  visited.add(filePath);

  let source;
  try {
    source = readFileSync(filePath, "utf8");
  } catch {
    return false;
  }

  if (needsJsdomDirectly(source, filePath)) return true;

  for (const match of source.matchAll(IMPORT_RE)) {
    const resolved = resolveImport(filePath, match[1]);
    if (resolved && needsJsdomTransitive(resolved, visited)) return true;
  }
  return false;
}

const testFiles = globSync("**/*.test.{ts,tsx}", { cwd: srcRoot })
  .filter((f) => !f.endsWith(".int.test.ts"))
  .map((f) => path.join(srcRoot, f))
  .sort();

const results = testFiles.map((file) => ({
  file: path.relative(webRoot, file),
  env: needsJsdomTransitive(file) ? "jsdom" : "node",
}));

if (process.argv.includes("--node-only")) {
  console.log(results.filter((r) => r.env === "node").map((r) => r.file).join(" "));
} else {
  for (const r of results) console.log(`${r.env}\t${r.file}`);
  const nodeCount = results.filter((r) => r.env === "node").length;
  console.error(`\n${nodeCount} of ${results.length} files are node-safe.`);
}
