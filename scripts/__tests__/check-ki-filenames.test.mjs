import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const WALL = join(dirname(fileURLToPath(import.meta.url)), "..", "check-ki-filenames.mjs");

/** Writes `files` (keyed `open/NAME.md`) into a temp register and runs the wall. */
function runWall(files) {
  const dir = mkdtempSync(join(tmpdir(), "tc-ki-wall-"));
  for (const [name, source] of Object.entries(files)) {
    const path = join(dir, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, source);
  }
  const result = spawnSync(process.execPath, [WALL, dir], { encoding: "utf8" });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

const body = (id) => `### ${id} — a symptom, stated in one line\n\n- **Severity:** cleanup\n`;

// The exact mistake this wall was written for, lifted from PR #141: two entries
// filed with the HEADING's dashed date in the filename, by an agent that had
// read the README stating the convention an hour earlier.
test("fails on the dashed-date filename, and says which way round the dashes go", () => {
  const { status, stderr } = runWall({
    "open/KI-2026-09-05-a-caret-sits-behind-a-block-widget.md": body("KI-2026-09-05-a"),
  });
  assert.equal(status, 1);
  assert.match(stderr, /KI-2026-09-05-a-caret-sits-behind-a-block-widget\.md/);
  // Not just "invalid": the message has to carry the corrected name, because
  // the two shapes are the whole difficulty.
  assert.match(stderr, /Rename to KI-20260905-<slug>\.md/);
  assert.match(stderr, /dashes belong in the heading, not the filename/);
});

test("fails when the heading id disagrees with a correct filename", () => {
  // A typo'd date in the heading. The filename sorts correctly, so `ls` looks
  // fine and only a cross-check catches it.
  const { status, stderr } = runWall({
    "open/KI-20260905-c-widget-editor-is-inline.md": body("KI-2026-09-04-c"),
  });
  assert.equal(status, 1);
  assert.match(stderr, /heading says KI-2026-09-04-c, filename implies KI-2026-09-05-c/);
});

test("accepts both id shapes the register actually contains", () => {
  const { status, stdout } = runWall({
    // Date-based, with and without a discriminator.
    "open/KI-20260905-c-widget-editor-is-inline.md": body("KI-2026-09-05-c"),
    "open/KI-20260903-b-notebooks-menu-cites-wrong-reason.md": body("KI-2026-09-03-b"),
    // Legacy numeric: zero-padded in the filename, unpadded in the heading.
    "resolved/KI-095-hot-insertion-points.md": body("KI-95"),
    "dormant/D-001-anchors-domain-kept-ui-retired.md": body("D-1"),
  });
  assert.equal(status, 0);
  assert.match(stdout, /4 entries scanned/);
});

test("does not mistake a slug's first word for a discriminator", () => {
  // `KI-20260902-e-diff-dismissals-uncovered.md` is a real entry: `e` is the
  // discriminator and `diff-dismissals-uncovered` the slug. A greedier parse
  // reads `e-diff` as the discriminator and the heading check goes wrong.
  const { status, stdout } = runWall({
    "open/KI-20260902-e-diff-dismissals-uncovered.md": body("KI-2026-09-02-e"),
  });
  assert.equal(status, 0, stdout);
});

// 2026-09-05 filed all of a-z and needed three more. Two letters is the
// smallest fix, and it applies to the DATE form only.
test("accepts a two-letter discriminator on a date id, once a-z are spent", () => {
  const { status, stdout } = runWall({
    "open/KI-20260905-z-maxlisteners-in-the-e2e-server-output.md": body("KI-2026-09-05-z"),
    "open/KI-20260905-aa-spec23-understates-the-assistants-it-unifies.md": body("KI-2026-09-05-aa"),
    "open/KI-20260905-ab-page-assistant-second-turn-keystrokes.md": body("KI-2026-09-05-ab"),
  });
  assert.equal(status, 0, stdout);
  assert.match(stdout, /3 entries scanned/);
});

// The asymmetry is load-bearing, not an oversight. Seventeen NUMERIC entries
// open their slug with a two-letter word — `ai`, `no`, `tc`, `db` — and reading
// those as discriminators breaches every one of them. All four below are real
// filenames from the register.
test("does not read a numeric id's two-letter first slug word as a discriminator", () => {
  const { status, stdout } = runWall({
    "open/KI-009-ai-model-outputs-validated-ad-hoc.md": body("KI-9"),
    "resolved/KI-035-no-true-area-field-route-place.md": body("KI-35"),
    "resolved/KI-044-tc-page-editor-applied-every-notebook.md": body("KI-44"),
    "resolved/KI-068-db-reset-mjs-truncates-hardcoded-three.md": body("KI-68"),
  });
  assert.equal(status, 0, stdout);
  assert.match(stdout, /4 entries scanned/);
});

test("skips the register's own README rather than reading it as an entry", () => {
  const { status } = runWall({
    "open/README.md": "# not an entry\n",
    "open/KI-20260905-c-widget-editor-is-inline.md": body("KI-2026-09-05-c"),
  });
  assert.equal(status, 0);
});

// KI-2026-08-30-d: merging `main` into a branch stacked on a SQUASH-merged base
// kept `main`'s pre-fix `open/` copies beside the branch's `resolved/` ones,
// with no conflict reported. The first file is a real grandfathered filename
// and the second carries a real grandfathered shared id — the two places the id
// check cannot see — so this fails only if duplicates are checked by basename.
test("fails when one entry sits in two status directories, grandfathered or not", () => {
  const eslint = "KI-20260830-eslint-src-misses-app-root-files.md";
  const coords = "KI-20260906-c-imported-content-carries-no-coordinates.md";
  const { status, stderr } = runWall({
    [`open/${eslint}`]: body("KI-20260830"),
    [`resolved/${eslint}`]: body("KI-20260830"),
    [`open/${coords}`]: body("KI-2026-09-06-c"),
    [`dormant/${coords}`]: body("KI-2026-09-06-c"),
  });
  assert.equal(status, 1);
  assert.match(stderr, /KI-20260830-eslint-src-misses-app-root-files\.md is in open\/ AND resolved\//);
  assert.match(stderr, /KI-20260906-c-imported-content-carries-no-coordinates\.md is in open\/ AND dormant\//);
});

// A stale copy is not a second entry, so it must not get the shared-id remedy:
// "give the newer one the next free letter" would mint a fake entry from it.
test("reports a two-directory duplicate once, not also as a shared id", () => {
  const file = "KI-095-hot-insertion-points.md";
  const { status, stderr } = runWall({
    [`open/${file}`]: body("KI-95"),
    [`resolved/${file}`]: body("KI-95"),
  });
  assert.equal(status, 1);
  assert.match(stderr, /KI-095-hot-insertion-points\.md is in open\/ AND resolved\//);
  assert.doesNotMatch(stderr, /next free letter/);
  assert.match(stderr, /BREACHED: 1 entr/);
});

// Two DIFFERENT entries sharing one id: the name and heading of each agree, so
// the per-file check passes, and "KI-2026-09-16-b" in prose names two things.
// The 2026-09-24 KI pass found eight such ids, all filed by parallel branches
// that each picked the next free letter from their own stale view of `open/`.
test("fails when two entries share one id, across open/ and resolved/", () => {
  const { status, stderr } = runWall({
    "open/KI-20260910-b-the-account-sheet-hides-grants.md": body("KI-2026-09-10-b"),
    "resolved/KI-20260910-b-an-immutability-test-is-missing.md": body("KI-2026-09-10-b"),
  });
  assert.equal(status, 1);
  assert.match(stderr, /KI-2026-09-10-b is used by 2 entries/);
  assert.match(stderr, /KI-20260910-b-the-account-sheet-hides-grants\.md/);
  assert.match(stderr, /KI-20260910-b-an-immutability-test-is-missing\.md/);
});
