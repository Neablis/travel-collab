### KI-2026-09-24-b — the production content importer drops a Playbook's trailing rest day

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
