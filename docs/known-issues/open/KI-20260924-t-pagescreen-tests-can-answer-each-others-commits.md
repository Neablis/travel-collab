### KI-2026-09-24-t — a PageScreen test's unmount commit can be answered by the next test's handlers

- **Severity:** reliability (latent flake source; not observed failing in correct code).
- **Milestone:** M14, carried rather than gating.
- **Area:** `apps/web/src/components/pages/PageScreen.test.tsx` (`afterEach`), `apps/web/src/components/pages/useEditSession.ts` (the unmount commit).
- **Symptom / What happens:**
  - `afterEach` unmounts `PageScreen`, and unmounting fires the session's final commit. That PATCH can still be in flight when the next test installs its MSW handlers, so the next test's handler answers it.
  - This was seen only under deliberate mutations during the stale-save fix: a leaked PATCH moved a later test's page revision. It was never seen with the code correct.
- **Fix when it bites:** await settled commits before resetting handlers (for example, `await waitFor` on no requests in flight in `afterEach`), or give each test its own page id so a leaked write can't match.
- **First noted:** 2026-09-24, stale-save fix on PR #222.
