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
- **Third occurrence, 2026-10-24 (KI sweep):** PR 550 at `053efda`: run 40142324030, job
  121016569726, `test / e2e (2/2)`, again annotated only `Process completed with exit code 1`.
  The PR changed only `components/chat/` (two files plus tests); `m46-trip-chat.spec.ts` and
  `m46-chat-unread-home.spec.ts` passed 5/5 under `test:e2e:ci-like` at that head, and
  PR 551's run of the same shard passed. The failed jobs were re-run once.
- **Naming the next one (2026-10-24):** `playwright.config.ts` now adds Playwright's `github`
  reporter when `GITHUB_ACTIONS` is set, so the next e2e red carries a check-run annotation with
  the spec, test and message — read it with
  `gh api repos/Neablis/travel-collab/check-runs/<job-id>/annotations`. The entry stays open
  until an occurrence is named and its cause found.
- **Cross-reference:** KI-2026-10-13-f (unreadable job logs); KI-2026-10-14-c (the unit job's
  equivalent).
- **First noted:** 2026-10-24, M52.
