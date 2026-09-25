### KI-2026-09-25-p — a plan version that exists only in one integration test leaks into another test's database reads

- **Severity:** test reliability. It fails a real `test:int` lane, depending on the order the files run in within one run, so it is intermittent.
- **Area:** `apps/web/src/server/entitlements/planVersions.republish.int.test.ts` publishes `plus@v2`, which exists only inside that file, and writes grants on it. `apps/web/src/server/entitlements/adminOverview.int.test.ts` (added in #234) reads every active grant holder in the database. Neither truncates or cleans up.
- **Symptom:** `adminOverview > reads the trailing ledger once and the active grant holders once` fails with `UnknownPlanVersionError: Plan version "plus@v2" is not published in this deploy`, from `planVersionFromRef` via `entitlementsFor`.
  - It failed once in a full `pnpm test:int` run: 1 of 1082.
  - Run on its own, `adminOverview.int.test.ts` passes on both `origin/main` (`609b635`) and the M24 stack, so the leftover grant does not persist between runs. The failure depends on another file writing a `plus@v2` grant earlier in the same run.
  - Presumed cause, not yet reproduced by forcing file order: the republish file's grant is the only `plus@v2` writer in the suite.
- **Found:** 2026-09-25, the Tier 3 `pnpm check` on the M24 stack (#229–#233) after `main` (#234) was merged in. M24 touches no entitlements code or tests.
- **Proposed fix:** the republish test deletes the grants and ledger rows it wrote (`afterAll`, scoped to its own user ids), so a test-only version never outlives the file that publishes it. Alternatively, adminOverview could scope its read to the users it creates. The first is better: the leak is the republish file's.
- **First noted:** 2026-09-25.
