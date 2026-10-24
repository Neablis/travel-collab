### KI-2026-10-19-c — `useTripSuggestions.test.tsx` fires `focus` (or `idle.fire()`) before the poll's listener exists, so CI's `test / unit` goes red once — RESOLVED

- **Severity:** reliability. Test-order noise only; the hook reads on focus in the product. One
  occurrence cost a push cycle on PR 499.
- **Area:**
  - `apps/web/src/components/trip/context/useTripSuggestions.test.tsx:108`, *reads at once when
    the poll's revision arrives before idle, and idle does not read again*:
    `act(() => void window.dispatchEvent(new Event("focus")))`, then `waitFor` at `:109`.
  - `apps/web/src/components/trip/context/useTripSuggestions.test.tsx:137`, the same race on the
    idle trigger: the `waitFor` after `idle.fire()` (`:136` at this branch's head), fired before
    the poll's effect has subscribed to it.
  - `apps/web/src/components/trip/context/broadcast.ts:261`, `window.addEventListener("focus",
    onFocus)`, which runs inside a `useEffect`.
- **Symptom / What happens:** `AssertionError: expected [] to deeply equal [ 'GET suggestions' ]`
  at `useTripSuggestions.test.tsx:109`. Red on PR 499 at `4c25771` (run 39272448301, job
  118128109363, `Test Files 1 failed | 459 passed (460)`); green on the next head. Not
  reproduced locally.
  - **Widened 2026-10-21:** the same race at `useTripSuggestions.test.tsx:137` (`idle.fire()`),
    on PR 510 (M51 part 2) at `f2f5c03`, a PR that touches nothing under `trip/context/`.
- **Cause (reasoned, not reproduced):** `mount("owner")` resolves before the poll's effect has
  attached its `focus` listener. If the effect has not run yet, the dispatched `focus` reaches no
  listener, no poll fires, and `waitFor` times out with nothing seen. A failure in the same
  place, so not a load timeout elsewhere; under load the effect simply runs later.
- **Why not fixed here:** found during M50's close, which is prose-only.
- **Fix direction:** flush effects after `mount()` (an `await act(async () => {})`) before
  dispatching, or dispatch `focus` inside the `waitFor` so it repeats until a listener answers.
  Fix both triggers, `:108`'s `focus` and `:137`'s `idle.fire()`, the same way.
  Prove it red first by delaying the listener's attach (e.g. wrap it in a `setTimeout`).
- **Cross-reference:** KI-2026-10-14-c (CI's unit job red once per PR; this is one more named
  cause); KI-2026-10-11-c (`suggestions.test.tsx` under full-suite load, a different file);
  KI-2026-10-13-f (job logs unreadable; this one was named from the check run's annotations).
- **First noted:** 2026-10-19, M50 part 7 (PR 499) at `4c25771`. Widened 2026-10-21 (`:137`, PR
  510 at `f2f5c03`).
- **Resolved, 2026-10-24 (KI sweep):** reproduced deterministically by delaying each
  subscription in product code (reverted): `window.addEventListener("focus", onFocus)` in
  `broadcast.ts` behind a 20 ms `setTimeout` gave CI's exact failure, `AssertionError: expected
  [] to deeply equal [ 'GET suggestions' ]` at `:109`; the `whenIdle` registration in
  `useTripSuggestions.ts` behind one gave the same message at `:137`. The cause is as reasoned:
  both subscriptions are made in passive effects, which can run after the render `mount` waited
  for. **Fix (test only):** `mount` now also waits until the poll has subscribed to `focus` (a
  spy on `window.addEventListener`), and every `idle.fire()` first waits for `idle.waiting()` to
  be 1, so *idle does not read again* and *reads nothing when it unmounts before idle* no longer
  pass vacuously when idle had not been scheduled yet. **Proof:** with both delays in place the
  file is `Tests 9 passed (9)`; without them, three runs of `9 passed`.
