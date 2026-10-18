### KI-2026-10-17-b — `github-advanced-security` fails again on PRs that cannot have caused it

- **Severity:** noise. It is not a required check (`ci-ok` is), and nothing it reports reaches
  the PR: its only annotation is `Process completed with exit code 1` at `.github:211`.
- **Area:** GitHub's agentic code scanning (`github-advanced-security`, run by the
  `github-actions` app), not a workflow in this repo.
- **Symptom:** red on PR 466, PR 468, PR 469 (a docs-only change, merged) and PR 470 (heads
  `039edf6`, `b3b046a`); green on PR 467. Every other check on those heads passed. Red again on
  PR 478 and PR 479 (both docs-only, merged), where a re-run was refused (`403 This workflow run
  cannot be retried`).
- **Cause (read 2026-10-18, by Mitchell, from run 39095596784 on PR 479):** a quota, not a
  finding. The scanner's `autofind` step fails with
  `SessionModelError: You have exceeded your monthly quota`, `statusCode: 402`,
  `errorCode: "quota"`: the account's monthly allowance for GitHub's AI-powered scanning is used
  up, so every PR fails until it resets or is raised. A cousin of KI-2026-09-02
  (`resolved/KI-20260902-ghas-code-scanning-fails-on-an-unavailable-model.md`, an unavailable
  model), which cleared on its own on 2026-09-03.
- **Why not fixed here:** it is an account setting, not code. A cloud session cannot read the job
  log either (KI-2026-10-13-f: the log redirects to a blob host the proxy refuses); the cause
  above came from the Actions UI.
- **Fix direction:** Mitchell's call, one of three. Wait for the monthly reset (it should go
  green by itself). Raise the budget or spending limit for GitHub's AI features in the account's
  billing settings. Or turn the AI-powered scanning off for this repo in its code security
  settings, if CodeQL (green on every PR) is enough. Move this entry to `resolved/` once a PR shows
  it green again, naming that PR.
- **First noted:** 2026-10-17, on PR 470.
