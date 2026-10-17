import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseStdin, readAll } from "./lib/run-context.mjs";
import { gitSubcommandArgs, parseShell } from "./lib/shell.mjs";

// PreToolUse hook (matcher: Bash). Before a `git commit`, typechecks the
// workspace packages the commit touches, and blocks (exit 2) with the errors
// if any fail. A commit with no .ts/.tsx file in it costs one `git diff`.
//
// It replaced typecheck-touched-package.mjs, which ran on every Edit|Write:
// measured 14 to 66 s per edit for apps/web (audit 2026-10-16 §7), killed
// silently at the 60 s default hook timeout, and blind in worktrees because it
// resolved paths against the main checkout. Here the root is the git toplevel
// of the session's cwd, the settings entry carries `"timeout": 300`, the
// packages run in parallel, and every skip says why on stderr.
//
// The path -> package mapping and the contracts fan-out are the
// `minimal-check-subset` skill's rules. FAILS OPEN on anything it cannot work
// out: this is a fast early signal, and CI's typecheck is the verdict.

// Every workspace package in `pnpm-workspace.yaml` must appear: an omitted
// package's commits go unchecked and the contracts fan-out skips it.
const PACKAGES = [
  { prefix: "apps/web", name: "web" },
  { prefix: "packages/contracts", name: "@tc/contracts" },
  { prefix: "packages/domain", name: "@tc/domain" },
  { prefix: "packages/factories", name: "@tc/factories" },
  { prefix: "packages/fixtures", name: "@tc/fixtures" },
  { prefix: "packages/pages", name: "@tc/pages" },
  { prefix: "packages/predict", name: "@tc/predict" },
];

const payload = parseStdin(await readAll(process.stdin));
const command = String(payload?.tool_input?.command ?? "");
const cwd = String(payload?.cwd ?? process.cwd());

const segments = parseShell(command);
const commitAt = segments.findIndex((seg) => gitSubcommandArgs(seg, "commit"));
if (commitAt === -1) process.exit(0);
const commitArgs = gitSubcommandArgs(segments[commitAt], "commit");

const git = (args, root) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
const lines = (out) => out.split("\n").filter(Boolean);

let root;
let files;
try {
  root = git(["rev-parse", "--show-toplevel"], cwd).trim();
  files = lines(git(["diff", "--cached", "--name-only", "--diff-filter=d"], root));
  // `git commit -a`, or `git add … && git commit` in one command, commits what
  // is not staged yet when this runs: count the working tree's changes too.
  const commitsAll = commitArgs.some((a) => a === "--all" || /^-[a-zA-Z]*a/.test(a));
  const addsFirst = segments.slice(0, commitAt).some((seg) => gitSubcommandArgs(seg, "add"));
  if (commitsAll || addsFirst) {
    files.push(...lines(git(["diff", "--name-only", "--diff-filter=d"], root)));
    if (addsFirst) files.push(...lines(git(["ls-files", "--others", "--exclude-standard"], root)));
  }
} catch {
  process.exit(0); // not a git checkout, or git failed: git will say so itself
}

const ts = files.filter((f) => /\.(ts|tsx)$/.test(f));
if (ts.length === 0) process.exit(0);

const owners = new Set();
for (const f of ts) {
  const owner = PACKAGES.filter((p) => f.startsWith(`${p.prefix}/`)).sort((a, b) => b.prefix.length - a.prefix.length)[0];
  if (owner) owners.add(owner);
}
// AGENTS.md invariant 5: a contracts change can break every consumer while
// none of their own files changed, so it is the one case that does not narrow.
const targets = ts.some((f) => f.startsWith("packages/contracts/src/")) ? PACKAGES : [...owners];
if (targets.length === 0) process.exit(0);

const cacheDir = join(tmpdir(), "tc-typecheck-hook");
mkdirSync(cacheDir, { recursive: true });

const skipped = [];
const runs = targets.map((pkg) => {
  const pkgDir = join(root, pkg.prefix);
  const tsc = join(pkgDir, "node_modules", ".bin", "tsc");
  if (!existsSync(tsc)) {
    skipped.push(pkg.name);
    return Promise.resolve(null);
  }
  // Build info keyed by checkout as well as package: two worktrees sharing
  // one file would each invalidate the other's cache on every run.
  const key = `${root}-${pkg.name}`.replace(/[^a-z0-9]/gi, "-");
  return new Promise((done) => {
    let out = "";
    const child = spawn(tsc, ["--noEmit", "--incremental", "--tsBuildInfoFile", join(cacheDir, `${key}.tsbuildinfo`)], {
      cwd: pkgDir,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (c) => (out += c));
    child.stderr.on("data", (c) => (out += c));
    child.on("error", (err) => done({ pkg: pkg.name, out: String(err.message ?? err) }));
    // A non-zero exit with no output is still a failure: tsc could not run.
    child.on("close", (code) => done(code === 0 ? null : { pkg: pkg.name, out: out.trim() || `tsc exited ${code}` }));
  });
});
const failures = (await Promise.all(runs)).filter(Boolean);

if (skipped.length > 0) {
  console.error(`typecheck-on-commit: skipped ${skipped.join(", ")} (no node_modules/.bin/tsc in ${root}).`);
}
if (failures.length === 0) process.exit(0);

const report = failures
  .map(({ pkg, out }) => {
    // The first lines identify the break; the rest crowds out the fix.
    const all = out.split("\n");
    const more = all.length > 25 ? `\n… ${all.length - 25} more line(s)` : "";
    return `--- ${pkg} ---\n${all.slice(0, 25).join("\n")}${more}`;
  })
  .join("\n\n");
console.error(
  `Typecheck failed for ${failures.map((f) => f.pkg).join(", ")}; the commit was not made.\n\n${report}\n\n` +
    `Fix these and commit again. To re-run one: pnpm --filter ${failures[0].pkg} typecheck`,
);
process.exit(2);
