#!/usr/bin/env node
// **Vercel's "Ignored Build Step" for this project** (`vercel.json`'s
// `ignoreCommand`). Exit 0 skips the build; exit 1 lets it run.
//
// A preview is built only for a branch with an OPEN, NON-DRAFT pull request
// (Mitchell, 2026-09-24). Every push to every branch used to build one: on
// 2026-09-24 the account made ~130 deployments in 24 hours, ~120 of them
// previews for branches nobody was looking at, and the daily deployment limit
// then silently swallowed the merge of #227 — Vercel records nothing for a
// push it refuses, so production just stayed on the previous commit.
//
// Production and development builds are never skipped. Anything this script
// cannot decide — no branch name, GitHub unreachable or rate-limited — BUILDS:
// a wasted preview is cheaper than a missing one.
//
// A PR opened, reopened or marked ready AFTER its last push has no push to
// trigger a build; `.github/workflows/preview-on-ready.yml` asks Vercel for
// one at that moment.
import { pathToFileURL } from "node:url";

/**
 * Decide whether Vercel should build, from the environment and the branch's
 * open pull request.
 *
 * @param env - Vercel's system environment (`VERCEL_ENV`, `VERCEL_GIT_COMMIT_REF`).
 * @param pr - The branch's open pull request as `{ draft }`, `null` when there
 *   is none, or `"unknown"` when GitHub could not be asked.
 * @returns Whether to build, and a one-line reason for the build log.
 */
export function decide(env, pr) {
  if (env.VERCEL_ENV !== "preview") return { build: true, reason: `${env.VERCEL_ENV ?? "unknown"} build` };
  if (!env.VERCEL_GIT_COMMIT_REF) return { build: true, reason: "no branch name; building to be safe" };
  if (pr === "unknown") return { build: true, reason: "could not ask GitHub; building to be safe" };
  if (pr === null) return { build: false, reason: "no open pull request for this branch" };
  if (pr.draft) return { build: false, reason: "the pull request is a draft" };
  return { build: true, reason: "open, non-draft pull request" };
}

/**
 * Find the open pull request whose head is this branch.
 *
 * @returns `{ draft }` for the first match, `null` when there is none, or
 *   `"unknown"` on any failure. `GITHUB_TOKEN`, if set, lifts the
 *   unauthenticated rate limit; the repo is public, so it is not required.
 */
async function openPullRequest(env) {
  const owner = env.VERCEL_GIT_REPO_OWNER;
  const repo = env.VERCEL_GIT_REPO_SLUG;
  const branch = env.VERCEL_GIT_COMMIT_REF;
  if (!owner || !repo || !branch) return "unknown";
  const url = `https://api.github.com/repos/${owner}/${repo}/pulls?state=open&head=${encodeURIComponent(`${owner}:${branch}`)}`;
  const headers = { accept: "application/vnd.github+json", "user-agent": "vercel-ignore-build" };
  if (env.GITHUB_TOKEN) headers.authorization = `Bearer ${env.GITHUB_TOKEN}`;
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return "unknown";
    const pulls = await res.json();
    return Array.isArray(pulls) && pulls.length > 0 ? { draft: Boolean(pulls[0].draft) } : null;
  } catch {
    return "unknown";
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const env = process.env;
  const pr = env.VERCEL_ENV === "preview" && env.VERCEL_GIT_COMMIT_REF ? await openPullRequest(env) : null;
  const { build, reason } = decide(env, pr);
  console.log(`vercel-ignore-build: ${build ? "building" : "skipping"} — ${reason}`);
  process.exit(build ? 1 : 0);
}
