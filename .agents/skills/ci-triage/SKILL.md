---
name: ci-triage
description: Fetch and triage failing GitHub Actions checks for travel-collab using scoped `gh` CLI log fetches (--log-failed, not the full run log) to avoid pasting an entire multi-job CI log into context. Use when a PR check is red, a CI run failed, or you need to find the root cause of a failing build/test/lint job in this repo.
---

# CI triage

`.github/workflows/ci.yml` runs seven parallel jobs — `typecheck` (plus
`db:check`), `lint`, `unit`, `script-tests`, `integration` and two `e2e`
shards (`e2e (1/2)`, `e2e (2/2)`) — each
with the same setup (`.github/actions/setup-workspace`). It runs on pull requests only — pushes to `main` no longer
trigger CI, and production migrations are a separate, manually dispatched
workflow (`migrate-production.yml`). Triage only the jobs that failed; don't
fetch the rest.

**Before triaging, check the PR isn't a draft.** Every job is gated on
`draft == false`, so on a draft PR they report *skipped*, not failed. A skipped
check is the workflow working as intended (see
`docs/guidelines/ci-cost-and-capacity.md`) — mark the PR ready for review to
get a real run rather than hunting for a broken workflow.

## 1. Identify the failing run and job

- PR: `gh pr checks <PR-number>`
- Branch: `gh run list --branch <branch> --limit 5`
- Either way, then: `gh run view <run-id>` to see per-job status and job IDs.

## 2. Fetch only the failed job's log

```
gh run view <run-id> --log-failed
```

If you also know the job ID, narrow further:

```
gh run view <run-id> --job <job-id> --log-failed
```

**Do not use `gh run view <run-id> --log`** (no suffix) for triage — it dumps the
full output of every job and wastes context on the ones that passed.

## 3. Per-job triage tips

- **typecheck** (`pnpm typecheck`, then `db:check` even if typecheck failed)
  and **lint** (`pnpm lint`): output is usually self-explanatory from
  `--log-failed` alone. Each job reports on its own, so several can be red at
  once — check every red one before you start fixing.
- **unit** (`pnpm test:unit`): Vitest runs with the `dot` reporter (compact).
  Grep the log for `FAIL` to jump straight to failing test names before
  reading stack traces.
- **script-tests** (`pnpm test:scripts`): node:test; grep for `✖`.
- **integration** (`pnpm --filter web test:int`): vitest against Postgres.
- **e2e (1/2), e2e (2/2)**: two Playwright shards, split by spec file, each
  with its own build and database. Check both: one failing says nothing about
  the other. Playwright runs with the `line` reporter (compact). Grep
  for `✘` (or `failed`) to find failing test titles. If you need a trace or
  screenshot to debug further, download that shard's artifact instead of
  reading raw bytes into context: `gh run download <run-id> -n
  playwright-report-1` (or `-2`), then open it locally. To run one shard's
  specs locally: `pnpm --filter web test:e2e:ci-like --shard=N/2` (the extra
  argument lands on the script's final `pnpm test:e2e`).

## 4. Reproduce locally with the narrowest command

Don't re-run full CI to reproduce — use the smallest matching local command:

- typecheck / lint / unit / script-tests: `pnpm typecheck` / `pnpm lint` /
  `pnpm test:unit` / `pnpm test:scripts` — the same command the job ran (or
  narrower — see the `minimal-check-subset` skill)
- one unit test file:
  `pnpm --filter web exec vitest run -c vitest.unit.config.ts <file>`

  **Not** `pnpm --filter web test -- --run <file>`: pnpm swallows the `--`
  passthrough, so the entire suite runs while the printed command reads as
  narrowed. `minimal-check-subset` has the measurement and the reason `-c` is
  not optional.
- integration: `pnpm --filter web test:int` (needs real Postgres — see
  `docker-compose.yml`)
- e2e: `pnpm --filter web test:e2e:ci-like` — the only e2e lane whose result
  counts (CLAUDE.md rule 1, `AGENTS.md`, KI-27). Plain `test:e2e` serves
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
