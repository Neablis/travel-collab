#!/usr/bin/env node
// Which verification lanes does THIS container actually have?
//
// WHY THIS EXISTS
//
// `AGENTS.md`'s Definition of Done assumes the local lanes are available: Tier
// 2 says run the `minimal-check-subset` skill's output, Tier 3 says run
// `pnpm check` once. In a Claude Code cloud session that assumption is
// conditional, and four open known issues are each an instance of a session
// discovering it MID-TASK and misreading the result as a code failure:
//
//   KI-2026-09-08-b  `pnpm --filter` aborts outright when the pnpm major that
//                    wrote node_modules/.modules.yaml differs from the one on
//                    PATH. Every documented Tier 2 command is written in that
//                    form. It cost one task real time on 2026-09-08, and the
//                    same skew makes check-lint-wall.mjs print thirteen
//                    "LINT WALL CANNOT RUN" lines and exit 1 — which reads
//                    exactly like thirteen wall failures and is not.
//   KI-2026-09-12-b  An agent worktree can have no node_modules at all,
//                    because SessionStart appears not to fire for
//                    worktree-isolated subagent sessions.
//   KI-2026-09-02-a  Node 26 leaves `window.localStorage` undefined in the
//                    jsdom unit lane, so the local unit suite is red on a tree
//                    CI passes.
//   KI-49            The egress proxy blocks the map tile host, so the Map
//                    lens cannot be visually verified here at all.
//
// The cost of each is the same shape: the session attributes an environment
// fault to the code, or to "flakiness", and `CLAUDE.md` rule 2 exists because
// that is the most expensive wrong answer available. This probe front-loads
// the answer so a session knows what it can prove BEFORE it promises to prove
// it.
//
// WHY IT IS NOT PART OF THE STATE DIGEST
//
// `scripts/state-digest.mjs` answers "where is the work"; this answers "what
// can this container run". Folding them would grow the digest past the line
// budget AGENTS.md calls non-negotiable — "a digest that grows into a second
// copy of STATUS.md has failed at its only job". It is also worth running
// again MID-session, when a lane starts misbehaving, which a start-only digest
// cannot serve.
//
// EVERY PROBE IS ADVISORY AND FAILS OPEN. This never exits non-zero for a
// blocked lane: a blocked lane is information, not an error, and a startup
// probe that can fail a session start is worse than no probe.

import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const OK = "OK";
const BLOCKED = "BLOCKED";
const UNKNOWN = "UNKNOWN";

function run(cmd, args, { timeout = 5000 } = {}) {
  try {
    return {
      ok: true,
      out: execFileSync(cmd, args, {
        cwd: root,
        timeout,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }).trim(),
    };
  } catch (err) {
    return { ok: false, out: String(err?.stdout ?? "") + String(err?.stderr ?? "") };
  }
}

// --- probe 1: node_modules present at all (KI-2026-09-12-b) ---------------
export function probeDeps(fs = { existsSync }, base = root) {
  const rootMods = fs.existsSync(join(base, "node_modules"));
  const webMods = fs.existsSync(join(base, "apps", "web", "node_modules"));
  if (rootMods && webMods) return { status: OK, note: "node_modules present" };
  const missing = [!rootMods && "root", !webMods && "apps/web"].filter(Boolean).join(" + ");
  return {
    status: BLOCKED,
    note: `no node_modules (${missing}) — run \`pnpm install\``,
    ki: "KI-2026-09-12-b",
  };
}

// --- probe 2: pnpm --filter usable (KI-2026-09-08-b) ----------------------
// The KI documents its own confirmation: compare the packageManager recorded
// in node_modules/.modules.yaml against the pnpm actually on PATH. We compare
// MAJORS only, which is the granularity pnpm's own deps-status check objects
// at; a patch difference never triggers the abort.
// Both spellings are real and this was got wrong first time: KI-2026-09-08-b
// quotes the bare-YAML form (`packageManager: pnpm@10.28.0`) that older pnpm
// wrote, while pnpm 11 writes a JSON-ish quoted form
// (`"packageManager": "pnpm@11.25.0"`). A regex matching only the KI's spelling
// reports UNKNOWN on every modern tree — i.e. it silently stops probing the
// exact lane it exists to probe. Match both.
export function pnpmMajorSkew(modulesYaml, pnpmVersion) {
  const recorded = /"?packageManager"?:\s*"?pnpm@(\d+)/.exec(modulesYaml ?? "")?.[1];
  const onPath = /^(\d+)/.exec(String(pnpmVersion ?? "").trim())?.[1];
  if (!recorded || !onPath) return null; // cannot tell — not the same as "fine"
  return { recorded, onPath, skewed: recorded !== onPath };
}

function probeFilter() {
  const yamlPath = join(root, "node_modules", ".modules.yaml");
  if (!existsSync(yamlPath)) {
    return { status: UNKNOWN, note: "no .modules.yaml to compare" };
  }
  let yaml = "";
  try {
    yaml = readFileSync(yamlPath, "utf8");
  } catch {
    return { status: UNKNOWN, note: "could not read .modules.yaml" };
  }
  const version = run("pnpm", ["--version"], { timeout: 15000 });
  if (!version.ok) return { status: UNKNOWN, note: "pnpm not on PATH" };
  const skew = pnpmMajorSkew(yaml, version.out);
  if (!skew) return { status: UNKNOWN, note: "could not parse pnpm majors" };
  if (!skew.skewed) {
    return { status: OK, note: `pnpm ${skew.onPath}.x wrote node_modules` };
  }
  return {
    status: BLOCKED,
    note:
      `node_modules written by pnpm ${skew.recorded}.x, PATH has ${skew.onPath}.x — ` +
      `every \`pnpm --filter\` aborts. Workaround: ` +
      `pnpm --config.verifyDepsBeforeRun=false --filter <pkg> <script> ` +
      `(the env-var form does NOT work)`,
    ki: "KI-2026-09-08-b",
  };
}

// --- probe 3: Node major vs the jsdom unit lane (KI-2026-09-02-a) ---------
export function nodeLaneStatus(nodeVersion) {
  const major = Number(/^v?(\d+)/.exec(String(nodeVersion ?? ""))?.[1]);
  if (!Number.isFinite(major)) return { status: UNKNOWN, note: "unreadable node version" };
  if (major >= 26) {
    return {
      status: BLOCKED,
      note: `Node ${major}: window.localStorage is undefined in jsdom, so the local unit lane is red on a tree CI passes`,
      ki: "KI-2026-09-02-a",
    };
  }
  if (major < 22) {
    return { status: BLOCKED, note: `Node ${major} is below the engines floor (>=22.18)` };
  }
  return { status: OK, note: `Node ${major}` };
}

// --- probe 4: integration database ----------------------------------------
function probeDatabase() {
  const probe = join(root, "apps", "web", "scripts", "db-probe.mjs");
  if (!existsSync(probe)) return { status: UNKNOWN, note: "db-probe.mjs not found" };
  const res = run("node", [probe], { timeout: 20000 });
  if (res.ok) return { status: OK, note: "integration lane available (pnpm test:int)" };
  return {
    status: BLOCKED,
    note: "no database answered DATABASE_URL — `pnpm check` SKIPS test:int silently, so a green local check is NOT a green CI",
  };
}

// --- probe 5: Playwright browser ------------------------------------------
function probeBrowser() {
  const envPath = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (envPath && existsSync(envPath)) {
    return { status: OK, note: `browsers at ${envPath}` };
  }
  const home = process.env.HOME ?? "";
  if (home && existsSync(join(home, ".cache", "ms-playwright"))) {
    return { status: OK, note: "browsers in ~/.cache/ms-playwright" };
  }
  return {
    status: BLOCKED,
    note: "no Playwright browsers — e2e cannot run here; use the PR's Vercel preview via phase-verifier",
  };
}

// --- probe 6: egress to the map tile host (KI-49) -------------------------
// Opt-in: it is the only probe that touches the network, and a startup probe
// that waits on DNS is a startup probe people disable.
function probeEgress() {
  if (!process.argv.includes("--net")) {
    return { status: UNKNOWN, note: "not probed (pass --net)" };
  }
  const res = run("curl", ["-sS", "-o", "/dev/null", "-w", "%{http_code}", "--max-time", "6",
    "https://demotiles.maplibre.org/style.json"], { timeout: 10000 });
  if (res.ok && /^2\d\d$/.test(res.out)) return { status: OK, note: "tile host reachable" };
  return {
    status: BLOCKED,
    note: "tile host blocked by the egress proxy — the Map lens cannot be visually verified here",
    ki: "KI-49",
  };
}

export function collectLanes() {
  const deps = probeDeps();
  return [
    ["deps", deps],
    // A filter probe against a tree with no node_modules reports the wrong
    // cause; deps is the prerequisite, so say so rather than guessing.
    ["pnpm --filter", deps.status === BLOCKED
      ? { status: UNKNOWN, note: "skipped — no node_modules" }
      : probeFilter()],
    ["unit lane", nodeLaneStatus(process.version)],
    ["database", probeDatabase()],
    ["browser", probeBrowser()],
    ["egress", probeEgress()],
  ];
}

function main() {
  const lanes = collectLanes();
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(Object.fromEntries(lanes), null, 2));
    return;
  }
  const blocked = lanes.filter(([, v]) => v.status === BLOCKED);
  const width = Math.max(...lanes.map(([n]) => n.length));
  console.log("LANES — what this container can actually verify");
  for (const [name, v] of lanes) {
    const mark = v.status === OK ? "OK  " : v.status === BLOCKED ? "XX  " : "--  ";
    console.log(`  ${mark}${name.padEnd(width)}  ${v.note}${v.ki ? `  [${v.ki}]` : ""}`);
  }
  if (blocked.length > 0) {
    console.log(
      `\n  ${blocked.length} lane(s) blocked. Say so in the PR's "Not run, and why" line` +
        ` rather than reporting a check you could not run.`
    );
  }
}

// pathToFileURL, not string interpolation: on Windows, or when the path holds
// a space or a URL-reserved character, `file://${argv[1]}` never equals
// import.meta.url, main() is skipped and the script exits 0 having done
// NOTHING. For surface-size that means `pnpm surface --check` — a lint wall —
// passing silently, which is the exact silent-success class this branch spent
// its time hunting. CodeRabbit, PR #199.
// The argv[1] guard is not decoration: pathToFileURL(undefined) THROWS, so
// without it merely IMPORTING this module (as the tests do, and as
// `node -e "import(...)"` does) crashes before any export is reachable.
// Found by running it immediately after applying the fix above.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
