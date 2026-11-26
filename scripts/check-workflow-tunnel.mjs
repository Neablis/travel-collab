import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// M64 (ADR-093): production's Postgres listens only on the box's loopback, and
// a workflow reaches it through the `db-tunnel` composite action. A workflow
// that names PRODUCTION_DATABASE_URL (or PREVIEW_DATABASE_URL) without opening the tunnel first fails at
// connect time, on a production run. This reads the workflow files so it fails
// in CI instead.
//
// Usage: `node scripts/check-workflow-tunnel.mjs [workflows-dir]`
// (defaults to `.github/workflows` — `pnpm lint` runs from the root).

const SECRETS = ["PRODUCTION_DATABASE_URL", "PREVIEW_DATABASE_URL"];
const TUNNEL = "./.github/actions/db-tunnel";

const isComment = (l) => l.trimStart().startsWith("#");

/** A real `uses:` step line for the action, not a comment or a trailing note on a `run:` line. */
const isTunnelStep = (l) => /^\s*(-\s+)?uses:\s*\.\/\.github\/actions\/db-tunnel\s*(#.*)?$/.test(l);

/** `[name, lines]` for each child of the top-level `jobs:` map. */
function jobsOf(lines) {
  const start = lines.findIndex((l) => /^jobs:\s*$/.test(l));
  if (start === -1) return [];
  const jobs = [];
  for (const l of lines.slice(start + 1)) {
    if (/^\S/.test(l) && !isComment(l)) break; // next top-level key
    const m = /^ {2}([\w-]+):\s*$/.exec(l);
    if (m) jobs.push([m[1], []]);
    else if (jobs.length > 0) jobs[jobs.length - 1][1].push(l);
  }
  return jobs;
}

/**
 * `file (job name)` for each job that names a guarded secret with no tunnel step
 * before it. Per job, because a runner is per job: a tunnel in job A is not
 * open in job B. A step guarded by `if:` still counts; none exists today.
 */
export function untunnelled(dir) {
  const bad = [];
  for (const f of readdirSync(dir).filter((f) => /\.ya?ml$/.test(f))) {
    const lines = readFileSync(join(dir, f), "utf8").split("\n");
    for (const [name, body] of jobsOf(lines)) {
      const tunnel = body.findIndex(isTunnelStep);
      for (const secret of SECRETS) {
        const use = body.findIndex((l) => !isComment(l) && l.includes(secret));
        if (use !== -1 && (tunnel === -1 || tunnel > use)) {
          bad.push(`${f} (job ${name}, ${secret})`);
        }
      }
    }
  }
  return bad;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const bad = untunnelled(process.argv[2] ?? ".github/workflows");
  if (bad.length > 0) {
    console.error(
      `check-workflow-tunnel: these jobs name a database secret without a "uses: ${TUNNEL}" step before it in the same job:\n` +
        bad.map((f) => `  ${f}`).join("\n"),
    );
    process.exit(1);
  }
}
