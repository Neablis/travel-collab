import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";

// PostToolUse hook (matcher: Edit|Write). Typechecks only the workspace
// package that owns the file just edited, so a type error surfaces seconds
// after the edit that caused it rather than at `pnpm check` time or, worse,
// in CI four minutes later.
//
// The path -> package mapping and the contracts hard-exception are the same
// rules the `minimal-check-subset` skill documents; this hook is that skill's
// typecheck step, automated. Runs `tsc --incremental` against a build-info
// file cached outside the repo: ~4s on the first run of a session, ~1.6s
// afterwards, which is the difference between "worth doing on every edit" and
// "too slow to leave on".

const REPO_ROOT = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();

// Longest prefix wins, so order matters only for readability here.
const PACKAGES = [
  { prefix: "apps/web", dir: "apps/web", name: "web" },
  { prefix: "packages/contracts", dir: "packages/contracts", name: "@tc/contracts" },
  { prefix: "packages/domain", dir: "packages/domain", name: "@tc/domain" },
  { prefix: "packages/pages", dir: "packages/pages", name: "@tc/pages" },
  { prefix: "packages/predict", dir: "packages/predict", name: "@tc/predict" },
];

function readStdin() {
  return new Promise((res) => {
    let buf = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (buf += c));
    process.stdin.on("end", () => res(buf));
    // A hook invoked with no stdin at all should be a no-op, not a hang.
    setTimeout(() => res(buf), 2000).unref?.();
  });
}

const raw = await readStdin();

let parsed;
try {
  parsed = JSON.parse(raw || "{}");
} catch {
  process.exit(0);
}

const filePath = parsed?.tool_input?.file_path ?? "";
if (!/\.(ts|tsx)$/.test(filePath)) {
  process.exit(0);
}

const rel = relative(REPO_ROOT, resolve(filePath));
// Edits outside the repo (scratchpad scripts, ~/.claude files) own no package.
if (rel.startsWith("..")) {
  process.exit(0);
}

const owner = PACKAGES.filter((p) => rel.startsWith(`${p.prefix}/`)).sort(
  (a, b) => b.prefix.length - a.prefix.length,
)[0];
if (!owner) {
  process.exit(0);
}

// AGENTS.md invariant #5: a `packages/contracts/src` change can silently break
// domain and web even though their own files did not change, so a contracts
// edit is the one case that does NOT narrow.
const targets = rel.startsWith("packages/contracts/src/") ? PACKAGES : [owner];

const cacheDir = join(tmpdir(), "tc-typecheck-hook");
if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true });

const failures = [];

for (const pkg of targets) {
  const pkgDir = join(REPO_ROOT, pkg.dir);
  const tsc = join(pkgDir, "node_modules", ".bin", "tsc");
  // A package whose deps were never installed in this worktree is not a
  // type error — stay silent rather than crying wolf about missing modules.
  if (!existsSync(tsc)) continue;

  try {
    execFileSync(
      tsc,
      [
        "--noEmit",
        "--incremental",
        "--tsBuildInfoFile",
        join(cacheDir, `${pkg.name.replace(/[^a-z0-9]/gi, "-")}.tsbuildinfo`),
      ],
      { cwd: pkgDir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch (err) {
    // A throw with no compiler output means tsc could not run at all (spawn
    // refused, killed, crashed) rather than "no type errors". Falling back to
    // err.message and always recording the failure keeps that from exiting 0
    // and silently reporting a clean typecheck.
    const out = `${err.stdout ?? ""}${err.stderr ?? ""}`.trim() || String(err.message ?? err);
    failures.push({ pkg: pkg.name, out });
  }
}

if (failures.length === 0) {
  process.exit(0);
}

const report = failures
  .map(({ pkg, out }) => {
    // Long error dumps crowd out the edit that caused them; the first few
    // lines are what identifies the break.
    const lines = out.split("\n");
    const head = lines.slice(0, 25).join("\n");
    const more = lines.length > 25 ? `\n… ${lines.length - 25} more line(s)` : "";
    return `--- ${pkg} ---\n${head}${more}`;
  })
  .join("\n\n");

const scope = targets.length > 1 ? " (contracts change — all packages checked)" : "";
process.stderr.write(
  `Typecheck failed for ${failures.map((f) => f.pkg).join(", ")} after editing ` +
    `${rel}${scope}:\n\n${report}\n\n` +
    `Fix these before continuing. To re-run manually: ` +
    `pnpm --filter ${failures[0].pkg} typecheck\n`,
);
process.exit(2);
