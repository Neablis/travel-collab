### KI-2026-09-25-f — a trip opens on a phone into the desktop Overview document inside a padded card, ~8,560px tall — RESOLVED

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
- **Decision (Mitchell, 2026-10-08 and 2026-10-09):** M39 D2. A trip still
  opens on Overview on a phone, so SPEC §24 is unchanged. Overview is built from
  the existing artboard rather than a new one: below 768px the tab renders
  §19's phone notebook page (`phoneNbDoc`) read-only, and Edit opens the page
  in the Notebook (§25). The critique's option B, recorded in
  `docs/design-feedback/2026-10-08-M39-phone-tablet-critique.md` (decision 2).
- **Fix (2026-10-09, M39 Part 5):** `0d6be82`. In `globals.css`, a phone block
  on `.tc-overview-letter` drops the sheet's border, shadow, radius and clamped
  padding, and runs its ground edge to edge. `OverviewLens` passes
  `compact={useIsPhone()}` through `PageEditor` → `MacroEditorContext` →
  `MacroView` → `BlockView`, and the schedule (`day.detail {view: "schedule"}`)
  renders `ItineraryScheduleCompact`: the artboard's `isItin`, one city-tinted
  row per day with every stop as `time title`, with its standing, on one
  wrapped line. The Ask half is `92e680a`. `phoneAskContext` has an
  `overview | calendar` surface (trip scope, the trip's questions, a trip
  hint), and on those two tabs on a phone the board drops the focused day from
  the wire.
- **Measured** on the production build at 390px, on `/demo`'s seeded 14-day
  trip: the document went from 7,481px to 3,048px, and Day by day from 5,848px
  to 1,556px. On a 20-day mapped trip it went from 3,651px to 2,641px. The
  8,560px above was measured before M30 replaced the Overview's template.
- **Proof:** `e2e/m39-phone-overview.spec.ts` (phone project), on
  `test:e2e:ci-like`. With `globals.css` and `OverviewLens.tsx` reverted, the
  390px case failed on the frame (`"border": "1px"`, `"left": 24`, the letter
  shadow). With only `OverviewLens.tsx` reverted, it failed on the density:
  `getByRole('list', { name: 'Day 1' })` expected 0 and received 6, and the
  411px case received 1. The 1280px case passed both times, as an unchanged
  desktop should. With both restored it was green, along with every Overview,
  phone and M39 spec (69 passed). For the Ask half, `phoneAskContext.test.ts`
  failed against the old source with `expected { kind: 'day', dayIndex: +0 }
  to deeply equal { kind: 'trip' }`. The new `TripBoardScreen.test.tsx` case
  found "Asking about Day 1" where it expected "Asking about Rome 2027".
- **Not addressed here:** an inline block atom's paragraph carries about 53px
  of empty line box around the block (154px around an 85px link card) on
  every page and at every width. That spacing belongs to the page editor, not
  to the phone. The phone Notebook route (`/pages/:id`) still renders the
  desktop schedule form: `compact` is the Overview's alone.
