import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// M64 (ADR-093): production's Postgres listens only on the box's loopback, and
// a workflow reaches it through the `db-tunnel` composite action. A workflow
// that names PRODUCTION_DATABASE_URL without opening the tunnel first fails at
// connect time, on a production run. This reads the workflow files so it fails
// in CI instead.
//
// Usage: `node scripts/check-workflow-tunnel.mjs [workflows-dir]`
// (defaults to `.github/workflows` — `pnpm lint` runs from the root).

const SECRET = "PRODUCTION_DATABASE_URL";
const TUNNEL = "./.github/actions/db-tunnel";

/** Index of the first non-comment line containing `needle`, or -1. */
const firstLine = (lines, needle) =>
  lines.findIndex((l) => !l.trimStart().startsWith("#") && l.includes(needle));

/** Workflow files that use the secret with no tunnel step before it. */
export function untunnelled(dir) {
  return readdirSync(dir)
    .filter((f) => /\.ya?ml$/.test(f))
    .filter((f) => {
      const lines = readFileSync(join(dir, f), "utf8").split("\n");
      const use = firstLine(lines, SECRET);
      if (use === -1) return false;
      const tunnel = firstLine(lines, TUNNEL);
      return tunnel === -1 || tunnel > use;
    });
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const bad = untunnelled(process.argv[2] ?? ".github/workflows");
  if (bad.length > 0) {
    console.error(
      `check-workflow-tunnel: these workflows name ${SECRET} without a "uses: ${TUNNEL}" step before it:\n` +
        bad.map((f) => `  ${f}`).join("\n"),
    );
    process.exit(1);
  }
}
