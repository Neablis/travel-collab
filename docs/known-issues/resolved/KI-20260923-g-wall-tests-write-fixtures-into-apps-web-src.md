### KI-2026-09-23-g — the wall tests write their fixtures into `apps/web/src`, so a typecheck or lint running at the same time sees them — RESOLVED

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
- **Resolved:** 2026-09-24. Two walls, two mechanisms. The lint-wall files were
  never written by a test: `scripts/check-lint-wall.mjs` wrote them itself, with
  FIXED names, on every `pnpm lint` as well as in its test.
  **Color wall:** it followed the fix path. `check-color-wall.mjs` takes
  `COLOR_WALL_SCAN_ROOT`, a directory that stands in for the repo root when
  listing and reading scanned files. It defaults to the working directory, so
  `pnpm lint` is unchanged. `globals.css` and the pending list are still read from
  the real checkout. `runWallAgainst` in the test now `git init`s a temp repo and
  writes the fixture untracked at `apps/web/src/fixture/<name>`, so the same
  `git ls-files --others` pathspec still finds it.
  **Lint wall:** `lintFixture` pipes the fixture to ESLint with
  `--stdin --stdin-filename <relative>`, so nothing is written to disk. Flat-config
  `files` blocks, `import/no-restricted-paths` and ignore warnings all key off
  that name. Measured: a stdin fixture named `src/server/ai/__probe__.ts`
  importing the gateway drew both rules, and no file was created.
  **Reproduced first.** Polling `apps/web/src` during
  `node --test scripts/__tests__/check-color-wall.test.mjs` showed eight
  `apps/web/src/__color-wall-fixture-*` directories. Polling during
  `node scripts/check-lint-wall.mjs` showed twelve, including
  `src/server/ai/__lint_wall_gateway_fixture__.ts` and
  `src/server/assistant/__lint_wall_kernel_playbooks_fixture__.ts`.
  **Proof.** The same polls now show nothing, and both test files pass: color
  11/11, lint 4/4. The lint wall printed the same 31 OK lines before and after.
  Seen red:
  1. With `hexWithLetter` disabled in the wall, the sandboxed fixture test failed
     with `expected line 1 to be flagged`.
  2. With the lint wall's `--stdin-filename` removed, the test failed with
     `LINT WALL BREACHED: forbidden @tc/domain import from UI … (fired instead: nothing)`.
  3. With the default root pointed at a directory that scans nothing, the real-tree
     test failed on a new floor assertion:
     `expected the default root to scan the real apps/web/src; got: color wall OK (0 files scanned, …)`.
     Before this change that run exited 0 and nothing caught it. The floor is the
     regression guard for the "keep one test against the real root" half of the
     fix path.
  The first sandbox attempt, with the fixture directly in `src/`, went 5 red
  because the wall saw nothing. That is how the pathspec gap below was found.
  **Left open, not fixed here:** the color wall's pathspec
  `apps/web/src/**/*.ts` needs a `/` after `src/`. So `apps/web/src/proxy.ts`,
  `config.ts`, `config.test.ts`, `instrumentation.ts` and
  `instrumentation-client.ts` are never scanned.
