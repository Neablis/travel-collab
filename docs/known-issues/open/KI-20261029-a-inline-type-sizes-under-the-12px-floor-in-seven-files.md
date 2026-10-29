### KI-2026-10-29-a — fifteen inline type sizes under the 12px floor remain in seven signed-in files

- **Severity:** design-system drift. Small text on dense signed-in surfaces is harder to read; the
  wall stops it spreading, so nothing new can join it.
- **Area:** `scripts/check-type-floor.mjs` (`GRANDFATHERED_INLINE`, the list that may only shrink)
  and the seven files on it: `apps/web/src/components/AccountMenu.tsx`,
  `components/lenses/{CalendarLens,MapDayStrip,MapLens,MapRail}.tsx`,
  `components/trip/{DayChips,UnscheduledRack}.tsx`. Also `apps/web/src/app/globals.css`'s five
  `var(--text-2xs)` rules for the notebook widget tables (`.tc-widget-*`), which the wall does not
  read.
- **Symptom / What happens:** counted 2026-10-29 by the type-floor wall's inline check (PR 633):
  15 inline `fontSize` values of 10–11.5px, each a design handoff's (`dc.html`) micro label with its
  own eslint-disable, on tight surfaces: the map's rail and day strip, the calendar's cells, the day
  chips, the unscheduled rack, the account menu. `design-system.md` says 12px is the floor for
  anything a user reads.
- **Why not fixed here:** KI-2026-10-05-i (resolved by PR 633) moved every `text-2xs` class use;
  these inline sizes were found by the review's stricter wall afterwards. Raising them to 12px on
  those surfaces needs a layout walk at phone and desktop width (chips and rails may wrap or clip),
  which that PR did not do.
- **Fix path / Tripwire:** per file, move the size to `text-xs`, walk the surface at 360px and
  1440px, and remove the file from `GRANDFATHERED_INLINE` in the same change. When the set is empty,
  delete it. The `globals.css` widget rules go the same way.
- **Cross-reference:** KI-2026-10-05-i (resolved); `docs/guidelines/design-system.md` Enforcement 5.
- **First noted:** 2026-10-29, review of PR 633.
