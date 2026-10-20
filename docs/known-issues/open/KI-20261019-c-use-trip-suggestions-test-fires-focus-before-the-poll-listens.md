### KI-2026-10-19-c — `useTripSuggestions.test.tsx` fires `focus` before the poll's focus listener exists, so CI's `test / unit` goes red once

- **Severity:** reliability. Test-order noise only; the hook reads on focus in the product. One
  occurrence cost a push cycle on PR 499.
- **Area:**
  - `apps/web/src/components/trip/context/useTripSuggestions.test.tsx:108`, *reads at once when
    the poll's revision arrives before idle, and idle does not read again*:
    `act(() => void window.dispatchEvent(new Event("focus")))`, then `waitFor` at `:109`.
  - `apps/web/src/components/trip/context/broadcast.ts:261`, `window.addEventListener("focus",
    onFocus)`, which runs inside a `useEffect`.
- **Symptom / What happens:** `AssertionError: expected [] to deeply equal [ 'GET suggestions' ]`
  at `useTripSuggestions.test.tsx:109`. Red on PR 499 at `4c25771` (run 39272448301, job
  118128109363, `Test Files 1 failed | 459 passed (460)`); green on the next head. Not
  reproduced locally.
- **Cause (reasoned, not reproduced):** `mount("owner")` resolves before the poll's effect has
  attached its `focus` listener. If the effect has not run yet, the dispatched `focus` reaches no
  listener, no poll fires, and `waitFor` times out with nothing seen. A failure in the same
  place, so not a load timeout elsewhere; under load the effect simply runs later.
- **Why not fixed here:** found during M50's close, which is prose-only.
- **Fix direction:** flush effects after `mount()` (an `await act(async () => {})`) before
  dispatching, or dispatch `focus` inside the `waitFor` so it repeats until a listener answers.
  Prove it red first by delaying the listener's attach (e.g. wrap it in a `setTimeout`).
- **Cross-reference:** KI-2026-10-14-c (CI's unit job red once per PR; this is one more named
  cause); KI-2026-10-11-c (`suggestions.test.tsx` under full-suite load, a different file);
  KI-2026-10-13-f (job logs unreadable; this one was named from the check run's annotations).
- **First noted:** 2026-10-19, M50 part 7 (PR 499) at `4c25771`.
