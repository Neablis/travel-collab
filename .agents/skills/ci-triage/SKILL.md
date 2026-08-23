---
name: ci-triage
description: Fetch and triage failing GitHub Actions checks for travel-collab using scoped `gh` CLI log fetches (--log-failed, not the full run log) to avoid pasting an entire multi-job CI log into context. Use when a PR check is red, a CI run failed, or you need to find the root cause of a failing build/test/lint job in this repo.
---

# CI triage

`.github/workflows/ci.yml` runs three independent parallel jobs: `static-checks`,
`unit-tests`, `integration-e2e`. Triage the one that failed — don't fetch all three.

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
full output of all three jobs and wastes context on two jobs that passed.

## 3. Per-job triage tips

- **static-checks**: log is a `tsc` or `eslint` error list — usually
  self-explanatory from `--log-failed` alone, no further fetching needed.
- **unit-tests**: Vitest runs with the `dot` reporter (compact). Grep the log
  for `FAIL` to jump straight to failing test names before reading stack traces.
- **integration-e2e**: Playwright runs with the `line` reporter (compact). Grep
  for `✘` (or `failed`) to find failing test titles. If you need a trace or
  screenshot to debug further, download the artifact instead of reading raw
  bytes into context: `gh run download <run-id> -n playwright-report` (or the
  artifact name shown in the run), then open it locally.

## 4. Reproduce locally with the narrowest command

Don't re-run full CI to reproduce — use the smallest matching local command:

- static-checks: `pnpm --filter web typecheck` / `pnpm --filter web lint`
- one unit test file: `pnpm --filter web test -- --run <file>`
- integration: `pnpm --filter web test:int` (needs real Postgres — see
  `docker-compose.yml`)
- e2e: `pnpm --filter web test:e2e` (needs the same env vars CI sets:
  `DATABASE_URL=postgres://postgres:postgres@localhost:5432/travel`,
  `AUTH_SECRET=ci-secret`, `AUTH_DEV_LOGIN=true`, `AUTH_TRUST_HOST=true`)

## 5. Recognize an environmental failure — don't just retry

If a different random subset of tests fails each run, or failures are generic
timeouts/`waitFor` errors rather than a specific assertion, stop after the
second such run and check for an external cause (`ps aux` sorted by CPU/mem,
`docker ps`) instead of retrying a third time. This is the same "recognize an
error loop" rule from `AGENTS.md` — apply it here, don't re-litigate it.
