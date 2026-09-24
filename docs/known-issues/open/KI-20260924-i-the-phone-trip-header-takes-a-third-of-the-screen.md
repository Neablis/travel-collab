### KI-2026-09-24-i — on a phone the pinned trip header takes ~305 of 844px, so Plan's first stop starts at the fold

- **Severity:** usability, phone Plan — the most-used surface. Nothing is lost; the list just starts at the bottom of the first screen.
- **Area:** `apps/web/src/components/trip/TripHeader.tsx` (sticky; title, status, date line, Add stop, History), the phone Plan board's day rail and the pinned "Unscheduled" strip (`apps/web/src/components/board/`), SPEC §13.4–13.5.
- **Symptom / What happens:** measured 2026-09-24 at 390×844 on a production build of `0c45caf`: the header (a two-line title, status, dates, Add stop + History) stays pinned at ~305px; with the tab bar (~60px) and the pinned "Unscheduled" strip (~45px) the list gets ~435px, and the first stop card starts at y≈691. The day rail scrolls away while Add stop / History stay put — the reverse of §13.4 (*"the day rail never collapses"*) — and the Unscheduled strip is a floating control over the list (§13.5).
- **Why not fixed here:** a layout/design change on the busiest surface; wants the §13.4 reading settled (what collapses, what pins) before building.
- **Cross-reference:** KI-46 (the older phone-layout entry, largely stale), the 2026-09-24 mobile check (`06-plan-fold-390.png`).
- **First noted:** 2026-09-24, mobile check.
