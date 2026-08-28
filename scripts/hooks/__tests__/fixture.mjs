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

// A real linked worktree off `root`, for tests that need to prove a
// resolver picks the CALLING worktree rather than the main checkout —
// `mainCheckout` and `worktreeRoot` return the same directory for `root`
// itself, so only an actual `git worktree add` can tell them apart.
// `git worktree add` needs a real commit to check out, hence the commit
// here rather than in every caller.
export function makeLinkedWorktree(root) {
  writeFileSync(join(root, "README.md"), "root\n");
  execFileSync("git", ["add", "README.md"], { cwd: root });
  execFileSync(
    "git",
    ["-c", "user.email=test@example.com", "-c", "user.name=Test", "commit", "-q", "-m", "init"],
    { cwd: root },
  );
  const parent = realpathSync(mkdtempSync(join(tmpdir(), "tc-protocol-worktree-")));
  const linked = join(parent, "linked");
  execFileSync("git", ["worktree", "add", "-q", linked], { cwd: root });
  return linked;
}

// `options.cwd` matters for hooks that shell out to git from their own working
// directory rather than from a path in the payload — check-destructive-git.mjs
// counts worktrees that way, so its tests must be able to point it at a
// purpose-built repo instead of whatever repo the test runner happens to be in.
export function runHook(name, payload, options = {}) {
  return runHookRaw(name, JSON.stringify(payload), options);
}

// For tests that need to send stdin a hook's own `parseStdin` cannot parse.
// `runHook` always JSON.stringifies its payload, so it can never produce
// genuinely malformed input — this sends `rawInput` through untouched.
export function runHookRaw(name, rawInput, options = {}) {
  const res = spawnSync(process.execPath, [join(HOOKS_DIR, name)], {
    input: rawInput,
    encoding: "utf8",
    cwd: options.cwd,
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
  // A non-zero exit with no parseable JSON on stdout produces the SAME
  // `null` as a successful allow — which is also the expected value in
  // every allow-path test in this suite. Without this check, a hook that
  // crashed instead of allowing would pass those tests silently.
  if (res.status !== 0) {
    throw new Error(`hook exited ${res.status}: ${res.stderr}`);
  }
  return res.json?.hookSpecificOutput?.permissionDecision ?? null;
}
