### KI-2026-09-05-s — `check-lint-wall.mjs` and `check-case-collisions.mjs` are in `pnpm lint` and neither has ever been shown to fail — RESOLVED

> **RESOLVED 2026-09-05. Filed as cleanup on suspicion; reproducing it found a
> real defect in `check-lint-wall.mjs`, which was blind in two ways.**
>
> **The reproduction.** `lintFixture` read "eslint exited non-zero" as "the rule
> under test fired", and several fixtures trip more than one rule. Turning
> `playwright/expect-expect` off in `apps/web/eslint.config.mjs` left the wall
> printing all thirteen lines including `test-quality wall OK: e2e spec without
> an assertion correctly rejected`, exit 0 — the cosmetic
> `playwright/consistent-spacing-between-blocks` was doing the rejecting. Same
> shape for the gateway fixture (`no-restricted-imports` +
> `import/no-restricted-paths`) and the container fixture
> (`testing-library/no-container` + `no-node-access`). Worse: with an
> `eslint.config.mjs` that throws on load — ESLint running zero rules — the wall
> printed five `lint wall OK: ... correctly rejected` lines. That is KI-13/76's
> shape ("`pnpm check` exiting 0 having run zero integration tests") inside
> `pnpm lint`.
>
> **The fix.** `lintFixture` now runs `eslint -f json -o <tmpfile>` and returns
> the **rule ids** that produced errors (`-o` rather than stdout because
> `pnpm exec` appends its own `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL` line to
> stdout, so no bracket-matching survives). `expectRejectedBy(result, ruleId,
> label)` replaces every `if (result.passed)`, so each assertion names the rule
> it guards; a missing JSON report is reported as `LINT WALL CANNOT RUN` and
> fails, instead of reading as a rejection. `noRestrictedImportPatterns` returns
> `null` rather than throwing a 60-line stack trace on the same condition. A
> `LINT_WALL_ESLINT_CONFIG` env seam (unset in `pnpm lint`, so the command line
> is unchanged there) lets the self-test point the wall at a sabotaged config.
>
> **The proof.** `scripts/__tests__/check-lint-wall.test.mjs` (4 tests) and
> `scripts/__tests__/check-case-collisions.test.mjs` (7 tests). Every one was
> seen red first: the lint-wall tests all fail against the pre-fix wall — test 2
> with `actual: 0, expected: 1`, i.e. the old wall exiting **green** with
> `playwright/expect-expect` and `testing-library/no-container` switched off —
> and the case-collision tests go red when `file.toLowerCase()` is sabotaged to
> `file` (3 red) or to a basename (the negative test, 1 red). Checks run
> (`minimal-check-subset`; nothing under `packages/contracts/src`, no workspace
> package touched): `node --test "scripts/**/__tests__/**/*.test.mjs"`,
> `node scripts/check-lint-wall.mjs`, `node scripts/check-case-collisions.mjs`,
> `node scripts/check-ki-filenames.mjs`.
>
> **Two things found and deliberately left alone**, both belonging in their own
> entries rather than here:
> 1. `check-case-collisions.mjs` does **not** catch the KI-33 pair its own
>    header comment cites. `UnscheduledRack.tsx` and `unscheduledRack.ts` differ
>    in extension as well as case, so lowercased they are two different strings
>    and the whole-path comparison sees nothing. The real KI-33 collision was at
>    the module-specifier level (`@/components/trip/UnscheduledRack` resolves
>    extension-last). Pinned as a characterisation test that says, in its own
>    assertion message, to be rewritten red-first when the gap is closed.
> 2. The same wall reads plain `git ls-files`, so an **untracked** colliding file
>    is invisible to it — the exact blind spot KI-51 found in the colour wall and
>    fixed there with `--others --exclude-standard`. Also pinned by a scope test.

- **Severity:** cleanup (no known defect — but this is the exact species that produced five known issues, every one found by looking rather than by failing)
- **Area:** `scripts/check-lint-wall.mjs` and `scripts/check-case-collisions.mjs`, both wired into root `pnpm lint` (`package.json:12`); `scripts/__tests__/`, which covers `check-color-wall`, `check-sleep-wall`, `check-ki-filenames`, `redfirst` and `state-digest` — and neither of these two
- **Symptom / What happens:** a wall whose scope or sensitivity was asserted but never demonstrated against a known violation cannot tell you it has gone blind. That is KI-13/76 (`pnpm check` exiting 0 having run zero integration tests), KI-51 (the colour wall blind to untracked files), KI-2026-08-30-b (`eslint src` never seeing root files or `e2e/`), KI-2026-09-01 (CodeRabbit green while skipping the review) and KI-2026-09-02-a (Node 26 red locally, CI green). These two scripts are the remaining places the species can recur.
- **Why not fixed here:** found by a read-only review; no code was changed by it. **Correction carried from the finding:** its first draft also counted `check-auth-proxy.mjs` as an untested wall; the verifier established it is a manual deployment probe, not a wall, and it is not part of this entry.
- **Suggested fix:** red-first for walls — each script gets a fixture that must fail, plus a scope test proving what it does and does not reach. This is the same discipline CLAUDE.md rule 3 states for tests, applied to the things that check the tests.
- **Cross-reference:** [F-E06](../../reviews/2026-09-05-overnight-review/findings/F-E06-two-walls-have-no-self-test-packages-unlinted.md) (LOW-MEDIUM, CONFIRMED and narrowed); **KI-2026-09-02-c** carries the other half of this finding (`packages/*` are not linted at all, so the test-quality and element walls stop at `apps/web`) and is where that half should be resolved; resolved KI-13, 51, 76, KI-2026-08-30-b; KI-2026-09-01.
- **First noted:** 2026-09-05, overnight review stream E.
