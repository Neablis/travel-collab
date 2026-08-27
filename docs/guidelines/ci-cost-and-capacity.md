# CI cost and capacity

**The constraint:** `Neablis/travel-collab` is a **private repo on a GitHub Free
plan**, which includes **2,000 Linux Actions minutes per month** and no more.
(Confirmed the plan tier the blunt way: `gh api repos/Neablis/travel-collab/
branches/main/protection` returns *"Upgrade to GitHub Pro or make this
repository public"*. That same fact means there are **no required status checks
or branch protection** on this repo today — which matters below.)

Billing rounds **each job up to the whole minute**, so three 61-second jobs cost
six minutes, not four. Job count is a cost, not just a structure choice.

This file exists because the first instinct when CI gets expensive is to reach
for a provider comparison — self-hosted runners, CircleCI, GitLab. For this repo
that instinct is wrong, and the measurements below are why.

## What we actually spend

Measured over 2026-07-28 → 2026-08-27 (220 runs), from per-job `started_at` /
`completed_at` with per-job minute rounding:

| | billed min | share |
|---|---|---|
| **Total** | **1,956** | at the 2,000 cap |
| `integration-e2e` (212 runs, 4.1 avg) | 865 | 44% |
| `unit-tests` (212 runs, 2.9 avg) | 619 | 32% |
| `static-checks` (212 runs, 1.7 avg) | 364 | 19% |
| Dependabot security jobs (8 runs) | 60 | 3% |
| `migrate-production` (48 runs) | 48 | 2% |
| by trigger — `pull_request` | 1,392 | 71% |
| by trigger — `push` to `main` | 504 | 26% |

The monthly average hides the problem. **Aug 22–27 alone burned 1,686 minutes in
six days (~281/day, a ~8,400 min/month pace)** — 4× the cap. That window is what
sustained parallel-agent work actually costs.

**The driver is run count, not job cost.** 157 PR runs across 36 branches (mean
4.4). [PR #55](https://github.com/Neablis/travel-collab/pull/55) alone: **31 runs,
315 minutes, 37 commits.** No PR in the sample was ever opened as a draft.

**The jobs themselves are already lean** — step timings on a representative run:
setup ~20s/job, `tsc` 34s, `eslint` 13s, `pnpm test` 160s, `next build` 57s,
Playwright 81s. The test-overhaul work (`docs/testing-baseline.md`) already took
the easy wins. There is no fat left *inside* the jobs; the waste was all in how
often and how many times they ran.

## What changed (2026-08-27)

Four levers, in `.github/workflows/ci.yml`. Savings are modelled against the
sampled 30 days.

| Lever | Est. saving / 30d | What it costs |
|---|---|---|
| Draft-gate PR runs (`types: [… ready_for_review]` + `draft == false`) | 500–750 | Agents must open PRs as drafts — now a rule in `AGENTS.md` |
| Merge `static-checks` + `unit-tests` → `static-and-unit` | 186 | +~43s wall clock |
| `paths-ignore` prose trees | ~80 | See the `.design-sync` trap below |
| `concurrency` with PR-only `cancel-in-progress` | ~82 | None |

Together: **1,956 → roughly 560–700/month** at the sampled mix, or **~1,500** if
the Aug 22–27 tempo holds. Both fit under 2,000.

Three details that are easy to get wrong and were got wrong once:

- **Cancellation is PR-only.** `cancel-in-progress: ${{ github.event_name ==
  'pull_request' }}`. The generic advice is to cancel everything; on `main` that
  would mean cancelling `migrate-production` mid-apply. With it false, main
  pushes queue instead — which also serializes migrations, which is what we want.
- **`paths-ignore` lists `*.md`, not `**/*.md`.** `**/*.md` would also match
  `.design-sync/**`, and that tree is a **real build input**:
  `api/dev/reset-demo-data/route.ts` imports
  `.design-sync/handoff/data/japan-trip-seed.json` and
  `japanTripImporter.test.ts` reads it. Ignoring it would let a broken seed
  through untested. `scripts/**` is likewise never ignored — `pnpm lint` runs
  `check-lint-wall.mjs`, `check-color-wall.mjs` and `check-case-collisions.mjs`
  out of it.
- **YAML anchors don't work.** GitHub Actions' workflow parser has no support
  for `&anchor`/`*alias`, so the two `paths-ignore` lists are repeated verbatim.
  Keep them in step.

One known, accepted gap: `check-case-collisions.mjs` walks `git ls-files`, so a
case collision introduced by a *docs-only* PR won't be caught on that PR — it
will surface on the next code PR, attributed to the wrong change. The guard is
about module resolution, so a docs collision is harmless in itself; the
confusing attribution is the real cost, and it's cheap next to the minutes.

## What we rejected, and why

Prompted by a `github_actions_alternatives_plan.md` evaluation doc. Most of its
recommendations don't apply here — recorded so the same options aren't re-priced
next quarter:

- **Move deployments out of Actions → already done.** `ci.yml` contains no
  `vercel build` / `vercel deploy`; Vercel deploys through its native Git
  integration. Savings available: **zero**.
- **Turborepo remote caching → N/A.** There is no `turbo.json`; this is a plain
  pnpm workspace.
- **Concurrency cancellation as the headline fix → oversold.** Modelled against
  real timestamps it is worth **82 min/30d (4%)**, not "60–80%". Runs finish in
  ~4 minutes, so pushes rarely overlap. Worth doing because it's free.
- **Path filtering as a major lever → small.** Only ~5 of 36 PRs were prose-only:
  **~80 min (4%)**.
- **Dependabot → monthly: not actionable.** There is no `.github/dependabot.yml`;
  all 8 runs in the sample were **security** updates that fired in a single
  backlog flush on 2026-08-25 when the feature was first enabled. Security
  updates trigger on advisory publication, not a schedule, so there is no cadence
  to turn down. Adding a `dependabot.yml` would risk *enabling version updates*
  and increasing spend. Left alone deliberately.
- **CircleCI / GitLab → unpriced switching cost.** The `ci-triage` skill,
  `docs/known-issues.md` KI-27, and `CLAUDE.md`'s `test:e2e:ci-like` rule are all
  built on `gh run` semantics. Migrating CI means rewriting the repo's triage
  tooling too.
- **Self-hosted runner on the Mac → blocked by a hard constraint.** GitHub
  Actions **service containers require a Linux runner**; `integration-e2e`'s
  `services: postgres` block simply does not work on a macOS runner. A Mac runner
  means rebuilding that job around `docker-compose.yml`. Separately, `claude/*`
  branches push at 00:59–04:54 UTC, so a laptop runner queues while asleep.

## Still open — Mitchell's calls

1. **Drop `main` pushes to `migrate-production` only.** Worth **456 min/30d
   (23%)**, the second-largest number available, and not taken. It removes the
   last gate between a merge and a production migration. Not a minutes decision.
2. **Make the repo public.** Public repos get unlimited GitHub-hosted standard-
   runner minutes; it moots this entire document. A disclosure decision, not an
   engineering one.

If the cuts above stop being enough, the contingency ladder in order of cost:
a **self-hosted Linux runner** (spare box or an Oracle Always Free ARM instance —
not the Mac, see above), or simply **paying**: after these cuts the worst case is
~3,000 overage minutes at $0.008/min ≈ **$24/month**, which is cheaper than
maintaining a second CI config. Note that going public *or* upgrading to Pro
turns on branch protection, and at that moment `paths-ignore` acquires the
required-status-check trap: a required check that never runs blocks the merge
forever. Convert the filters to a skip-job pattern before enabling required
checks, not after.

## Re-measuring

Don't estimate from `gh run list` durations — those are wall clock, not billed
minutes, and ignore per-job rounding. The `/timing` endpoint reports
`total_ms: 0` on this repo and cannot be trusted either. Compute from job
timestamps:

```bash
gh api --paginate "repos/Neablis/travel-collab/actions/runs?per_page=100&created=>=YYYY-MM-DD" \
  --jq '.workflow_runs[] | [.id,.event,.head_branch,.created_at] | @tsv' > runs.tsv
cut -f1 runs.tsv | xargs -P 8 -I{} sh -c \
  'gh api repos/Neablis/travel-collab/actions/runs/{}/jobs \
     --jq ".jobs[] | [\"{}\", .name, .started_at, .completed_at, .conclusion] | @tsv"' > jobs.tsv
```

Then sum `ceil((completed_at - started_at) / 60)` per job, skipping
`conclusion == "skipped"`.
