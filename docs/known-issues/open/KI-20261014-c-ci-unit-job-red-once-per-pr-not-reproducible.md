### KI-2026-10-14-c — CI's `test / unit` goes red once on a PR, then green, and never reproduces locally

- **Severity:** reliability. Each time it costs a re-run or a push cycle, and because the job log
  can't be read from a cloud session (KI-2026-10-13-f), every occurrence is triaged blind.
- **Area:** `.github/workflows/ci.yml` (`test / unit`, step "Run pnpm test:unit"); the web unit
  lane.
- **Symptom:** across M46, `test / unit` went red once on four PRs. Each time the only annotation
  was `Process completed with exit code 1`, and the next run or head was green with no change
  that touches a unit test:
  - PR 441 at `d0524ea`
  - PR 442 at `d70caae`
  - PR 444 at `c33ef09` (job 115627045967); green on `7c597ec`, whose diff is a test and two KI files
  - PR 446 at `02c55a7` (job 115627633453); re-run requested 2026-10-14
  Locally, on `c33ef09`, the full `pnpm test:unit` run under Node 24.21, `TZ=UTC` and `CI=true`
  passed twice (web: 424 files, 6029 tests). The four chat test files that PR changes passed in
  five runs of their own. The PR 441 and PR 442 failures did not reproduce either (three full web
  runs).
- **Why not fixed here:** the failing test's name is not visible from here. **Likely suspects
  (unproven):** the unseeded property floors KI-2026-10-05-b, KI-2026-10-12-a and KI-2026-10-12-f,
  each of which has turned `test / unit` red once on a PR that did not touch its code, and
  KI-2026-10-11-c (`suggestions.test.tsx` under full-suite load). **Next step:** read one failing
  job's log from a machine that can reach the Actions log hosts. Alternatively, have the unit job
  write vitest's failing test names to `$GITHUB_STEP_SUMMARY` or upload its JSON/junit report as
  an artifact, so the name can be read through the API.
- **Cross-reference:** KI-2026-10-13-f; KI-2026-10-11-c; KI-2026-10-05-b; KI-2026-10-12-a;
  KI-2026-10-12-f; PR 441, PR 442, PR 444, PR 446.
- **First noted:** 2026-10-14, during M46's walk changes.
