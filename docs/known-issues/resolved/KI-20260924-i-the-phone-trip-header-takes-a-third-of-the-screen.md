### KI-2026-09-24-i — on a phone the pinned trip header takes ~305 of 844px, so Plan's first stop starts at the fold — RESOLVED

- **Severity:** usability, phone Plan — the most-used surface. Nothing is lost; the list just starts at the bottom of the first screen.
- **Area:** `apps/web/src/components/trip/TripHeader.tsx` (sticky; title, status, date line, Add stop, History), the phone Plan board's day rail and the pinned "Unscheduled" strip (`apps/web/src/components/board/`), SPEC §13.4–13.5.
- **Symptom / What happens:** measured 2026-09-24 at 390×844 on a production build of `0c45caf`: the header (a two-line title, status, dates, Add stop + History) stays pinned at ~305px; with the tab bar (~60px) and the pinned "Unscheduled" strip (~45px) the list gets ~435px, and the first stop card starts at y≈691. The day rail scrolls away while Add stop / History stay put — the reverse of §13.4 (*"the day rail never collapses"*) — and the Unscheduled strip is a floating control over the list (§13.5).
- **Why not fixed here:** a layout/design change on the busiest surface; wants the §13.4 reading settled (what collapses, what pins) before building.
- **Cross-reference:** KI-46 (the older phone-layout entry, largely stale), the 2026-09-24 mobile check (`06-plan-fold-390.png`).
- **First noted:** 2026-09-24, mobile check.
- **Re-verified 2026-09-25 (overnight sweep):** still true by structure. Pixels were not re-measured (no browser run on this box). `TripHeader.tsx:128` is still `sticky` and still holds Add stop and History (`:359`, `:17`). The day rail still renders inside Plan's scrolling content, not the pinned header (`TripBoardScreen.tsx:952-967`, *"The day rail belongs to Plan, and scrolls with it"*). The Unscheduled rack is still `fixed` to the viewport (`TripBoardScreen.tsx:1181-1186`). Since `0c45caf`, no commit has touched `TripHeader.tsx`, and the ones touching `board/` and `globals.css` (`69fe0db`, `a029066`, `60c4215`, `658f608`, `9aa07b4`, `cdb3582`) change the editor grid, the Overview prop, trip-strip tokens, history and card times, none of which moves this layout. KI-46, cited above as the older entry, is now resolved; this entry holds its phone residue.
- **Resolved:** 2026-10-09 (M39 Part 2, D6), on `claude/m39-part2-phone-header`.
  - **The fix.** Below 768px the sticky header is one row — back arrow, a one-line title (still the
    door to Trip settings), `Ask`, and a `⋯` menu holding Add stop, History (with undo and redo) and
    Trip settings. The badges and the date line scroll away beneath it. On Plan the day rail pins
    inside the header (`TripHeader`'s `pinned`), so `--sticky-stack-height` counts it. Unscheduled is
    a row after the day (`UnscheduledRack` `placement="row"`, `Board`'s `endOfDay`), not fixed, and
    `--rack-height` is 0 on a phone. Desktop is unchanged.
  - **Measured** on a production build at 411×852 (`e2e/m39-phone-header.spec.ts`): pinned stack
    56 (AppHeader) + about 140 (row and rail); first stop card at y=305, against 478.9 on the old header
    at the same size (the 691 above was 390×844 with the fixed rack and a two-line title).
  - **Red against the old header**, same spec: `Expected: < 320, Received: 478.859375`; with that
    line removed, `getByRole('group', { name: 'Days' })` `viewport ratio 0` after a screen's scroll;
    no `Trip actions` button; the rack's position `fixed`.
  - **Check subset:** `pnpm --filter web typecheck`; eslint on the changed files; vitest unit on
    `TripHeader`, `TripBoardScreen`, `UnscheduledRack`, `board`, `overlays`, `menu`, `DayRiver`
    (7 files, 208 tests); `check-color-wall`, `check-docstring-wall`; after
    `NEXT_PUBLIC_SENTRY_DSN='' pnpm build && pnpm check:build-sentry`, `CI=true pnpm test:e2e` over
    `m39-phone-header`, `m26-phone-plan`, `responsive`, `m16-mobile-assistant`,
    `m10-unscheduled-rack`, `m26-phone-surfaces`, `m26-phone-targets`, `m14-mobile-notebook`,
    `m11-demo-phone`, `m2-history`, `travellers`, `suggester`, `m18b-tag-focus`: `80 passed`.
