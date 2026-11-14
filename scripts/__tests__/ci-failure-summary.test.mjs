import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The wrapper's annotation is the only copy of a red job's cause a cloud
// session can read (KI-2026-10-13-f), so what it keeps from each runner's log
// is the behaviour under test. The logs below are the shape each runner prints;
// the Playwright one is copied from a real `line` reporter run.
const SCRIPT = new URL("../ci-failure-summary.sh", import.meta.url).pathname;

const PLAYWRIGHT_LOG = `Running 2 tests using 1 worker

[1/2] [chromium] › e2e/x.spec.ts:3:1 › a red test names itself
  1) [chromium] › e2e/x.spec.ts:3:1 › a red test names itself ─────────────────────────

    Error: expect(received).toBe(expected) // Object.is equality

    Expected: 3
    Received: 2

[2/2] [chromium] › e2e/x.spec.ts:7:1 › a green neighbour
  1 failed
    [chromium] › e2e/x.spec.ts:3:1 › a red test names itself ──────────────────────────
  1 passed (1.2s)
`;

/** Runs the wrapper over a command that prints `log` and exits `code`. */
function wrap(log, code) {
  const dir = mkdtempSync(join(tmpdir(), "ci-failure-summary-"));
  try {
    const logFile = join(dir, "log.txt");
    writeFileSync(logFile, log);
    const summaryFile = join(dir, "summary.md");
    const run = spawnSync("bash", [SCRIPT, "test / e2e (1/2)", "bash", "-c", `cat "$0"; exit ${code}`, logFile], {
      encoding: "utf8",
      env: { ...process.env, GITHUB_STEP_SUMMARY: summaryFile, RUNNER_TEMP: dir },
    });
    const annotation = run.stdout.split("\n").find((l) => l.startsWith("::error title=test / e2e (1/2) exited")) ?? "";
    return {
      status: run.status,
      message: annotation.replace(/^::error [^:]*::/, "").split("%0A"),
      summary: existsSync(summaryFile) ? readFileSync(summaryFile, "utf8") : null,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("a red Playwright run is annotated with each failing test's title and the tally", () => {
  const { status, message, summary } = wrap(PLAYWRIGHT_LOG, 1);
  assert.equal(status, 1);
  assert.deepEqual(message.slice(0, 4), [
    "  1) [chromium] › e2e/x.spec.ts:3:1 › a red test names itself",
    "    Error: expect(received).toBe(expected) // Object.is equality",
    "  1 failed",
    "    [chromium] › e2e/x.spec.ts:3:1 › a red test names itself",
  ]);
  // A progress line names passing tests too, so it is not a failure line.
  assert.ok(!message.some((l) => l.includes("a green neighbour")), message.join("\n"));
  assert.match(summary, /### test \/ e2e \(1\/2\) exited 1\n```\n {2}1\) \[chromium\] › e2e\/x\.spec\.ts:3:1 › a red test names itself\n/);
});

test("a red vitest run still keeps its FAIL line", () => {
  const { status, message } = wrap(" FAIL  src/a.test.ts > adds\nAssertionError: expected 2 to be 3\n Test Files  1 failed (1)\n", 1);
  assert.equal(status, 1);
  assert.deepEqual(message.slice(0, 3), [" FAIL  src/a.test.ts > adds", "AssertionError: expected 2 to be 3", " Test Files  1 failed (1)"]);
});

test("a green run writes no summary and no annotation, and keeps its exit status", () => {
  const { status, message, summary } = wrap(PLAYWRIGHT_LOG.replace("1 failed", "0 failed"), 0);
  assert.equal(status, 0);
  assert.deepEqual(message, [""]);
  assert.equal(summary, null);
});
