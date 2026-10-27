### KI-2026-10-26-y — `m38-personas` times out on a first attempt, at :112 (`choosePersona`) and at :191

- **Severity:** reliability. Failing first attempts of one e2e test. Not root-caused, so a
  product defect is not ruled out.
- **Area:** `apps/web/e2e/m38-personas.spec.ts`, the test "a persona survives a reload, shows on
  the invite before joining, and in People after" (:99): `preferencesSaved` (:52) and
  `choosePersona` (:63). Behind them, the `PATCH /api/account/preferences` the persona pick sends.
- **Symptom / What happens:**
  - **At :112.** `Error: page.waitForResponse: Test timeout of 90000ms exceeded.` at
    `preferencesSaved` (:52:15) ← `choosePersona` (:63:22) ← the test (:112:3), the owner's first
    persona pick. The PATCH that `preferencesSaved` waits on never answered OK within the test's
    time. PR 606 (M54 part 8), head `efcabce`, workflow run 40324190195, check run 121576597138
    (`test / e2e (1/2)`), where it was the job's one failure beside 7 flaky tests.
  - **At :191.** A first-attempt timeout at :191, `await context.close()` in the guest's
    `finally` block. Its run id was not recorded when this entry was filed. A timeout reported at
    a `finally` line may only be where the test's 90 s ran out, not the step that was slow.
- **Frequency known so far:** two first-attempt failures during M54 (2026-10-26), at two
  different lines. The location moving between runs points to a timeout (CLAUDE.md rule 2), not a
  defect that fails in one place.
- **Why not fixed here:** not root-caused; filed from M54's prose-only part 0.
- **Fix path / Tripwire:** on the next occurrence, record the run id and line here. Check whether
  the preferences PATCH was sent at all (a click that landed before the persona picker hydrated
  would send none) or was sent and slow. Run `pnpm --filter web test:e2e:ci-like
  e2e/m38-personas.spec.ts --repeat-each=10 --retries=0` to measure a rate.
- **Cross-reference:** M54 (parts 6–8, PR 604–PR 606); KI-20261024-c (CI red once, cause unknown).
- **First noted:** 2026-10-26, on PR 606's CI.
