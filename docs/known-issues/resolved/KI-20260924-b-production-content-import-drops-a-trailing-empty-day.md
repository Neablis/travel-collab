### KI-2026-09-24-b — the production content importer drops a Playbook's trailing rest day — RESOLVED

- **Severity:** content correctness, small. Only a bundle playbook whose LAST
  authored day has no stops is affected.
- **Area:** `apps/web/scripts/import-content-production.ts` (the
  `newSavedDayRow({...})` call in the insert loop).
- **Symptom:** the call passes no `dayCount`, so `sequenceColumns` derives it
  from the stops (`max(dayIndex) + 1`). An interior empty day survives as a gap
  in `dayIndex`; a trailing one is lost, and the production row is one day
  shorter than the bundle and than the same bundle imported through the dev
  route (`api/dev/content/playbooks/route.ts`, which passes
  `dayCount: day.dayCount`). ADR-048 decision 2 is exactly this case.
- **Why not fixed here:** outside the Playbooks API change; it is a one-line fix
  (`dayCount: day.dayCount`) plus a test in the importer's own suite, and a
  production re-import to correct any affected row.
- **Cross-reference:** ADR-048 decision 2; `packages/fixtures/src/bundle/toPlaybooks.ts`.
- **First noted:** 2026-09-24, Playbooks API pass A.
- **RESOLVED 2026-09-24, by the one-line fix this entry named.** The
  `newSavedDayRow({...})` call in `importPlaybooks` now passes
  `dayCount: day.dayCount` (the declared `days.length` that `resolvePlaybook`
  already carried), exactly as the dev route does. `importPlaybooks` is now
  exported so the importer's own suite can drive it.

  **Reproduction, before and after.** New case in
  `apps/web/src/server/importContentProduction.int.test.ts` imports a four-day
  playbook whose days 2 and 4 have no stops and reads the row back. Before the
  fix: `AssertionError: expected 3 to be 4` on `row.dayCount` (the interior gap,
  `dayIndex` `[0, 2]`, already survived; only the trailing day was lost).
  After: `Test Files 1 passed (1)`, `Tests 4 passed (4)`. Seen red for this
  reason with only the source line absent.

  **Checks run** (narrow subset; `apps/web` only, no contracts file touched):
  `pnpm --filter web typecheck` clean; `eslint` on the two touched files clean;
  `node scripts/with-test-db.mjs vitest run src/server/importContentProduction.int.test.ts`
  green; `node --test scripts/__tests__/strip-only-entry-points.test.mjs`
  `pass 5, fail 0` (the importer still loads under plain node).

  **Still owed, and it is not code:** a production re-import
  (`import-content-production.yml`) to correct any existing row whose playbook
  ends on a rest day. Not run from here.
