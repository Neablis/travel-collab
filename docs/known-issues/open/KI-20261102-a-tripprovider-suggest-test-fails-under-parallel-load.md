### KI-2026-11-02-a — `TripProvider.suggest.test.tsx:161` fails intermittently under parallel load in `test / unit`

- **Severity:** reliability. A flaky unit test that turns a green PR red; no user-facing effect.
- **Area:** `apps/web/src/components/trip/context/TripProvider.suggest.test.tsx` (line 161, the final `leaving()` check after Send); `apps/web/src/components/trip/context/TripProvider.tsx` (the beforeunload guard, about line 1067).
- **Symptom / What happens:** "expected true to be false" on the final `leaving()` check after Send, in `test / unit` on CI. Seen for PR 683 at 10948f1, 2026-11-02. 5 of 5 isolated local runs pass. Under load the failure moves to `TripBoardScreen.routeBoundary.test.tsx`, the moving-location signature of a timing flake. Not from M44: the test and provider came in on main via PR 575 (a22db32) and are identical at 66d216c, which was green.
- **Why not fixed here:** M44 part 0 is prose only. Suspected, unverified: the beforeunload guard is added and removed in a `useEffect` that may not have flushed when `waitFor` sees count "0". The fix, if any, is test-only and goes on main.
- **Cross-reference:** PR 575, PR 683, M44.
- **First noted:** 2026-11-02, CI for PR 683 at 10948f1.
- **Re-verified 2026-11-14 (overnight KI sweep): not reproduced, left open.** 12 runs of the file (4
  at a time, load average 11 to 16 on 4 cores from other agents) and 16 runs of the test under six
  extra busy-loop CPU hogs all passed, as did 3 runs with an 8ms busy-wait added to `Probe`'s render.
  A temporary trace (a `MutationObserver` on the count, a wrapped `removeEventListener`) did confirm
  the suspected window: the DOM shows "0" first, the guard's `removeEventListener("beforeunload")`
  runs 1 to 34ms later in React's passive-effect flush, and `leaving()` runs after RTL's
  `asyncWrapper` `setTimeout(0)` drain. In every traced run the removal won, in several by under 1ms.
  The ordering rests on Scheduler's `setImmediate` firing before that `setTimeout(0)`, which nothing
  guarantees. The likely test-only fix is `await waitFor(() => expect(leaving()).toBe(false))` in
  place of line 161's bare `expect`. It still fails if the guard is never removed. It was not
  applied, because it could not be shown to fix a failure that was never produced here.
