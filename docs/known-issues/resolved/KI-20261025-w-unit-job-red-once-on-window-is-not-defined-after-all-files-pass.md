### KI-2026-10-25-w — `test / unit` went red once with all files passing, on an unhandled "window is not defined" from TripHeader.test.tsx — RESOLVED

- **Severity:** reliability. Four occurrences so far (PR 585, PR 605, PR 624, PR 626) each failed `ci-ok` on a PR; on the first two, a re-run of the same commit passed.
- **Area:** `apps/web/src/components/trip/TripHeader.test.tsx`, and the cover band it renders (`apps/web/src/components/trip/cover/`).
- **Symptom / What happens:** vitest reported all 477 unit files as passing. It then failed the job on `Unhandled Rejection … ReferenceError: window is not defined`, with the origin given as `src/components/trip/TripHeader.test.tsx` and no stack captured.
- **Evidence (the occurrence):**
  - PR 585 (M49 part 4), head `02c81f3`, check run 121105442483, workflow run 40172261036.
  - A re-run of the failed job on the same head passed, and `ci-ok` went green.
  - The previous heads `2fe5de4` and `d1de48f` passed `test / unit`.
  - Locally, `vitest run -c vitest.unit.config.ts src/components/trip/TripHeader.test.tsx` passed 39/39 every time, including under CPU load with `--maxWorkers=1` and with network calls slowed by 400 and 1500 ms.
- **Evidence (a second occurrence):**
  - PR 605 (M54 part 7), head `053dfaf`, workflow run 40336740519, attempt 1, check run 121620304186.
  - The same symptom: all 493 unit files passed, then `Unhandled Rejection … ReferenceError: window is not defined`, originating in `src/components/trip/TripHeader.test.tsx`.
  - Attempt 2 of the same run, on the same head, passed.
- **Evidence (a third occurrence):**
  - PR 624 (M55 part 10), head `1bbbfd4`, workflow run 40612516561, check run 122567262181.
  - The same symptom: all 508 unit files passed, then the same rejection from `TripHeader.test.tsx`. The PR changed only server-side MCP files.
  - Locally, the file alone (40/40), the file with both cover-band tests in one worker (`--maxWorkers=1`, three runs), and all of `src/components/trip/` (`--maxWorkers=2`, 39 files) passed with no unhandled error.
  - An unconfirmed suspect: the file's last test ends on a `waitFor` for a re-read of the trip, whose continuation can settle after cleanup.
- **Evidence (a fourth occurrence):**
  - PR 626 (M55 part 11), head `cd67a7a`, workflow run 40625538441, check run 122609469070.
  - The same symptom: all 509 unit files passed, then the same rejection from `TripHeader.test.tsx`. The PR changed only server-side MCP and public-API files.
  - Locally, the file alone passed 40/40.
- **Why not fixed here:** the error did not reproduce, so there was nothing to fix it against. The suspected cause is an async callback (an image load, a timer or a fetch continuation) in the header or cover band settling after jsdom is torn down. That is not confirmed.
- **Fix path / Tripwire:** on the next occurrence, record the run here. If it recurs, find the late callback by making vitest fail on unhandled rejections with a stack (`dangerouslyIgnoreUnhandledErrors: false`, plus `onUnhandledRejection` logging). Then give the callback an unmount guard or abort it.
- **Cross-reference:** M49 part 4 (PR 585); KI-20261024-c (CI red once, cause unknown).
- **First noted:** 2026-10-25, on PR 585's CI.
- **Resolved, 2026-10-28 (separately from M55):** the late callback was the suggestion list's idle
  read, not the header or the cover band. `TripProvider` runs `useTripSuggestions`, whose mount read
  waits for idle and then calls `fetchTripSuggestions`. `TripHeader.test.tsx` did not mock that
  call, so it is a real request to localhost, and its timing depends on the machine. When it answered
  after the provider had unmounted, `refresh` still called `setInFlight`. React reads `window.event`
  to price an update (`resolveUpdatePriority`) before it finds that the hook is gone. Once the file's
  jsdom had been torn down, that read threw `ReferenceError: window is not defined`, which rejected
  the un-awaited `void refresh()` promise.
  - **Reproduced deterministically:** a scratch setup file took `window` away in an `afterAll` and
    waited 3s, the way teardown does. Running `TripHeader.test.tsx` under it passed 40/40, then
    reported the CI text, now with a stack:
    `Unhandled Rejection ReferenceError: window is not defined ❯ resolveUpdatePriority … ❯
    dispatchSetState … ❯ src/components/trip/context/useTripSuggestions.ts:75:5 setInFlight((n) => n - 1)`.
    The same run reported two uncaught `window.event` reads from React's scheduled passive-effect
    flush, which the late update had caused.
  - **Fix:** `useTripSuggestions` holds a `mounted` ref, cleared on unmount. `refresh` returns at
    once when unmounted and again after its read, before any state is set. `resolve` and
    `acceptMany` return their result right after their own request when unmounted, so they neither
    re-read nor call `onAccepted` (the provider's `onRemoteChange`). The trip's cache is still
    cleared by the write itself (`endWrite`). `TripHeader.test.tsx` now mocks
    `fetchTripSuggestions`, so the file the KI names sends no suggestions request at all.
  - **Proof and regression tests:** `useTripSuggestions.test.tsx` has *"sets nothing when a read
    still out at unmount answers after the page is gone"* and *"sets nothing when an accept still
    out at unmount is refused / accepted / accepted with the rest after the page is gone"* (the
    last is `acceptMany`). Each takes `window` away, lets the held answer go, and awaits the hook's
    own promise before giving `window` back. With its guard removed each fails with
    `expected ReferenceError: window is not defined to be 'settled'`. The scratch `afterAll`
    reproduction on `TripHeader.test.tsx` reports no errors.
  - The remaining real loopback requests in unit files, and the provider's own post-await
    setters, are KI-2026-10-28-d.
