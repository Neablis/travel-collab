import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const WALL = join(dirname(fileURLToPath(import.meta.url)), "..", "check-ki-citations.mjs");

/**
 * Writes a fixture repo and runs the wall against it.
 *
 * The wall refuses to pass on a register it cannot believe it indexed (fewer
 * than 50 entries), so every fixture is padded with filler entries. That floor
 * is the point — a wall that checks nothing passes silently — and padding is
 * what lets a fixture exercise the real rule without disabling it.
 */
function runWall(files) {
  const dir = mkdtempSync(join(tmpdir(), "tc-ki-cite-"));
  for (let i = 1; i <= 60; i += 1) {
    // Each filler needs a DISTINCT id: the wall keys entries by id, so a batch
    // sharing one collapses to a single map entry and trips the index floor.
    // The first draft used `i % 10` for the day and produced ten — which failed
    // every should-pass case with the floor's message, not the rule's.
    const name = `docs/known-issues/open/KI-202601${String(i).padStart(2, "0")}-a-filler.md`;
    files[name] ??= `### KI-filler — a symptom\n\n- **Severity:** cleanup\n- **Area:** \`somewhere.ts\`\n- **Symptom:** x\n`;
  }
  for (const [name, source] of Object.entries(files)) {
    const path = join(dir, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, source);
  }
  const result = spawnSync(process.execPath, [WALL, dir], { encoding: "utf8" });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** The real entry, reduced to the field the wall reads. */
const PREVIEW_ENTRY = `### KI-2026-09-16-d — an exit-gate box cannot be walked on a preview

- **Severity:** process
- **Area:** the Vercel **Preview** environment's \`ADMIN_USER_IDS\`;
  \`apps/web/src/server/entitlements/requireAdmin.ts\`
- **Symptom:** \`POST /api/admin/grants\` answers 404.
`;

// **The exact incident, 2026-09-19.** Three status files said M22's open gate
// box was blocked on `API_TOKEN_PEPPER`, each citing an entry that is about
// `ADMIN_USER_IDS` and has never mentioned the pepper. The wrong name survived
// three days and was copied into two more places, because three documents
// agreeing looks like corroboration.
test("fails when a status file names a variable the cited entry is not about", () => {
  const { status, stderr } = runWall({
    "docs/known-issues/open/KI-20260916-d-a-tier-gated-box.md": PREVIEW_ENTRY,
    "TODO.md":
      "The one open box needs a browser walk on a preview, which needs `API_TOKEN_PEPPER` set there (`KI-2026-09-16-d`).\n",
  });
  assert.equal(status, 1);
  assert.match(stderr, /API_TOKEN_PEPPER/);
  assert.match(stderr, /absent from KI-20260916-d/);
  // The offending sentence is quoted, because "somewhere in TODO.md" is not
  // actionable in a 1,400-line file.
  assert.match(stderr, /browser walk on a preview/);
});

test("passes when the status file names the variable the entry IS about", () => {
  const { status, stdout } = runWall({
    "docs/known-issues/open/KI-20260916-d-a-tier-gated-box.md": PREVIEW_ENTRY,
    "TODO.md": "The box is blocked on `ADMIN_USER_IDS` (`KI-2026-09-16-d`).\n",
  });
  assert.equal(status, 0);
  assert.match(stdout, /ki citation wall OK/);
});

// **The defeat this wall was nearly shipped with.** Correcting the incident
// meant writing the wrong variable's name INTO the entry, as a note saying it
// is not the cause. A whole-body match then finds the string and passes the
// association the entry exists to deny — measured, not predicted: the first
// draft did exactly that and reported the live bug as clean.
test("still fails when the entry MENTIONS the variable only to deny it", () => {
  const denial = PREVIEW_ENTRY.replace(
    "- **Symptom:**",
    "- **Correction:** three files said this was about `API_TOKEN_PEPPER`. It is not.\n- **Symptom:**",
  );
  const { status, stderr } = runWall({
    "docs/known-issues/open/KI-20260916-d-a-tier-gated-box.md": denial,
    "TODO.md": "Blocked on `API_TOKEN_PEPPER` (`KI-2026-09-16-d`).\n",
  });
  assert.equal(status, 1);
  assert.match(stderr, /API_TOKEN_PEPPER/);
});

// Both spellings the register uses for one id — dashless in the filename,
// dashed in the heading and in prose.
test("resolves a citation written in either the dashed or dashless form", () => {
  for (const cited of ["KI-2026-09-16-d", "KI-20260916-d"]) {
    const { status, stderr } = runWall({
      "docs/known-issues/open/KI-20260916-d-a-tier-gated-box.md": PREVIEW_ENTRY,
      "TODO.md": `Blocked on \`API_TOKEN_PEPPER\` (\`${cited}\`).\n`,
    });
    assert.equal(status, 1, `expected ${cited} to resolve`);
    assert.match(stderr, /API_TOKEN_PEPPER/);
  }
});

// The window is a sentence, not a paragraph. These files routinely put two
// unrelated subjects in adjacent sentences, and a paragraph window would fire
// on every one of them.
test("does not fire on an identifier in a neighbouring sentence", () => {
  const { status } = runWall({
    "docs/known-issues/open/KI-20260916-d-a-tier-gated-box.md": PREVIEW_ENTRY,
    "TODO.md":
      "The box is blocked on `ADMIN_USER_IDS` (`KI-2026-09-16-d`). Separately, `API_TOKEN_PEPPER` is set everywhere.\n",
  });
  assert.equal(status, 0);
});

// A single screaming segment — `CI`, `ADR`, `M22` — is ordinary prose here and
// would make the wall unusable.
test("ignores single-segment capitals, which are prose in these files", () => {
  const { status } = runWall({
    "docs/known-issues/open/KI-20260916-d-a-tier-gated-box.md": PREVIEW_ENTRY,
    "TODO.md": "CI is green and the ADR is written (`KI-2026-09-16-d`).\n",
  });
  assert.equal(status, 0);
});

// **A substring is not a match** (CodeRabbit, PR #191). `area.includes(id)` let
// an Area naming `LEGACY_ADMIN_USER_IDS` satisfy a claim about
// `ADMIN_USER_IDS` — a false CLEAN report, which for an audit script is the one
// failure mode that matters, since nobody goes looking after a green line.
test("does not let a longer identifier in the Area satisfy a shorter claim", () => {
  const legacy = PREVIEW_ENTRY.replace("`ADMIN_USER_IDS`", "`LEGACY_ADMIN_USER_IDS`");
  const { status, stderr } = runWall({
    "docs/known-issues/open/KI-20260916-d-a-tier-gated-box.md": legacy,
    "TODO.md": "Blocked on `ADMIN_USER_IDS` (`KI-2026-09-16-d`).\n",
  });
  assert.equal(status, 1);
  assert.match(stderr, /ADMIN_USER_IDS/);
});

// **A missing Area is a violation, not a skip** (CodeRabbit, PR #191). Skipping
// it meant a citation to an entry with no `Area:` could carry any claim at all
// and still exit 0 — a hole shaped exactly like the bug this wall exists for.
test("refuses a citation to an entry with no parseable Area field", () => {
  const noArea = "### KI-2026-09-16-d — something\n\n- **Severity:** process\n";
  const { status, stderr } = runWall({
    "docs/known-issues/open/KI-20260916-d-a-tier-gated-box.md": noArea,
    "TODO.md": "Blocked on `ANYTHING_AT_ALL` (`KI-2026-09-16-d`).\n",
  });
  assert.equal(status, 1);
  assert.match(stderr, /no parseable Area field/);
});

// A wall that checks nothing passes silently — the failure mode this repo has
// already paid for twice (a probe asserting zero times, and the lint wall's own
// five empty rows).
test("refuses to pass on a register it cannot have indexed", () => {
  const dir = mkdtempSync(join(tmpdir(), "tc-ki-cite-empty-"));
  mkdirSync(join(dir, "docs/known-issues/open"), { recursive: true });
  writeFileSync(join(dir, "TODO.md"), "nothing to see\n");
  const result = spawnSync(process.execPath, [WALL, dir], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /too few to have worked/);
});
