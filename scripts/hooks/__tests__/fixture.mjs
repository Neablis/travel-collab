import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HOOKS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

// A real git repo, because the hooks locate the run directory via
// `git rev-parse --path-format=absolute --git-common-dir`. Mocking that away
// would leave the piece most likely to be wrong untested. realpathSync because
// macOS resolves /var to /private/var, and the hooks compare resolved paths.
export function makeRepo() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "tc-protocol-")));
  execFileSync("git", ["init", "-q"], { cwd: root });
  return root;
}

export function makeLooseDir() {
  return realpathSync(mkdtempSync(join(tmpdir(), "tc-nogit-")));
}

export function makeUnitDir(root, name) {
  const dir = join(root, "units", name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function writeManifest(root, manifest) {
  const dir = join(root, ".claude", "run", manifest.runId);
  mkdirSync(join(dir, "notes"), { recursive: true });
  mkdirSync(join(dir, "reports"), { recursive: true });
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
  return dir;
}

export function writeAdapter(root, adapter) {
  const dir = join(root, ".claude", "protocol");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "adapter.json"), JSON.stringify(adapter, null, 2));
  return dir;
}

export function runHook(name, payload) {
  return runHookRaw(name, JSON.stringify(payload));
}

// For tests that need to send stdin a hook's own `parseStdin` cannot parse.
// `runHook` always JSON.stringifies its payload, so it can never produce
// genuinely malformed input — this sends `rawInput` through untouched.
export function runHookRaw(name, rawInput) {
  const res = spawnSync(process.execPath, [join(HOOKS_DIR, name)], {
    input: rawInput,
    encoding: "utf8",
  });
  let json = null;
  try {
    json = res.stdout.trim() ? JSON.parse(res.stdout) : null;
  } catch {
    json = null;
  }
  return { status: res.status, stdout: res.stdout, stderr: res.stderr, json };
}

export function decision(res) {
  return res.json?.hookSpecificOutput?.permissionDecision ?? null;
}
