import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "arch-baseline.mjs",
);

// Two entries lifted from what bare `depcruise-baseline` wrote on 2026-09-25
// (KI-2026-09-25-e): a warn-level folder cycle the config promises to print on
// every run, next to an error-level file violation of the kind a baseline is
// for. Only the second belongs in the file.
const WARN_FOLDER_CYCLE = {
  type: "cycle",
  from: "apps/web/src/server/billing",
  to: "apps/web/src/server/entitlements",
  rule: { severity: "warn", name: "no-folder-cycle-known" },
  cycle: [
    { name: "apps/web/src/server/entitlements", dependencyTypes: [] },
    { name: "apps/web/src/server/billing", dependencyTypes: [] },
  ],
};
const ERROR_DEPENDENCY = {
  type: "dependency",
  from: "apps/web/src/server/billing/admin.ts",
  to: "apps/web/src/server/entitlements/grants.ts",
  rule: { severity: "error", name: "billing-imports-no-entitlements" },
};

/** Runs the script over `violations` as a --from fixture; returns what it wrote. */
function filterFixture(violations) {
  const dir = mkdtempSync(join(tmpdir(), "tc-arch-baseline-"));
  const from = join(dir, "raw.json");
  const out = join(dir, "known.json");
  writeFileSync(from, JSON.stringify(violations));
  const result = spawnSync(
    process.execPath,
    [SCRIPT, "--from", from, "--output-to", out],
    {
      encoding: "utf8",
    },
  );
  assert.equal(result.status, 0, result.stderr);
  return { written: readFileSync(out, "utf8"), stdout: result.stdout };
}

test("keeps error-severity violations and leaves warn-level cycles out", () => {
  const { written, stdout } = filterFixture([
    ERROR_DEPENDENCY,
    WARN_FOLDER_CYCLE,
  ]);
  assert.deepEqual(JSON.parse(written), [ERROR_DEPENDENCY]);
  assert.match(
    stdout,
    /1 error-severity violation\(s\).*1 warn\/info-level left out/,
  );
});

test("a run with only warnings writes the empty baseline the repo commits", () => {
  const { written } = filterFixture([WARN_FOLDER_CYCLE]);
  assert.equal(written, "[]\n");
});
