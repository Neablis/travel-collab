### KI-2026-11-02-a — `TripProvider.suggest.test.tsx:161` fails intermittently under parallel load in `test / unit`

- **Severity:** reliability. A flaky unit test that turns a green PR red; no user-facing effect.
- **Area:** `apps/web/src/components/trip/context/TripProvider.suggest.test.tsx` (line 161, the final `leaving()` check after Send); `apps/web/src/components/trip/context/TripProvider.tsx` (the beforeunload guard, about line 1067).
- **Symptom / What happens:** "expected true to be false" on the final `leaving()` check after Send, in `test / unit` on CI. Seen for PR 683 at 10948f1, 2026-11-02. 5 of 5 isolated local runs pass. Under load the failure moves to `TripBoardScreen.routeBoundary.test.tsx`, the moving-location signature of a timing flake. Not from M44: the test and provider came in on main via PR 575 (a22db32) and are identical at 66d216c, which was green.
- **Why not fixed here:** M44 part 0 is prose only. Suspected, unverified: the beforeunload guard is added and removed in a `useEffect` that may not have flushed when `waitFor` sees count "0". The fix, if any, is test-only and goes on main.
- **Cross-reference:** PR 575, PR 683, M44.
- **First noted:** 2026-11-02, CI for PR 683 at 10948f1.
