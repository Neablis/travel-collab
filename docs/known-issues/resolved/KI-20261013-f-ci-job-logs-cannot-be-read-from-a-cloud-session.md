### KI-2026-10-13-f — CI job logs cannot be read from a cloud session, so a red job is triaged blind — RESOLVED

- **Severity:** reliability. A red CI job's cause can't be read from a cloud session, so it gets
  guessed from annotations or a local repro, and a guess can be wrong.
- **Area:** `.claude/skills/ci-triage/SKILL.md` (it fetches `--log-failed` logs);
  `docs/guidelines/cloud-agent-sessions.md`.
- **Symptom:** on PR 433, `gh run view --log-failed` and the jobs/logs API both redirect to
  `*.blob.core.windows.net` or `results-receiver.actions.githubusercontent.com`. The container's
  agent proxy refuses CONNECT to those hosts with a 403. WebFetch refuses the signed URL as too
  long. Claude in Chrome was not connected. So two red jobs went unread:
  - `static / lint`: its annotation said only `exit code 134`. A local repro under a 2 GB heap
    showed an eslint out-of-memory crash, fixed in PR 433 with a 4 GB heap.
  - `test / unit` on `6f52dbd` and `bf732d9`: its annotation said only `exit code 1`. The
    cause was never confirmed. It went green on `85b3062`, and KI-2026-10-11-c fits but is
    unproven.
  Check-run annotations (`gh api repos/<repo>/check-runs/<id>/annotations`) are readable and are
  the only signal available.
- **Why not fixed here:** filed with KI-2026-10-13-e on Mitchell's call (2026-10-13), as part of
  reworking orchestrator sessions. **Likely fix:** allow the GitHub Actions log hosts through the
  session's network policy. Failing that, write failing test names and error lines into the
  job's annotations or step summary (`$GITHUB_STEP_SUMMARY`, readable through the API), so the
  cause can be read without the log.
- **Cross-reference:** KI-2026-10-11-c; KI-2026-10-13-e; PR 433.
- **First noted:** 2026-10-13, during M46 part 1's review.
- **In-repo half done (2026-10-28, KI sweep):** `test / unit` already wrote its failure lines to
  the step summary and one `::error`; that block is now `scripts/ci-failure-summary.sh`, and
  `test / scripts` (node:test, which has no annotating reporter) and `test / integration` run
  through it too. `apps/web/vitest.config.ts` (the integration lane) now adds vitest's
  `github-actions` reporter when `GITHUB_ACTIONS=true`, as `vitest.unit.config.ts` does, so each
  failed integration test is annotated with its name, line and first error. Proven locally: a
  scratch failing `*.int.test.ts` under `GITHUB_ACTIONS=true` printed
  `::error file=…,title=src/zz-ki-scratch.int.test.ts > scratch%3A a red integration test names itself,line=4,…::AssertionError: expected 2 to be 3`
  and, against `main`'s config, no `::error` line at all; a failing node:test file through the
  wrapper gave `::error title=test / scripts exited 1::✖ the journal wall rejects a renumber …
  AssertionError [ERR_ASSERTION]: …`. Not yet seen on a real red CI run.
- **Still open because:** the log hosts (`*.blob.core.windows.net`,
  `results-receiver.actions.githubusercontent.com`) are still refused by the session's network
  policy, which is not repo code. The e2e jobs and `static /` jobs are not wrapped: e2e already
  uses Playwright's `github` reporter, and typecheck/lint are annotated by setup-node's problem
  matchers.
- **Fix (2026-11-14, KI sweep):** the in-repo half is finished. The log hosts are still refused,
  but every test job now names its failures in an annotation, and `ci-triage` reads those.
  - **The step summary is not readable over REST.** The "Likely fix" above assumed it was. On
    run 43118939246, the wrapper filled `test / unit`'s summary, yet
    `gh api …/check-runs/130854188487` returns `"output":{"summary":null,"text":null,…}`. The
    annotations from the same run did name the cause: `test / unit exited 1` with the log lines,
    and vitest's `[node] src/server/public-api/exposure.test.ts > … :: AssertionError: …`. So the
    annotation is what carries the information. `scripts/ci-failure-summary.sh` says so now.
  - **e2e goes through the wrapper.** `ci.yml`'s `test:e2e` step runs as
    `bash scripts/ci-failure-summary.sh "test / e2e (<shard>/2)" …`. A web server that never
    came up, or a global setup that threw, now produces an annotation too, not only the bare
    exit code. The wrapper's grep keeps Playwright's failure header, its `N failed` tally and the
    list of failed tests. It drops the progress lines, which name passing tests as well. Local
    sample: a scratch failing spec run through the wrapper under `GITHUB_ACTIONS=true` gave
    `::error title=test / e2e (1/2) exited 1::  1) zz-ki-scratch/fail.spec.ts:3:1 › scratch: a red
    e2e test names itself%0A    Error: expect(received).toBe(expected) …%0A  1 failed%0A …`,
    next to the `github` reporter's own per-test `::error file=…,title=…,line=4`. Before this
    change the wrapper kept only the `Error:` line, with no test name.
  - **Regression test:** `scripts/__tests__/ci-failure-summary.test.mjs` (3 tests). With the
    Playwright patterns removed, it fails with `actual: [ '    Error: expect(received)…', '' ]`.
  - **`ci-triage`** §2 now prints each annotation's title, says the step summary is web-only,
    and notes the 10-errors-per-step cap. §3 reads e2e failures from the reporter's annotations
    instead of grepping a log it cannot fetch.
  - **Not yet seen on CI:** the e2e wrapper on a real red e2e run.
  - **Outside the repo:** allowing the log hosts through the session's network policy.
