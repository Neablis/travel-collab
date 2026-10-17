### KI-2026-10-17-b — `github-advanced-security` fails again on PRs that cannot have caused it

- **Severity:** noise. It is not a required check (`ci-ok` is), and nothing it reports reaches
  the PR: its only annotation is `Process completed with exit code 1` at `.github:211`.
- **Area:** GitHub's agentic code scanning (`github-advanced-security`, run by the
  `github-actions` app), not a workflow in this repo.
- **Symptom:** red on PR 466, PR 468, PR 469 (a docs-only change, merged) and PR 470 (heads
  `039edf6`, `b3b046a`); green on PR 467. Every other check on those heads passed. The pattern
  matches KI-2026-09-02 (`resolved/KI-20260902-ghas-code-scanning-fails-on-an-unavailable-model.md`),
  which cleared on its own on 2026-09-03.
- **Why not fixed here:** the job log is the only place the cause is written, and a cloud session
  cannot read it (KI-2026-10-13-f: the log redirects to a blob host the proxy refuses). The code
  scanning alerts API answers 403 from here as well.
- **Fix direction:** read the job log from a laptop or the Actions UI. If it is the unavailable
  model again, wait it out as before; if it is a real finding, it names a file.
- **First noted:** 2026-10-17, on PR 470.
