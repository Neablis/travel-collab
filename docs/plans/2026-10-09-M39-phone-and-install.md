# M39: the phone layout and the installable app, build plan

Gate: `docs/milestones/M39-the-phone-is-decided.md`, § *Exit gate*. The decisions are numbered
there and cited here as D1–D10. The reasoning is in
`docs/design-feedback/2026-10-08-M39-phone-tablet-critique.md`. Delete this file when M39's gate
closes (`docs/plans/README.md`).

## The stack

Each part has its own branch and is merged in order with a merge commit
(`docs/guidelines/stacked-prs.md`). Every part opens as a draft. **Nothing merges without
Mitchell.** Parts 2–4 are one linear stack. Part 3 touches `TripHeader.tsx` again, and Part 4 puts
its inset on Part 2's header.

| Part | Branch | Theme | Tier | State |
|---|---|---|---|---|
| 0 | `claude/practical-pasteur-my3urz` | this plan; the KI entries link the critique (gate box 1) | 1 (prose) | this PR |
| 1 | `claude/m39-part1-chips-and-dates` | day-chip fade and snap; inline date editor (D7, D8) | 2 | #363, merged |
| 2 | `claude/m39-part2-phone-header` | phone header: one pinned row plus the day rail; Unscheduled as an end-of-day row (D6) | 2 | #364, merged |
| 3 | `claude/m39-part3-tablet` | touch floor on `pointer: coarse`; tablet Ask; a touch tablet e2e project (D3) | 2 | #365, merged |
| 4 | `claude/m39-part4-installable` | manifest, icons, `viewport` with `cover` and both insets, a static-asset service worker (D4, D10) | 2, then 3 on the top | #366, merged |
| 5 | `claude/m39-part5-phone-overview` | phone-sized Overview; the `phoneAskContext` fix (D2) | 2 | #367, merged; built from the existing §19 artboard |
| 6 | `claude/m39-part6-phone-conflicts` | phone conflict chip, sheet and stop marker (D9) | 2 | #368, built from the existing components |
| 7 | `claude/m39-part7-insets` | the layers `KI-2026-10-09-a` left without safe-area insets; review carry-overs | 2 | #369 |

**What a person clicks on the preview to see each part:**
- Part 2: open a trip's Plan at 390px and scroll. The title row and the day chips stay pinned.
  Unscheduled is the last row of the day.
- Part 3: open Plan on a touch tablet, or in DevTools with touch emulation at 820px. Controls are
  44px and Ask covers no costs.
- Part 4: Chrome → *Install Caesura*, or Safari → *Add to Home Screen*.

## What is true today

Surveyed 2026-10-09 against `main` at `ed3d40e`. Re-check the line numbers before trusting them.
The app is under `apps/web/src/`.

**The phone header (Part 2)**
- `TripHeader.tsx:161` is `<header aria-label="Trip">`, and `:176-179` makes it
  `sticky … top-14` (`top-0` on `/demo`), below `AppHeader` (`sticky top-0 h-14`).
  `useStickyStackHeight` (`:662-676`) publishes `--sticky-stack-height`.
- Its rows, top to bottom:
  - the nav row with *← Your trips* and `AskPill` (`:201-242`);
  - the title row (`:262-335`): the title button opens settings, then `TravellerStack` (from `sm`)
    and the status badges;
  - the phone date line (`:355-357`, `md:hidden`);
  - the right cluster: Add stop (`:426-430`), `SuggestionsChip`, and the History popover
    (`:457-460`);
  - the desktop meta row (`:525`);
  - the view tabs and Notebooks, passed in as children (`:550`).
- Phone and desktop are told apart two ways: CSS (`md:hidden`) for chrome, and `useIsPhone()`
  (`lib/useIsPhone.ts`, `max-width: 767px`, starts `false`) for layout swaps.
- `DayChips` is mounted in Plan's `PageContainer`, outside the header, at
  `TripBoardScreen.tsx:1064-1075`. The comment at `:1051-1063` says it moved out so the header is
  the same height on every tab. **D6 pins it again, but on the phone only.** The desktop keeps
  that reasoning.
- The rack is mounted at `TripBoardScreen.tsx:1340-1361`.
  - It is `position: fixed` at the bottom (`globals.css:1089-1111`, `.unscheduled-rack`) at
    every width, above the tab bar on a phone.
  - Its height is published as `--rack-height` (`:933`).
- The phone Plan is `Board oneDay` (`Board.tsx:749-771`). It has no per-day "add" row (removed
  in #269). The only end-of-day element is `OneMoreDayColumn` (`:848-850`).
- **Specs that pin today's layout, and that Part 2 changes on purpose:**
  - `responsive.spec.ts:625-` (phone): Add stop and History are visible in the Trip header.
  - `m16-mobile-assistant.spec.ts:56,131-149`: the Ask pill is in `header[aria-label="Trip"]`,
    is not fixed, and is at least 44px.
  - `m26-phone-plan.spec.ts:277-287`: drops onto the rack's bounding box; `pointAt` (`:208`)
    assumes the point is clear of the header, the rack and the tab bar.
  - `m10-unscheduled-rack.spec.ts:22,72`, desktop: unchanged by Part 2.

**Touch floor and tablet Ask (Part 3)**
- The floor is released by width:
  - `button.tsx:39` `PHONE_TOUCH`, and the `buttonVariants` base at `:64`
    (`min-h-11 min-w-11 md:min-h-0 md:min-w-0`);
  - 13 files and 21 sites carry `md:min-h-0` / `md:min-w-0`.
  - `globals.css` has no `@custom-variant` yet.
- At ≥768px:
  - Ask is the floating `AssistantBubble` (`AssistantBubble.tsx:71`, `fixed right-4`), mounted
    at `TripBoardScreen.tsx:1215`.
  - The rail's shape comes from `useAssistantShape` (`docked | floating`). It is the reader's
    choice, and the board defaults to docked (356px).
  - The 1180px overlay split was removed (`TripBoardScreen.tsx:62-70`).
- The Playwright projects (`playwright.config.ts:135-171`) are `desktop`, `narrow` and `phone`.
  - None sets `hasTouch`.
  - `m26-phone-targets.spec.ts` runs in `desktop` at 411×852 and counts heights under 44px.

**Installable (Part 4)**
- `app/layout.tsx:34-49` exports `metadata` only. It has no `viewport` export, no `themeColor`
  and no `manifest`.
- The only icons are `app/icon.svg` and `app/opengraph-image.png`, both from
  `scripts/generate-og-assets.mjs`, which has no package script. There are no PNG app icons.
- The safe-area insets:
  - `globals.css:772` and `:811`, bottom only, on the tab bar;
  - nothing uses `safe-area-inset-top`;
  - none of them take effect until `viewport-fit=cover`.
- The CSP (`next.config.ts:44`, `:104`):
  - `default-src 'self'` covers `manifest-src`;
  - `worker-src 'self' blob:` allows a same-origin `/sw.js`.
- The proxy matcher (`proxy.ts:151-153`) does not touch `/sw.js` or `/manifest.webmanifest`.
- Precedent for a build-time public file: `scripts/copy-maplibre-worker.mjs`.

## Part 2: the phone header (D6, closes `KI-2026-09-24-i`)

1. **A phone branch in `TripHeader`.** Below `md`, the sticky region is one ~56px row:
   - the back link, a one-line truncated title (which still opens settings), and `AskPill`;
   - an overflow menu (`ui/menu.tsx`) holding Add stop, History (undo/redo) and Trip settings.
   - The status badges, `TravellerStack` and the date line move into the scrolling content
     beneath it. The view tabs stay where they are.
   - The desktop header does not change.
2. **The day rail pins on the phone's Plan.** `DayChips` renders inside the pinned region on a
   phone, Plan only. Every other case keeps it where it is.
   - `--sticky-stack-height` must grow by the rail's height, so the board's sticky offsets still
     clear it.
3. **Unscheduled becomes the end-of-day row on a phone.** The rack's phone placement is a row
   after the focused day's last stop, collapsed to a count, opening to its items in place. It is
   not fixed, and it covers nothing.
   - It stays a drop target for long-press drag (`m26-phone-plan`).
   - The desktop rack does not change.
   - `--rack-height` is 0 on a phone, so the bubble's offset stays correct.
4. **Tests** (each seen red against today's header):
   - an e2e in the `phone` project: at 411×852, after scrolling Plan by one screen, the title row
     and the `Days` group are both still in the viewport, and the first stop card starts above
     y≈300 (today: y≈691);
   - `responsive.spec.ts` and `m16` move to the overflow menu on purpose. Say so in the PR body,
     line by line.
   - `m26-phone-plan`'s rack drop retargets the end-of-day row.

## Part 3: tablets (D3, closes `KI-2026-09-24-j`)

1. **`@custom-variant fine (@media (pointer: fine) and (min-width: 48rem))`** in `globals.css`.
   - Every `md:min-h-0` / `md:min-w-0` site becomes `fine:min-h-0` / `fine:min-w-0`, so the
     floor is released only for a fine pointer at `md` and up. All 21 sites, in one commit.
   - `phoneTouch.test.tsx` follows.
2. **Ask at 768–1100px** opens as an overlay sheet, so the board keeps its width. This **overrides
   the reader's docked choice in that band** (see *Open questions*).
3. **The launcher moves off the stop costs**, into the header's right cluster (3c, §13.5), so
   nothing floats over data.
4. **A `tablet` Playwright project**: 820×1180, `hasTouch: true`, `isMobile: false`, and
   `pointer: coarse` emulated.
   - A targets spec counts controls under 44px on Plan, the same way `m26-phone-targets` does.
   - It is seen red against today's `button.tsx`.
   - A desktop assertion keeps `New trip` under 44px at 1280px with a fine pointer.

## Part 4: installable (D4, D10)

1. **`app/manifest.ts`** carries `name`, `short_name`, `start_url: "/"`, `display: "standalone"`,
   `theme_color` and `background_color` from the tokens, and 192, 512 and maskable 512 PNG icons.
   An `apple-icon.png` is added too.
   - The icons come from `generate-og-assets.mjs`, which gains the sizes.
   - They are committed, the way `opengraph-image.png` is.
2. **`export const viewport`** in `app/layout.tsx`: `viewportFit: "cover"` and `themeColor`.
   - `env(safe-area-inset-top)` goes on `AppHeader` and on Part 2's pinned row.
   - `env(safe-area-inset-left)` and `-right` go on the page gutters in landscape.
3. **`public/sw.js`**, hand-written, network-first for navigations and cache-first for
   `/_next/static/**` and the icons.
   - Its route matcher lives in a small module that the worker and a unit test both import.
   - It never caches `/api/**`, `/s/**`, `/invite/**` or `/monitoring`.
   - It is registered from a client component in the root layout, in production builds only.
4. **Tests:**
   - the matcher's unit test, seen red with `/api/` allowed (gate box);
   - an e2e that asks Chromium for its installability errors through CDP
     (`Page.getInstallabilityErrors`) and expects none (gate box). It runs on the top part, at
     Tier 3.

## Gate boxes, and where each one is ticked

| Box | Ticked by |
|---|---|
| Critique held, decisions recorded, KIs link it | Part 0 (this PR): the three open KIs gained a *Decided* line; KI-048's resolution cites the decisions |
| `-24-i`, `-25-f`, `-24-j`, KI-048 3 and 5 resolved | Part 1 (KI-048), Part 2 (`-24-i`), Part 3 (`-24-j`), Part 5 (`-25-f`) |
| The phone shows a conflict state | Part 6 |
| Chrome's installability check | Part 4 |
| The SW never caches API or token routes | Part 4 |
| E2E on `ci-like`, including `phone` | the top part, at Tier 3 |
| [walk] real iPhone and Android | Mitchell, after Part 4 is on a preview |
| Retro | gate close |

## Open questions for Mitchell (before the part they block)

1. **Part 2, the History popover in an overflow menu.** *Answered 2026-10-09 (Mitchell): behind
   the menu*, as recommended. The pinned row is the title, Ask and the menu; undo and redo stay in
   History, and the post-change toast still offers undo.
2. **Part 3, the overlay band versus the reader's choice.** *Answered 2026-10-09 (Mitchell): the
   band wins.* At 768–1100px Ask always opens as an overlay sheet; the reader's docked or floating
   choice applies from 1100px up.
3. **Part 3, the launcher on desktop.** *Answered 2026-10-09 (Mitchell): every width ≥768px.*
   The floating bubble goes; Ask lives in the header or tab row at every desktop width.
4. **Parts 5 and 6** need a design-sync artboard (`.design-sync/**` is a build input). Who opens
   that session, and when? *Part 5 answered 2026-10-09 (Mitchell): build from the artboard already
   committed.* The handoff draws no phone Overview tab, but SPEC §19's phone page (`phoneNbDoc`)
   draws the Overview's widgets at phone density. The phone Overview tab renders that page
   read-only; Edit opens it in the Notebook, which keeps §25. Choices the artboard does not cover
   are listed in Part 5's PR for Mitchell. *Part 6, 2026-10-09:* Mitchell asked for the rest of
   the milestone to be worked through. The handoff draws no phone conflict state, so Part 6 builds
   D9's shape (a count chip in the pinned row, a bottom sheet, the card's marker) from the
   components that already exist: `ConflictBanner`'s rows, `SuggestionsChip`'s pattern, `Sheet`
   and `RiverBlock`'s triangle. That follows SPEC's "mobile is a variant layer". Its visual choices
   are listed in Part 6's PR for Mitchell.
