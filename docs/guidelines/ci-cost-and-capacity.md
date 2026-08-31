# CI cost and capacity

> **STATUS 2026-08-31: the repo is public. The minutes constraint below no
> longer binds.** Mitchell made `Neablis/travel-collab` public to get free
> runs. Public repos get **unlimited GitHub-hosted standard-runner minutes**,
> which is the outcome the "Still open" section at the bottom of this document
> asked for — so the arithmetic in the body is now *history*, not a budget.
>
> Three things that did **not** stop mattering, and one that got worse:
>
> 1. **The levers stay, for different reasons.** Draft-gating and
>    `paths-ignore` were justified here by minutes. They are still justified by
>    **CodeRabbit review passes and Claude tokens**, neither of which went
>    unlimited — a full CI run on a prose edit still costs a session the time
>    spent waiting for it. `AGENTS.md`'s tiered Definition of Done now carries
>    that argument directly, and does not depend on this document.
> 2. **The required-status-check trap is now LIVE.** See the new section
>    immediately below. This is the one thing to act on before anything else.
> 3. **CodeQL was never in the accounting at all** — also below.
>
> Do not delete the body. It is the measurement and reasoning behind the
> workflow's current shape, and the shape is still what we want.

## The trap that going public just armed

The "Still open" section below ends with a warning, written while it was
hypothetical:

> *going public **or** upgrading to Pro turns on branch protection, and at that
> moment `paths-ignore` acquires the required-status-check trap: a required
> check that never runs blocks the merge forever. Convert the filters to a
> skip-job pattern before enabling required checks, not after.*

That condition has fired. Confirmed 2026-08-31:
`gh api repos/Neablis/travel-collab/branches/main/protection` now returns
**`Branch not protected` (404)** — previously it returned *"Upgrade to GitHub
Pro or make this repository public"*. Branch protection is available and simply
not switched on yet.

**So there is a window, and we are in it.** The moment `static-and-unit` or
`integration-e2e` is made a *required* status check, every prose-only PR — the
exact Tier 1 case `AGENTS.md` now tells agents to expect — will sit unmergeable
forever, because `paths-ignore` means the required job never reports at all. A
skipped job reports; a job that never ran does not.

**Do the conversion before enabling required checks**: drop `paths-ignore`,
keep the workflow always-triggering, and move the filter into a `changes` job
(`dorny/paths-filter` or a `git diff` step) whose output each real job reads in
its `if:`. The jobs then *run and skip*, which satisfies a required check.

## CodeQL: real spend that no measurement here has ever counted

Every table in this document was built from the `ci` and `migrate-production`
workflows. **CodeQL is neither**, and it has been running the whole time:

- It is **not in `.github/workflows/`** — it is GitHub's *default setup*,
  configured in repository settings, so nothing in the tree reveals it.
- Its runs are named **`PR #103`** and **`Push on main`**, not `CodeQL`. That
  is why it is invisible to the re-measuring recipe at the bottom of this file,
  and why filtering `.name=="CodeQL"` returns zero.
- Measured 2026-08-31 over the most recent 100 workflow runs: **42 CodeQL runs**
  alongside 54 `ci` runs, at **~2.9 billed minutes per run** (sampled 20 runs,
  40 jobs, 57 billed minutes) — call it **~122 minutes** in that window.
- **It still runs on pushes to `main`**, which `ci.yml` deliberately stopped
  doing to save ~456 min/month. That saving was real but smaller in net terms
  than this document claims, because CodeQL kept paying it.

Now that minutes are unlimited this is no longer a cost problem, and CodeQL is
a security tool — turning it down is Mitchell's call, the same species as the
disclosure decision that made the repo public. It is recorded here so the next
person who measures this repo's spend does not repeat the omission.

---

**The original constraint (historical, superseded by the status block above):**
`Neablis/travel-collab` was a **private repo on a GitHub Free plan**, which
includes **2,000 Linux Actions minutes per month** and no more.
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
| Stop running CI on pushes to `main` | 456 | A stale-merge test failure waits for the next PR |
| Merge `static-checks` + `unit-tests` → `static-and-unit` | 186 | +~43s wall clock |
| `paths-ignore` prose trees | ~80 | See the `.design-sync` trap below |
| `concurrency` with `cancel-in-progress` | ~82 | None |

Modelled against the real job data — keep only the last two runs per PR branch,
merge the two cheap jobs, drop `push` runs entirely:

| | before | after |
|---|---|---|
| 30-day sample | 1,956/month | **~428/month** |
| At the Aug 22–27 tempo | ~8,430/month | **~1,975/month** |

Read the second row carefully. Sustaining that six-day sprint tempo for a whole
month still lands *at* the cap, with nothing spare. The cuts buy headroom for
normal weeks, not for an indefinite sprint — if that tempo becomes the norm, the
contingency ladder at the bottom of this file is the next move, not another
round of tuning. There is very little tuning left.

Four details that are easy to get wrong and were each got wrong once:

- **`paths-ignore` is evaluated against the whole PR diff, not the push.** For
  `pull_request` events GitHub compares the filter against every file the PR
  changes against base — never against the commits in the triggering push. So
  the `~80 min` saving above only ever materialises on PRs that are prose-only
  **end to end**; a documentation commit pushed onto a PR that already contains
  code re-runs everything. Verified 2026-08-31 on PR #103: a commit touching
  seven prose files ran `static-and-unit` and `integration-e2e` in full. This
  is also why `AGENTS.md`'s Tier 1 is defined on the branch, not the commit.

- **`ci.yml` cancels unconditionally; `migrate-production.yml` never does.**
  `ci.yml` only runs on pull requests now, and nothing there touches production,
  so superseding an in-flight run is always safe. The production migration
  workflow sets `cancel-in-progress: false` and a `concurrency` group of its own
  for exactly the opposite reason: cancelling a migration mid-apply is
  unrecoverable, and two overlapping ones are worse.
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
- **Dependabot → monthly: reversed 2026-08-28, and the original reasoning still
  holds for the half it was about.** The measurement stands: all 8 runs in the
  sample were **security** updates that fired in a single backlog flush on
  2026-08-25 when the feature was first enabled, and those trigger on advisory
  publication whether a config file exists or not — so there was, and is, no
  cadence there to turn down. What this bullet got wrong was treating "adding a
  `dependabot.yml` risks enabling version updates" as a reason not to have one.
  Version bumps did not stop arriving; they arrived **untracked**, which is how
  Vitest went 2 → 3 without the migration its own config comment mandates,
  leaving the repo one major away from silently losing the node/jsdom split
  (2026-08-28 project review, Testing §2). `.github/dependabot.yml` now exists
  and is configured against exactly the objection above: monthly, grouped,
  majors ignored, three PRs a month maximum (~30 billed min, ~1.5% of the cap),
  and `rebase-strategy: disabled` so a moving `main` does not force-push a
  re-run per merge. The file's header comment carries the full accounting.
- **CircleCI / GitLab → unpriced switching cost.** The `ci-triage` skill,
  `docs/known-issues/` KI-27, and `CLAUDE.md`'s `test:e2e:ci-like` rule are all
  built on `gh run` semantics. Migrating CI means rewriting the repo's triage
  tooling too.
- **Self-hosted runner on the Mac → blocked by a hard constraint.** GitHub
  Actions **service containers require a Linux runner**; `integration-e2e`'s
  `services: postgres` block simply does not work on a macOS runner. A Mac runner
  means rebuilding that job around `docker-compose.yml`. Separately, `claude/*`
  branches push at 00:59–04:54 UTC, so a laptop runner queues while asleep.

## The last gate: migrations are now explicit

Mitchell's call, 2026-08-27. `main` no longer runs CI at all, and
`migrate-production` moved out of `ci.yml` into its own
`workflow_dispatch`-only workflow.

The old shape ran three test jobs on every push to `main` for the sole purpose
of gating an automatic production migration — **456 min/month, 23% of the
total**, to re-test a tree the pull-request run had already tested against
`refs/pull/N/merge` (the same merge result that lands). The objection to
dropping it was that it removed the last gate before a production migration.
Making the migration explicit answers that objection rather than accepting it:
nothing migrates production unless a human dispatches it.

`.github/workflows/migrate-production.yml` therefore carries two rails, since a
manual trigger has failure modes an automatic one doesn't — the wrong branch
selected in the "Run workflow" dropdown, and a stray click. It refuses any ref
that isn't `refs/heads/main`, and requires the word `migrate` typed into a
confirm field. The input is read through `env:` rather than interpolated into
the script, so it can't inject shell.

Both standing rules survive intact:

- ADR-004 — *"migrations run via drizzle-kit as an explicit CI/deploy step,
  never implicitly at cold start"*. A dispatch is **more** explicit than a
  post-merge job, not less.
- The environments guideline — *migrations are applied by automation only, never
  `drizzle-kit migrate` run by hand against a remote database*. The trigger is
  manual; the execution is not. `PRODUCTION_DATABASE_URL` stays a repo secret
  and never reaches a shell that also has a `.env.local` in scope, which is the
  actual hazard that rule exists to prevent.

**What this genuinely gives up**, stated plainly so nobody rediscovers it the
expensive way: a merged migration now sits pending until someone dispatches it,
and a test failure introduced by merging a stale branch is not caught until the
next pull request. Vercel still builds `main` on every push, so a broken *build*
surfaces immediately — a broken *test* does not.

## Still open — Mitchell's call

**Make the repo public. — DONE, 2026-08-31.** Mitchell made the repo public
to get free runs; public repos get unlimited GitHub-hosted standard-runner
minutes, which moots the budget this document was written to defend. The
contingency ladder below is therefore **not needed** and is kept only as the
record of what was priced. See the status block at the top — going public
armed the required-status-check trap this section warns about two paragraphs
down, and that is now the live item.

If the cuts above stop being enough — and the tempo row in the table says that
is a live possibility — the contingency ladder in order of cost:
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
