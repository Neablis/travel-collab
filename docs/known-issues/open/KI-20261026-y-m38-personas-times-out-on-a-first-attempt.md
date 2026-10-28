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
- **Re-measured 2026-10-28 (KI sweep), not reproduced: 0 failed of 44** against a production build
  (`--repeat-each=10`, then `30`, then `4`, `--retries=0`, 4 workers); each run takes about 13 s
  of its 90 s, so a timeout from plain slowness would need a runner about 7x slower. A hang at :63
  is the PATCH wait never satisfied, not the clock. Ruled out by reading and a probe:
  the click-before-hydration hypothesis does not fit, because the Profile page is reached by a
  client-side `Link` and the name field is disabled until the preferences load; and clicking the
  already selected *Profile* tab (a `router.push("/account")` to the same URL) does not replace the
  field (probe: the same node, connected, for 1.5 s after the click, 10 of 10).
- **Hardened so the next occurrence names its cause (not a fix):** `preferencesSaved` in
  `e2e/m38-personas.spec.ts` used to wait for an OK PATCH only, so *never sent*, *sent and never
  answered* and *answered with an error* all ran out the test's 90 s at the wait. It now waits
  20 s for the request (`no PATCH /api/account/preferences was sent within 20000ms`), then its
  answer (`got no answer: <failure>`), then asserts the status (`answered 500: <body>`), and
  `choosePersona` checks the field holds the name before Enter. Each message seen red on purpose:
  `End` for `Enter` (not sent), `route.abort()` (`net::ERR_FAILED`), and a 500 from a route.
  Green after: 10 of 10. **Stays open** until a failure names the cause.
