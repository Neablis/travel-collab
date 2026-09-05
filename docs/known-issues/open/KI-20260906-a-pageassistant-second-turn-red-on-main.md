### KI-2026-09-06-a — two `PageAssistant` unit tests are red on `main`, unfiled, and the local unit lane has never been green because a second failure was masking them

- **Severity:** correctness, unproven — the two tests assert that a second assistant turn ACCUMULATES rather than replacing the first, which is user-visible behaviour if genuinely broken. What is certain is the process failure: `main` is red on the unit lane and nothing recorded it.
- **Area:** `apps/web/src/components/pages/PageAssistant.test.tsx` — "accumulates a second turn instead of replacing the first" and "posts the whole conversation back on the second turn, assistant turns included"; the component under it, `apps/web/src/components/pages/PageAssistant.tsx`.
- **Symptom:** under Node 22 — CI's version, `.github/workflows/ci.yml:107,142` — `pnpm --filter web exec vitest run -c vitest.unit.config.ts` gives `Tests 2 failed | 2293 passed | 1 skipped`. The failure is a `waitFor` timeout on the second call:

  ```
  ❯ src/components/pages/PageAssistant.test.tsx:162:50
    await waitFor(() => expect(askAssistantMock).toHaveBeenCalledTimes(2))
  ```

- **It is NOT this branch, and it is NOT a flake.** Verified by checking out `origin/main` detached and running the file alone: the same two tests fail, by name. Per `CLAUDE.md` rule 2, a failure whose location *moves between runs* is a timeout and one that fails in the same place every time is a real defect — this one is in the same place every time, on two different trees, which is why it is filed rather than retried.
- **Why it went unnoticed:** the local unit lane was ALREADY red from **KI-2026-09-02-a** (Node 26 makes `window.localStorage` undefined, 12 failures in `pendingDemoClone.test.ts`). Anyone who ran the lane locally saw 14 failures, recognised the documented Node-26 ones, and had no reason to look at the count. Dropping to Node 22 removes 12 and leaves these 2 standing. **A known-red lane hid a second, unknown failure — that is the real finding here**, and it is the same species as KI-13/76 and KI-2026-09-05-s: a signal nobody could read.
- **Open question this entry does not answer:** whether CI is green on `main` today. If it is, the difference between CI's runner and a local Node 22 is itself worth knowing; if it is not, `main` has been shipping red.
- **Why not fixed here:** found during the 2026-09-05 KI sweep's single Tier-3 `pnpm check`, on a branch whose six merged fixes are unrelated to this component. Fixing it there would have widened a ready diff into a component nobody in the sweep touched.
- **First noted:** 2026-09-06, during the KI sweep's final verification.
