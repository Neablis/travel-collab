### KI-2026-09-24-c — keeping days in the app carries calendar-date anchors into the Playbook

- **Severity:** product correctness, low. The anchor is kept, not lost; it is
  just meaningless (and conflict-raising) in any other trip.
- **Area:** `apps/web/src/server/savedDays.ts` (`captureDays` / `storeSavedDay`
  as the app's keep calls them), `withoutDateAnchors`.
- **Symptom:** a Playbook kept through the app keeps a stop's `dateRange`
  anchor, so applying it to a trip in another month raises an anchor conflict on
  that stop. The same capture over `POST /v1/playbooks` strips the anchor and
  returns a `date-anchor-removed` warning (ADR-050 decision 8), so the two paths
  disagree.
- **Why not fixed here:** stripping in the app changes a shipped UI behaviour
  and wants the Keep dialog to say so (the API says so in its warnings; the app
  has nowhere to show one yet). A design decision, not a one-liner.
- **Cross-reference:** ADR-050 decision 8.
- **First noted:** 2026-09-24, Playbooks API pass A.
