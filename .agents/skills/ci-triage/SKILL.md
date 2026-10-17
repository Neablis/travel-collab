---
name: ci-triage
description: Triage a failing GitHub Actions check for travel-collab from a cloud session — name the red job over REST, read its check-run annotations, rule out the two known-noise checks, then reproduce it locally with the job's own scoped command, because job logs cannot be read through the cloud proxy. Use when a PR check is red, a CI run failed, or you need the root cause of a failing build/test/lint job in this repo.
---

# CI triage

`.github/workflows/ci.yml` runs seven parallel jobs — `typecheck` (plus
`db:check`), `lint`, `unit`, `script-tests`, `integration` and two `e2e`
shards — each with the same setup (`.github/actions/setup-workspace`). Those
are the job ids; the PR's check list shows them as `static / typecheck`,
`static / lint`, `test / unit`, `test / scripts`, `test / integration` and
`test / e2e (1/2)`, `(2/2)`. Around them: `changes` decides whether the PR is
prose-only (then all seven skip), and `ci-ok` is the one required check — it
is red whenever any of the seven is, so triage the job it names, not it. It runs on pull requests only — pushes to `main` no longer
trigger CI, and production migrations are a separate, manually dispatched
workflow (`migrate-production.yml`). Triage only the jobs that failed; don't
fetch the rest.

**Before triaging, check the PR isn't a draft.** Every job is gated on
`draft == false`, so on a draft PR they report *skipped*, not failed. A skipped
check is the workflow working as intended (see
`docs/guidelines/ci-cost-and-capacity.md`) — mark the PR ready for review to
get a real run rather than hunting for a broken workflow.

## 1. Name the red job, over REST

`gh pr checks` and `gh run view` are GraphQL and fail from a cloud session (`github-rest`
skill). With `R=repos/Neablis/travel-collab` and the sha from `git rev-parse HEAD`:

```
gh api $R/commits/<sha>/check-runs --jq '.check_runs[] | "\(.id) \(.name): \(.status) \(.conclusion)"'
gh api "$R/actions/runs?head_sha=<sha>" --jq '.workflow_runs[] | "\(.id) \(.name) \(.conclusion)"'
gh api $R/actions/runs/<run-id>/jobs --jq '.jobs[] | "\(.id) \(.name) \(.conclusion)"'
```

Confirm the sha is the PR's current head before reading on. Then rule out the two checks
that go red without the PR's help: `github-advanced-security` (KI-2026-10-17-b, not required)
and a lone `test / unit` red that a re-run clears (KI-2026-10-14-c). `ci-ok` is the verdict.

## 2. Read the annotations, not the log

The job log is unreadable from here: the API redirects to a blob host the proxy refuses
(KI-2026-10-13-f). The check run's annotations carry the failing step and, for typecheck,
lint and the vitest reporters, the file and line:

```
gh api $R/check-runs/<check_run_id>/annotations --jq '.[] | "\(.path):\(.start_line) \(.annotation_level) \(.message)"'
```

When the annotations say only `Process completed with exit code 1`, go straight to §4 and
reproduce the job with its own command: that output is the log you could not fetch. On a
laptop `gh run view <run-id> --job <job-id> --log-failed` still works; never `--log` alone,
which dumps every job.

## 3. Per-job triage tips

- **typecheck** (`pnpm typecheck`, then `db:check` even if typecheck failed)
  and **lint** (`pnpm lint`): the annotations name the file and line. Each job
  reports on its own, so several can be red at once — check every red one
  before you start fixing.
- **unit** (`pnpm test:unit`): the annotation names the failing test file; run
  that file locally (§4) rather than the suite.
- **script-tests** (`pnpm test:scripts`): node:test; reproduce with the same command.
- **integration** (`pnpm --filter web test:int`): vitest against Postgres.
- **e2e (1/2), e2e (2/2)**: two Playwright shards, split by spec file, each
  with its own build and database. Check both: one failing says nothing about
  the other. Playwright runs with the `line` reporter (compact). Grep
  for `✘` (or `failed`) to find failing test titles. If you need a trace or
  screenshot to debug further, download that shard's artifact (REST) instead of
  reading raw bytes into context: `gh run download <run-id> -n
  playwright-report-1` (or `-2`), then open it locally. To reproduce, run the
  failing spec, not the shard: `pnpm --filter web test:e2e:ci-like
  e2e/<spec>.ts` (no `--` before the path). A whole shard is a full e2e run,
  which is CI's and which `check-test-lane.mjs` denies locally.

## 4. Reproduce locally with the narrowest command

Don't re-run full CI to reproduce — use the smallest matching local command:

- typecheck / lint / script-tests: `pnpm typecheck` / `pnpm lint` /
  `pnpm test:scripts` — the same command the job ran (or narrower — see the
  `minimal-check-subset` skill). Not `pnpm test:unit`: that is the whole unit
  suite, denied locally (`check-test-lane.mjs`); run the failing files.
- one unit test file:
  `pnpm --filter web exec vitest run -c vitest.unit.config.ts <file>`

  **Not** `pnpm --filter web test -- --run <file>`: pnpm swallows the `--`
  passthrough, so the entire suite runs while the printed command reads as
  narrowed. `minimal-check-subset` has the measurement and the reason `-c` is
  not optional.
- integration: `pnpm --filter web test:int` (needs real Postgres — see
  `docker-compose.yml`)
- e2e: `pnpm --filter web test:e2e:ci-like e2e/<spec>.ts` — the only e2e
  lane whose result counts (CLAUDE.md rule 1, `AGENTS.md`, KI-27). Plain `test:e2e` serves
  `pnpm dev`, which compiles routes on first hit and invents timeouts CI does
  not have. No env vars to export by hand: `playwright.config.ts`'s
  `webServer.env` sets `AUTH_DEV_LOGIN`, `AUTH_SECRET`, `AI_LIVE` and (under
  `CI=true`) `AUTH_TRUST_HOST` itself, and `DATABASE_URL` arrives from
  `apps/web/.env.local` via the `preload-dotenv` import in the `test:e2e`
  script.

## 5. Recognize an environmental failure — don't just retry

If a different random subset of tests fails each run, or failures are generic
timeouts/`waitFor` errors rather than a specific assertion, stop after the
second such run and check for an external cause (`ps aux` sorted by CPU/mem,
`docker ps`) instead of retrying a third time. This is the same "recognize an
error loop" rule from `AGENTS.md` — apply it here, don't re-litigate it.
