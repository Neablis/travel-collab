### KI-2026-09-25-f — a trip opens on a phone into the desktop Overview document inside a padded card, ~8,560px tall

- **Severity:** usability, phone — the first screen of every trip on a phone.
  It reads; it is not the designed phone companion.
- **Area:** `apps/web/src/components/board/TripBoardScreen.tsx` (the Overview
  branch, which renders the same notebook page at every width), the Overview
  notebook's page rendering under `apps/web/src/components/pages/`, SPEC §10 /
  §24 / §25.
- **Symptom:** measured 2026-09-24 at 390px (screenshot
  `d-overview-mid-390.png`, from the mobile check that filed KI-2026-09-24-l):
  opening a trip lands on Overview, which is the desktop notebook document in
  a padded card, 8,560px tall.
- **Why not fixed here:** split out of KI-2026-09-24-l by its fixer
  (overnight sweep, 2026-09-25). That entry was the tab bar's state and is
  resolved: no tab is current on Overview. This half is a phone layout
  decision (what Overview is on a phone, or whether a phone lands elsewhere —
  §24 says a trip lands on Overview with no phone exception).
- **Also noticed, same mapping:** `TripBoardScreen.tsx` passes
  `tab: view === "Map" ? "map" : "plan"` to `phoneAskContext`, so the phone
  assistant believes Overview and Calendar are Plan. Unchecked whether that
  changes anything the assistant says.
- **Cross-reference:** `resolved/KI-20260924-l-the-phone-tab-bar-marks-plan-current-on-overview.md`,
  KI-2026-09-24-i (the phone header), resolved KI-046.
- **First noted:** 2026-09-24 (mobile check); filed separately 2026-09-25.
