### KI-2026-09-25-b — `POST /v1/library` still keeps calendar-date anchors, the one keep path that does — RESOLVED

- **Severity:** product correctness, low — the same symptom KI-2026-09-24-c
  closed for the app: a kept day's `dateRange` anchor raises an anchor
  conflict when the day is applied to a trip in another month.
- **Area:** `apps/web/src/server/public-api/library.ts` (`keepDays` →
  `saveDay`, which now takes `dateAnchors: "keep" | "strip"` and defaults to
  `"keep"`), `apps/web/src/server/savedDays.ts` (`withoutDateAnchors`),
  `docs/guidelines/using-the-api.md`, ADR-050 decision 8.
- **Symptom:** after 2026-09-25, `POST /v1/playbooks` and the app's
  `POST /api/saved-days` both strip `dateRange` anchors (the API returning a
  `date-anchor-removed` warning, the app's Keep dialog saying so before the
  keep). `POST /v1/library` keeps them as-is, silently.
- **Why not fixed here:** it is a `/v1` behaviour change (a response that
  starts carrying warnings, or data a client sent that is no longer stored),
  and the overnight sweep's fixer for KI-2026-09-24-c was told not to change
  `/v1`. Intended fix: pass `dateAnchors: "strip"` from `keepDays` and return
  the same `date-anchor-removed` warning `/v1/playbooks` does; note it in the
  API changelog.
- **Cross-reference:** `resolved/KI-20260924-c-the-apps-keep-carries-calendar-date-anchors-into-a-playbook.md`, ADR-050.
- **First noted:** 2026-09-25, overnight KI sweep (the fixer of KI-2026-09-24-c).
- **Resolved:** 2026-10-25, KI sweep 2, by the entry's fix direction (strip, as the app's keep
  does; the keep-vs-strip call follows ADR-050 decision 8 and KI-2026-09-24-c). `keepDays`
  (`server/public-api/library.ts`) now runs `captureDays` → `withoutDateAnchors` →
  `storeSavedDay` and answers `LibraryKept` — the saved day plus the `date-anchor-removed`
  `warnings` `/v1/playbooks` returns (`PlaybookWarning`/`warningsFor` moved into `library.ts` so
  both trees share them). `saveDay` now strips by default. Public API 1.26.0, `openapi.json`
  regenerated, CHANGELOG entry, `using-the-api.md` and ADR-050 decision 8 updated. Proven by
  `playbooks.int.test.ts` "POST strips a calendar-date anchor and says so, keeping the weekday
  one": red on the old code with the `dateRange` anchor still stored (*expected [ { kind:
  'dateRange', …(2) }, …(1) ] to deeply equal [ { kind: 'dayOfWeek', …(1) } ]*), red again with
  the warnings dropped (*expected [] to deeply equal [ ObjectContaining{…} ]*), green with the fix.
