// Vercel's Ignored Build Step (`ignoreCommand` in vercel.json): exit 0 skips
// the deployment, anything else builds it.
//
// **Why it exists (2026-11-06).** A week held 26 production deployments and
// about a third were merges that touched only prose. Each one still built
// (build minutes), and each started with an empty cache: the library's data
// cache is keyed by deployment id (`server/libraryCache.ts`) and a new
// deployment has none of the last one's rendered pages, so crawlers and
// readers re-rendered the public library on Active CPU, which the free team
// had run past 270% of.
//
// **It fails toward building.** No previous SHA (a first deploy, a redeploy
// from the dashboard), a SHA a shallow clone lacks, or any git error: build.
// Skipping a deploy that was needed ships nothing; building one that was not
// costs only what it cost before this file.
import { spawnSync } from "node:child_process";
import { isProseOnly } from "./lib/prose-only.mjs";

const previous = process.env.VERCEL_GIT_PREVIOUS_SHA;
if (!previous) {
  console.log("ignore-build: no previous deployment SHA, building");
  process.exit(1);
}

const root = spawnSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" });
const diff =
  root.status === 0
    ? spawnSync("git", ["diff", "--name-only", previous, "HEAD"], { cwd: root.stdout.trim(), encoding: "utf8" })
    : root;
if (diff.status !== 0) {
  console.log(`ignore-build: could not diff against ${previous}, building`);
  process.exit(1);
}

const paths = diff.stdout.split("\n");
if (isProseOnly(paths)) {
  console.log("ignore-build: prose only since the last deployment, skipping");
  process.exit(0);
}
console.log("ignore-build: code changed, building");
process.exit(1);
