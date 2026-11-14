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
- **2026-11-11 recurrence (tripwire hit), with a cause:** every e2e job of three runs failed in the
  step `pnpm --filter web exec playwright install-deps chromium`, each after about 10 minutes
  with exit 1 (this time the step failed rather than reaching the 20-minute cap), between 14:14Z
  and about 16:00Z. Run 42758239323 (PR 716, `7838c65`): shard 1/2 of attempts 2, 3 and 4. Run
  43037550861 (PR 717, `9748638`): both shards of attempts 1, 2 and 3. Run 43037721098 (PR 718,
  `201a362`): both shards of attempts 1, 2 and 3. The log of job 130588414659 (run 43037721098
  attempt 2) shows runner image `ubuntu26/20261101.186` (Ubuntu 26.04), then apt printing `Ign:` for
  `azure.archive.ubuntu.com` and `archive.ubuntu.com` every 20 seconds, then `Temporary failure
  resolving` for those hosts and `security.ubuntu.com`, and `E: Failed to fetch` on the font
  packages (`fonts-freefont-ttf`, `fonts-unifont`, `fonts-wqy-zenhei` and others). So the cause on
  this day was name resolution failing on the runner, not a hung Playwright. The same image version
  passed this step on 2026-11-10 (run 42738117635), and re-runs at 17:59Z passed (run 42758239323
  attempt 5, run 43037721098 attempt 4; run 43037550861 attempt 4 got past the step and failed a
  different test, see KI-20261111-b). The 2026-11-01 occurrence above was therefore probably the same
  class of failure, still unverified for that day.
- **How to tell it from a real failure:** the cancelled step is `install-deps`, not `Run e2e`, and
  both shards stop at the same minute. A spec that fails runs, and fails in the same place on a
  re-run.
- **Why not fixed here:** seen once, during M43, in a prose-only gate close that edits no workflow.
  A re-run of the job is the workaround.
- **Fix path / Tripwire:** give the step its own `timeout-minutes` (a few minutes; it normally
  takes under 30s), so a hang fails fast and a re-run is cheap. Pair it with fail-fast apt options
  (for example `-o Acquire::Retries=1 -o Acquire::http::Timeout=20`, so a dead mirror fails in
  seconds, not minutes) and cache the apt packages so a run does not depend on the mirrors at all.
  The fonts cannot simply be skipped: the e2e suite has a screenshot spec
  (`apps/web/e2e/m42-demo-trips.spec.ts`, `toHaveScreenshot`), so the fonts `install-deps` pulls in
  most likely matter to its baselines (not verified). Tripwire: **hit on 2026-11-11** (a second occurrence); the
  entry stays open until the step is bounded and cached, and any edit to the e2e job should include
  that.
- **Fix:** PR 721 (merged). The e2e job now writes `/etc/apt/apt.conf.d/99-ci-fail-fast`
  (`Acquire::Retries "2"`, 15s http/https timeouts) and runs `install-deps` in its own step with
  `timeout-minutes: 4`, wrapped in three attempts with 10s/20s backoff that exits non-zero if all
  fail. A mirror blip recovers; an outage like the 2026-11-11 one (apt retrying every 20s, about
  10 minutes per attempt) fails in minutes. Left out on purpose: an apt package cache (needs
  root-owned `/var/cache/apt` handling, out of scope for a small fix) and skipping the fonts
  (`apps/web/e2e/m42-demo-trips.spec.ts` uses `toHaveScreenshot`).
- **Proof (2026-11-14):** the entry's own closing condition was "a CI run shows the new step
  passing on the normal path". `ci` run 43085708751 on `819afe8` (PR 721's head) passed, and the
  new step `Install Playwright OS deps` took 13s on `test / e2e (1/2)` (19:17:40Z to 19:17:53Z) and
  10s on `test / e2e (2/2)` (19:17:33Z to 19:17:43Z), read from the run's jobs over REST. That
  proves the normal path. It does not prove the outage path: the 2026-11-11 DNS failure cannot be
  reproduced on demand, so the fail-fast behaviour (a bounded step, three attempts) has been
  seen working only as written, not under a real outage. If the step fails again, reopen this
  with a new entry citing the run.
- **Cross-reference:** KI-20261111-b (a separate e2e flake seen on the same day); M43 retro (*What could be better*); M56's retro records a different
  runner stall (`test / unit` cancelled at its cap, run 41100755426).
- **First noted:** 2026-11-01, review of PR 660 at `d2c9470`.
- **Last updated:** 2026-11-14, M60 close: resolved by PR 721, proof above.
