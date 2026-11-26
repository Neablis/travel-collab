import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// M64: production's database is reachable only through an SSH tunnel to the
// box. A workflow that names PRODUCTION_DATABASE_URL without opening the
// tunnel first fails at connect time, on a production run, so the check reads
// the workflow files instead.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CHECK = join(ROOT, "scripts", "check-workflow-tunnel.mjs");

const run = (workflowsDir) =>
  spawnSync("node", [CHECK, workflowsDir], { encoding: "utf8" });

function fixture(files) {
  const dir = mkdtempSync(join(tmpdir(), "tunnel-"));
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
  return dir;
}

const TUNNEL_BARE = `      - uses: ./.github/actions/db-tunnel\n`;
const TUNNEL =
  TUNNEL_BARE +
  `        with:\n          ssh-key: x\n          known-hosts: y\n          host: z\n`;
const USE = `      - run: pnpm --filter web db:state\n        env:\n          DATABASE_URL: \${{ secrets.PRODUCTION_DATABASE_URL }}\n`;
const wf = (steps) => `name: x\non: push\njobs:\n  j:\n    steps:\n${steps}`;

test("a workflow that opens the tunnel before using the secret passes", () => {
  const dir = fixture({ "ok.yml": wf(TUNNEL + USE) });
  const r = run(dir);
  rmSync(dir, { recursive: true });
  assert.equal(r.status, 0, r.stderr);
});

test("a workflow with no tunnel step fails, naming the file", () => {
  const dir = fixture({ "ok.yml": wf(TUNNEL + USE), "missing.yml": wf(USE) });
  const r = run(dir);
  rmSync(dir, { recursive: true });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /missing\.yml/);
  assert.doesNotMatch(r.stderr, /ok\.yml/);
});

test("a tunnel opened after the secret is used does not count", () => {
  const dir = fixture({ "late.yml": wf(USE + TUNNEL) });
  const r = run(dir);
  rmSync(dir, { recursive: true });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /late\.yml/);
});

test("a tunnel in another job does not cover a use in this one", () => {
  const two = `name: x\non: push\njobs:\n  a:\n    steps:\n${TUNNEL}${USE}  b:\n    steps:\n${USE}`;
  const dir = fixture({ "two.yml": two });
  const r = run(dir);
  rmSync(dir, { recursive: true });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /two\.yml \(job b,/);
  assert.doesNotMatch(r.stderr, /job a/);
});

test("a tunnel step that does not pass all three inputs does not count", () => {
  const partial = TUNNEL_BARE + `        with:\n          ssh-key: x\n          host: z\n`;
  const dir = fixture({ "bare.yml": wf(TUNNEL_BARE + USE), "partial.yml": wf(partial + USE) });
  const r = run(dir);
  rmSync(dir, { recursive: true });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /bare\.yml/);
  assert.match(r.stderr, /partial\.yml/);
});

test("PREVIEW_DATABASE_URL is guarded the same way", () => {
  const preview = USE.replace("PRODUCTION_DATABASE_URL", "PREVIEW_DATABASE_URL");
  const dir = fixture({ "p.yml": wf(preview), "q.yml": wf(TUNNEL + preview) });
  const r = run(dir);
  rmSync(dir, { recursive: true });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /p\.yml/);
  assert.doesNotMatch(r.stderr, /q\.yml/);
});

test("a workflow that only mentions the secret in a comment is not checked", () => {
  const dir = fixture({ "c.yml": wf(`      # PRODUCTION_DATABASE_URL lives elsewhere\n      - run: echo hi\n`) });
  const r = run(dir);
  rmSync(dir, { recursive: true });
  assert.equal(r.status, 0, r.stderr);
});

test("migration-pending.yml without its tunnel step fails the real workflows", () => {
  const dir = mkdtempSync(join(tmpdir(), "tunnel-real-"));
  cpSync(join(ROOT, ".github", "workflows"), dir, { recursive: true });
  const path = join(dir, "migration-pending.yml");
  const stripped = readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => !line.includes("./.github/actions/db-tunnel"))
    .join("\n");
  writeFileSync(path, stripped);
  const r = run(dir);
  rmSync(dir, { recursive: true });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /migration-pending\.yml/);
});

test("every workflow in the repo passes", () => {
  const r = run(join(ROOT, ".github", "workflows"));
  assert.equal(r.status, 0, r.stderr);
});
