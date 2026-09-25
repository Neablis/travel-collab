### KI-2026-09-25-a — Discover's `sharedDayCount` counts Playbooks, not days (the `daysShared` misnomer's sibling)

- **Severity:** cleanup. No wrong number is rendered: the only reader,
  `DiscoverScreen.tsx:736`, tests it `> 0` to decide whether the library is
  empty, and "any Playbook" and "any day" agree on that.
- **Area:** `apps/web/src/lib/playbooks.ts` (`DiscoverResponse.sharedDayCount`),
  `apps/web/src/server/playbooks.ts` (`discoverPage`, fed by
  `publishedPlaybookCount`), `apps/web/src/components/playbooks/DiscoverScreen.tsx`,
  and the `apiClient` / `NewTripWizard` / `DiscoverScreen` tests that build it.
- **Symptom:** the field is fed by `publishedPlaybookCount()`, which counts
  published `saved_days` rows — Playbooks since M23 — under a name that says
  days. The same defect class KI-2026-09-19-c fixed for `PublicAuthor`
  (`daysShared` → `playbooksShared`); it is the next reader of the count that
  will believe the name.
- **Why not fixed here:** found by KI-2026-09-19-c's fixer in the 2026-09-25
  overnight sweep; outside that entry's Area, and a separate response field with
  its own consumers and tests. Intended fix: rename to `sharedPlaybookCount`
  (app-internal wire only — not on `/v1`), or to a boolean if emptiness is all
  it is ever for.
- **Cross-reference:** `resolved/KI-20260919-c-daysshared-counts-playbooks-not-days.md`, ADR-048.
- **First noted:** 2026-09-25, overnight KI sweep.
