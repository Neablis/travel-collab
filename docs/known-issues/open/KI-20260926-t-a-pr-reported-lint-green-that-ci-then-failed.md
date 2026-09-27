### KI-2026-09-26-t — a PR reported `pnpm lint` green, then CI's `static-and-unit` failed on an ESLint error the local run never saw

- **Severity:** reliability. It costs a CI cycle and the reviewers' trust, and it makes
  a PR's "Verification actually performed" section claim something the pushed head
  does not satisfy. File it to fix soon: every agent-written PR relies on that
  section.
- **Area:** agent verification practice, not product code. The checklist lives in
  `AGENTS.md` (Definition of Done), `docs/guidelines/testing.md`, the
  `minimal-check-subset` skill and `.github/PULL_REQUEST_TEMPLATE.md`. The rule that
  fired was `playwright/no-conditional-in-test`, run by `apps/web`'s
  `eslint --max-warnings 0 src e2e *.ts`. The repo has no git hook (`core.hooksPath`
  is unset and there is no `.husky/`), so nothing local re-runs lint before a push.
- **Symptom / What happens:**
  - The branch was PR #252 (`claude/plan-page-ui-redesign-lj6l80-compose-turns`).
    Mitchell referred to it as #251, the phone-river PR, which never failed lint.
  - The agent's report and the PR body both said root `pnpm lint` passed.
  - CI's `static-and-unit` on head `9d474ba` failed with
    `apps/web/e2e/m10-simulated-ai.spec.ts 397:5 / 397:9 error Avoid having conditionals in tests playwright/no-conditional-in-test`.
    A local re-run of root `pnpm lint` on that same head exited 1 with the same two
    errors.
  - Fixed in `ec7eaa2` by moving the walk into a helper outside the test body.
- **Why it happened:** the agent had run root `pnpm lint` (exit 0), then added the new
  e2e test, then ran only the e2e and unit lanes before pushing. The lint result it
  reported belonged to an earlier tree than the one it pushed. No step tied a
  reported check to the sha that was pushed.
- **Not the cause, checked:** eslint was not misconfigured, and CI does not lint
  differently from local. The same command gives the same two errors on the same
  head.
- **Why not fixed here:** Mitchell asked for the entry, not the fix (2026-09-27).
- **Intended fix (pick one or both):**
  - A `pre-push` hook, or a `pnpm verify` script, that runs lint on the changed
    packages against the tree being pushed.
  - A verification record that stamps each check with the `HEAD` sha it ran on. The PR
    template and the agent report then cite that sha, and a mismatch with the pushed
    head is visible.
- **Cross-reference:** CLAUDE.md rules 3–4 (verification scales to the change) and
  AGENTS.md's Definition of Done. The agent's own admission is in PR #252's
  follow-up commit `ec7eaa2`.
- **First noted:** 2026-09-26. PR #252's first CI run was red on lint after the PR
  claimed lint was green.
