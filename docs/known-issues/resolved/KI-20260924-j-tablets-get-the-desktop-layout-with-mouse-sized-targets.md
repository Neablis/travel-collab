### KI-2026-09-24-j — tablets (768–1100px) get the desktop layout with mouse-sized controls, and the Ask button covers stop costs

- **Severity:** usability on tablets — works, but built for a mouse.
- **Area:** the `md:min-h-0` switches that turn SPEC §13.1's 44px floor off at 768px (`apps/web/src/components/ui/*`, board and lens controls), the floating Ask button and the docked assistant rail (`apps/web/src/components/assistant/`), `apps/web/src/components/board/Board.tsx`.
- **Symptom / What happens:** measured 2026-09-24 at 820×1180 and 1024×768: on Plan 244 of 287 controls are under 32px (account menu 30×30, lens tabs ~26px tall, stop Edit/Remove ~28px, quick-ask buttons ~20px); the floating Ask button sits over the right-hand stop column's costs; with Ask docked at 820 the board gets ~440px (one and a half columns); at 1024×768 only ~220px of board shows above the fold.
- **Why not fixed here:** a breakpoint/design decision (does a touch tablet keep the 44px floor, and what does the tablet board look like) rather than a bug fix. KI-46 framed "≥1100px is fine" and never looked at this band.
- **Cross-reference:** KI-46, `m26-phone-targets.spec.ts` (the phone floor, which this band skips), screenshots `06-plan-fold-1024.png`, `10-ask-820.png` from the check.
- **First noted:** 2026-09-24, mobile check.
- **Re-verified 2026-09-25 (overnight sweep):** still true by construction. Pixels were not re-measured (no browser run on this box). The floor is still released at 768px: `button.tsx:39` `PHONE_TOUCH = "min-h-11 min-w-11 md:min-h-0 md:min-w-0"`, `buttonVariants` base `:64` `… md:min-h-0 md:min-w-0`, `input.tsx:16` `… md:min-h-0`, and only the opt-in `touch` size re-asserts `md:min-h-11` (`:98`). Since the check, no commit has touched `components/ui/button.tsx`, `input.tsx` or `board/Board.tsx`. The one assistant change (`60c4215`, `AssistantRail.tsx` ±1 line) does not move the floating Ask. KI-46 is now resolved and this entry owns the 768–1100px band.
- **Decided 2026-10-08 (M39 critique, decisions 3a–3c):** the 44px floor holds on any `pointer: coarse` device, whatever its width (3a B); at 768–1100px the board stays desktop and Ask opens as an overlay sheet rather than docked (3b B); the Ask launcher moves into the header or tab row so nothing floats over stop costs (3c B, §13.5). Built as M39 Part 3. Record: `docs/design-feedback/2026-10-08-M39-phone-tablet-critique.md`, and `docs/milestones/M39-the-phone-is-decided.md`.
- **Resolved:** 2026-10-09 (M39 Part 3, D3), on `claude/m39-part3-tablet`.
  - **The fix.** The 44px floor is released by POINTER, not width: a `fine` variant in
    `globals.css` (`@media (pointer: fine) and (min-width: 48rem)`) replaces every `md:min-h-0` /
    `md:min-w-0`, and every re-assertion layered over one (`touch`, `ProposalCard`, a plan card's
    `min-h-7`, `underline-tabs`, `day-grid`, `AnswerPill`, `UnplannedTrip`). Three controls that
    exist only at `md` and up never had a floor and got `PHONE_TOUCH`: the lens tabs (`TabStrip`),
    the header's Trips/Playbooks links, and Plan's "Take a day from the library". From 768 to 1099px
    Ask opens as the sheet over the board whatever shape the reader stored (`useIsTabletWidth`); the
    docked/floating choice applies from 1100px up. The board's floating launcher is gone: the trip
    header's `Ask` pill is the entry point at every width (the notebook page keeps its bubble).
  - **Not changed, by decision:** the board itself stays the desktop board (critique §3b, option B),
    so the 1024×768 fold observation above was not re-measured and nothing here moves it.
  - **Measured** in a new `tablet` Playwright project (820×1180, `hasTouch`, which makes Chromium
    report `pointer: coarse`), `e2e/m39-tablet.spec.ts`: no control on Plan under 44px bar MapLibre's
    attribution, against 38 before; opening Ask leaves the board at 820px wide.
  - **Red against the old code**, same spec: 38 offenders (`"Account menu" is 30px`, `"Overview" is
    26px`, `"Remove Stop on day 1" is 16px`, …); with the band switched off, `Expected: 820, Received:
    464`. `responsive.spec.ts` at 1280px with the launcher re-mounted: `getByTestId('assistant-launcher')`
    `Expected: 0, Received: 1`; `m26-phone-targets`' desktop case with the variant inverted to
    `pointer: coarse`: `Expected: < 44, Received: 44`.
  - **Check subset:** `pnpm --filter web typecheck`; eslint on the changed files; vitest unit over
    `ui`, `assistant`, `TripBoardScreen`, `TripHeader`, `PageScreen`, `PageAssistant`,
    `NotebookScreen`, `AccountMenu`, `TripViewTabs`, `admin`, `SharedDayScreen`; `check-color-wall`,
    `check-docstring-wall`, `pnpm arch`; after `NEXT_PUBLIC_SENTRY_DSN='' pnpm build && pnpm
    check:build-sentry`, `CI=true pnpm test:e2e` over `m39-tablet`, `m26-phone-targets`,
    `m16-mobile-assistant`, `responsive`, `m16-assistant`, `m10-simulated-ai`, `m7-solo-delight`,
    `m14-notebook-widgets`, `suggester`, `m20-entitlements`, `m11-demo`, `m39-phone-header`,
    `m10-unscheduled-rack`, `m14-mobile-notebook`, `m26-phone-surfaces`.
