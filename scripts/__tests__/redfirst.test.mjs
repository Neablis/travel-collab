import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const TOOL = join(dirname(fileURLToPath(import.meta.url)), "..", "redfirst.mjs");

/**
 * A subject file and a "test command" that greps it — enough to exercise every
 * branch without booting a real test runner, and fast enough that the restore
 * guarantee gets asserted on every path rather than the happy one.
 */
function runTool({ subject, replace, with: wth, grep, extra = [] }) {
  const dir = mkdtempSync(join(tmpdir(), "tc-redfirst-"));
  writeFileSync(join(dir, "subject.txt"), subject);
  const result = spawnSync(
    process.execPath,
    [TOOL, "--file", "subject.txt", "--replace", replace, "--with", wth, "--test", `grep -q ${grep} subject.txt`, ...extra],
    { cwd: dir, encoding: "utf8" },
  );
  return {
    status: result.status,
    out: `${result.stdout}${result.stderr}`,
    subject: readFileSync(join(dir, "subject.txt"), "utf8"),
  };
}

test("passes when the mutation turns the command red, and restores the file", () => {
  const r = runTool({ subject: "keeps GOOD here\n", replace: "GOOD", with: "BAD", grep: "GOOD" });
  assert.equal(r.status, 0);
  assert.match(r.out, /RED-FIRST OK/);
  // The whole point: the tree is exactly as it was found.
  assert.equal(r.subject, "keeps GOOD here\n");
});

test("reports SURVIVED — and still restores — when the mutation changes nothing the test sees", () => {
  // The command checks GOOD; the mutation edits an unrelated word, so the
  // command stays green. That is the finding the drill exists to surface.
  const r = runTool({ subject: "keeps GOOD and SPARE\n", replace: "SPARE", with: "OTHER", grep: "GOOD" });
  assert.equal(r.status, 1);
  assert.match(r.out, /SURVIVED/);
  // A survived mutant is the case most likely to leave debris, because the run
  // ends on an error path.
  assert.equal(r.subject, "keeps GOOD and SPARE\n");
});

test("refuses to run when the baseline is already red", () => {
  // Watching a red test stay red proves nothing, and this is the guard the
  // hand-rolled version of this drill routinely skipped.
  const r = runTool({ subject: "no marker here\n", replace: "no", with: "NO", grep: "GOOD" });
  assert.equal(r.status, 2);
  assert.match(r.out, /BASELINE IS RED/);
  assert.equal(r.subject, "no marker here\n");
});

test("refuses a --replace that matches nothing, rather than reporting a false SURVIVED", () => {
  const r = runTool({ subject: "keeps GOOD here\n", replace: "ABSENT", with: "X", grep: "GOOD" });
  assert.equal(r.status, 2);
  assert.match(r.out, /NOTHING TO MUTATE/);
});

test("refuses an ambiguous --replace unless --all says otherwise", () => {
  const twice = { subject: "GOOD and GOOD\n", replace: "GOOD", with: "BAD", grep: "GOOD" };
  const ambiguous = runTool(twice);
  assert.equal(ambiguous.status, 2);
  assert.match(ambiguous.out, /AMBIGUOUS: --replace matches 2 times/);

  const deliberate = runTool({ ...twice, extra: ["--all"] });
  assert.equal(deliberate.status, 0);
  assert.equal(deliberate.subject, "GOOD and GOOD\n");
});
