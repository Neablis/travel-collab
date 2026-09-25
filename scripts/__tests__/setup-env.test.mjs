import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "..", "setup-env.mjs");

/**
 * Lays out a throwaway repo — `.env.example`, `scripts/setup-env.mjs`, an
 * empty `apps/web/` — and runs the real script in it. The script resolves both
 * paths from its own location, so a copy of it bootstraps the temp tree and
 * never the checkout running the test.
 */
function runSetup(example, existingLocal) {
  const root = mkdtempSync(join(tmpdir(), "tc-setup-env-"));
  mkdirSync(join(root, "scripts"));
  mkdirSync(join(root, "apps", "web"), { recursive: true });
  copyFileSync(SCRIPT, join(root, "scripts", "setup-env.mjs"));
  writeFileSync(join(root, ".env.example"), example);
  const localPath = join(root, "apps", "web", ".env.local");
  if (existingLocal !== undefined) writeFileSync(localPath, existingLocal);
  const result = spawnSync(process.execPath, [join(root, "scripts", "setup-env.mjs")], {
    encoding: "utf8",
  });
  return { status: result.status, stdout: result.stdout, local: readFileSync(localPath, "utf8") };
}

/** The value `.env.local` assigns to `API_TOKEN_PEPPER`, or undefined if no such line. */
function pepperOf(local) {
  return local.match(/^API_TOKEN_PEPPER=(.*)$/m)?.[1];
}

const EXAMPLE = [
  "# A comment that mentions API_TOKEN_PEPPER= and must survive verbatim.",
  "DATABASE_URL=postgres://travel:travel@localhost:5433/travel",
  "API_TOKEN_PEPPER=",
  "LOCATIONIQ_API_KEY=",
  "",
].join("\n");

// KI-2026-09-19-a: `.env.example` ships the pepper blank, the old script copied
// it verbatim, and every fresh worktree then failed 86 integration tests and the
// M22 e2e spec with ApiTokenPepperMissingError.
test("fills a blank API_TOKEN_PEPPER with a generated key, and changes nothing else", () => {
  const { status, local } = runSetup(EXAMPLE);
  assert.equal(status, 0);
  const pepper = pepperOf(local);
  assert.ok(pepper, `expected a non-empty pepper, .env.local had:\n${local}`);
  // 32 random bytes, base64: 44 characters.
  assert.match(pepper, /^[A-Za-z0-9+/]{43}=$/);
  // Every other line — the comment naming the variable included — is the
  // example's own, so the only difference is the one value.
  assert.equal(local.replace(`API_TOKEN_PEPPER=${pepper}`, "API_TOKEN_PEPPER="), EXAMPLE);
});

test("two bootstraps never share a key, so none can be a fixed or committed one", () => {
  const first = pepperOf(runSetup(EXAMPLE).local);
  const second = pepperOf(runSetup(EXAMPLE).local);
  assert.ok(first && second);
  assert.notEqual(first, second);
  // And neither is anything written in the repository's own example file.
  const realExample = readFileSync(join(dirname(SCRIPT), "..", ".env.example"), "utf8");
  assert.ok(!realExample.includes(first));
});

test("leaves a pepper that already has a value exactly as it is", () => {
  // Line-anchored: a plain string replace would hit the comment line first.
  const example = EXAMPLE.replace(/^API_TOKEN_PEPPER=$/m, "API_TOKEN_PEPPER=a-real-value");
  assert.match(example, /^API_TOKEN_PEPPER=a-real-value$/m);
  const { status, local } = runSetup(example);
  assert.equal(status, 0);
  assert.equal(local, example);
});

// KI-2026-09-05-m: this printed `db:reseed` before `dev` and never migrated, so
// following it on a fresh database died twice — no schema, then no server for
// the seed to POST through. It must match README's order.
test("prints the fresh-database recipe in the order that works: migrate, dev, then reseed", () => {
  const { status, stdout } = runSetup(EXAMPLE);
  assert.equal(status, 0);
  const at = (script) => stdout.indexOf(`pnpm --filter web ${script} `);
  assert.ok(at("db:migrate") >= 0, `no db:migrate step in:\n${stdout}`);
  assert.ok(at("db:migrate") < at("dev"), `dev before migrate in:\n${stdout}`);
  assert.ok(at("dev") < at("db:reseed"), `db:reseed before dev in:\n${stdout}`);
});

test("never rewrites an existing .env.local, and says so when its pepper is blank", () => {
  const existing = "DATABASE_URL=postgres://mine\nAPI_TOKEN_PEPPER=\n";
  const { status, stdout, local } = runSetup(EXAMPLE, existing);
  assert.equal(status, 0);
  assert.equal(local, existing);
  assert.match(stdout, /already exists/);
  assert.match(stdout, /API_TOKEN_PEPPER is blank/);
});
