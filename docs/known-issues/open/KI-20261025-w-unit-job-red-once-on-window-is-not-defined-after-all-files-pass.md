### KI-2026-10-25-w — `test / unit` went red once with all files passing, on an unhandled "window is not defined" from TripHeader.test.tsx

- **Severity:** reliability. One occurrence failed `ci-ok` on a PR, and a re-run of the same commit passed.
- **Area:** `apps/web/src/components/trip/TripHeader.test.tsx`, and the cover band it renders (`apps/web/src/components/trip/cover/`).
- **Symptom / What happens:** vitest reported all 477 unit files as passing. It then failed the job on `Unhandled Rejection … ReferenceError: window is not defined`, with the origin given as `src/components/trip/TripHeader.test.tsx` and no stack captured.
- **Evidence (the occurrence):**
  - PR 585 (M49 part 4), head `02c81f3`, check run 121105442483, workflow run 40172261036.
  - A re-run of the failed job on the same head passed, and `ci-ok` went green.
  - The previous heads `2fe5de4` and `d1de48f` passed `test / unit`.
  - Locally, `vitest run -c vitest.unit.config.ts src/components/trip/TripHeader.test.tsx` passed 39/39 every time, including under CPU load with `--maxWorkers=1` and with network calls slowed by 400 and 1500 ms.
- **Why not fixed here:** the error did not reproduce, so there was nothing to fix it against. The suspected cause is an async callback (an image load, a timer or a fetch continuation) in the header or cover band settling after jsdom is torn down. That is not confirmed.
- **Fix path / Tripwire:** on the next occurrence, record the run here. If it recurs, find the late callback by making vitest fail on unhandled rejections with a stack (`dangerouslyIgnoreUnhandledErrors: false`, plus `onUnhandledRejection` logging). Then give the callback an unmount guard or abort it.
- **Cross-reference:** M49 part 4 (PR 585); KI-20261024-c (CI red once, cause unknown).
- **First noted:** 2026-10-25, on PR 585's CI.
