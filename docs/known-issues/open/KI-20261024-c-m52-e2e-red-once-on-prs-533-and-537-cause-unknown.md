### KI-2026-10-24-c — CI's e2e went red once on PR 533 and once on PR 537, cause unknown

- **Severity:** reliability. Each passed on a later head; neither failure is tied to a change.
- **Area:** `.github/workflows/ci.yml`, `test / e2e (n/2)`.
- **Symptom / What happens:**
  - PR 533 (M52 part 4) at `0b661f4`: run 39910504198, job 120272183090, `test / e2e (1/2)`.
  - PR 537 (M52 part 8) at `99ca1f8`: run 40006602964, job 120596075094, `test / e2e (2/2)`.
  The only annotation on each is `Process completed with exit code 1`, so the failing spec is not
  named, and the job log cannot be read from a cloud session.
- **Why not fixed here:** nothing to act on yet. Next occurrence: download the run's Playwright
  report artifact (or have Mitchell open the log) and record the spec, test and message here. If
  the failure point moves between runs, treat it as a timeout (CLAUDE.md rule 2).
- **Cross-reference:** KI-2026-10-13-f (unreadable job logs); KI-2026-10-14-c (the unit job's
  equivalent).
- **First noted:** 2026-10-24, M52.
