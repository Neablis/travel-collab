### KI-2026-11-01-u — CI's e2e shards can hang in `playwright install-deps chromium` until the 20-minute job cap — RESOLVED

- **Severity:** reliability. No test runs and `ci-ok` goes red, on a PR whose code is fine.
- **Area:** `.github/workflows/ci.yml` (the e2e job: `timeout-minutes: 20`, and the step
  `pnpm --filter web exec playwright install-deps chromium`).
- **Symptom / What happens:** both e2e shards of run 41256118744 (PR 660, head `7184498`) sat in
  the `install-deps` step from 00:18:34Z to 00:38:10Z and were cancelled at the job's 20-minute cap.
  The build and every spec were skipped, so the run says nothing about the PR. The same step took
  23s on the next push (`d2c9470`, run 41258768562), and on `5b65d1b`, whose e2e code is the same,
  both shards passed in about 5½ minutes. The step's annotations carry only the runner notice
  that `ubuntu-latest` moves to Ubuntu 26 from 2026-10-19; that is a possible cause, not a verified
  one.
- **How to tell it from a real failure:** the cancelled step is `install-deps`, not `Run e2e`, and
  both shards stop at the same minute. A spec that fails runs, and fails in the same place on a
  re-run.
- **Why not fixed here:** seen once, during M43, in a prose-only gate close that edits no workflow.
  A re-run of the job is the workaround.
- **Fix path / Tripwire:** give the step its own `timeout-minutes` (a few minutes; it normally
  takes under 30s), so a hang fails fast and a re-run is cheap, and consider caching the apt
  packages or pinning the runner image. Tripwire: a second occurrence, or any edit to the e2e job.
- **Cross-reference:** M43 retro (*What could be better*); M56's retro records a different
  runner stall (`test / unit` cancelled at its cap, run 41100755426).
- **First noted:** 2026-11-01, review of PR 660 at `d2c9470`.
- **Fix (PR 721, `f56ddca`, 2026-11-11):** the e2e job writes `/etc/apt/apt.conf.d/99-ci-fail-fast`
  (`Acquire::Retries "2"`, 15s http/https timeouts) and runs `install-deps` as its own step,
  `Install Playwright OS deps`, with `timeout-minutes: 4` and three attempts (10s and 20s backoff)
  that exit non-zero if all of them fail. A hang now fails the shard in at most 4 minutes, not 20.
  Before it, the step was a bare `- run: pnpm --filter web exec playwright install-deps chromium`
  under only the job's 20-minute cap. PR 721's note on this entry was lost in a merge, so the entry
  stayed open. Closed 2026-11-14 (KI sweep) on this evidence: `ci.yml` on `f02d168` parses (the
  `yaml` package), and the step's `timeout-minutes` reads 4 under the job's 20. CI run 43178934237
  (PR 733, head `3473556`) ran the new path green on both shards: the step took 13s on shard 1 and
  20s on shard 2. A real mirror outage cannot be reproduced on demand, so the 4-minute cap firing
  on CI has not been seen. Left out on purpose: an apt package cache, and pinning the runner image.
