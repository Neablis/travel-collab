### KI-2026-09-23-g — the wall tests write their fixtures into `apps/web/src`, so a typecheck or lint running at the same time sees them

- **Severity:** reliability, for parallel work in one checkout only. CI runs its
  jobs in separate checkouts and never sees it.
- **Area:** `scripts/__tests__/check-color-wall.test.mjs` (`FIXTURE_PREFIX =
  "apps/web/src/__color-wall-fixture-"`), and any other `scripts/**/__tests__`
  that plants a file under `apps/web/src` for the wall to find.

- **Symptom:** while `node --test scripts/**/__tests__/**/*.test.mjs` runs, files
  appear in `apps/web/src` and are then deleted:
  `__color-wall-fixture-*/`, and during M27 also
  `__lint_wall_gateway_fixture__.ts`, `__lint_wall_kernel_playbooks_fixture__.ts`
  and `__lint_wall_gateway_relative_fixture__.ts`. A `tsc --noEmit` or ESLint
  pass over `src` that overlaps with them reports errors in files that no longer
  exist when you look. During M27, two subagents in one checkout lost several
  verification runs to this before `ps` showed the cause.
- **Why the fixtures are there:** the walls scan `apps/web/src`, so a fixture
  has to be inside the scanned tree to prove the wall fires. The per-call
  `mkdtempSync` name already keeps them from colliding with each other or with
  real work.
- **Fix path:** let each wall take its scan root as an argument (or an env
  variable), and have the tests point it at a temp directory outside the repo.
  Keep one test that runs against the real root with no fixture, so the default
  root is still covered.
- **Cross-reference:** `docs/guidelines/cloud-agent-sessions.md` (parallel
  agents in one container).
- **First noted:** 2026-09-23, M27 link 10's follow-up.
