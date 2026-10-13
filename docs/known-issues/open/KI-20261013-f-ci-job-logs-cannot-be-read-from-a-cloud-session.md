### KI-2026-10-13-f — CI job logs cannot be read from a cloud session, so a red job is triaged blind

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
