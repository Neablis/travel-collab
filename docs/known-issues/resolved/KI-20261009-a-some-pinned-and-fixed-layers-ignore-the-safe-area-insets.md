### KI-2026-10-09-a — some pinned and fixed layers ignore the safe-area insets that `viewport-fit=cover` now exposes — RESOLVED

- **Severity:** cosmetic, installed app only, and latent today. The top inset is
  non-zero mainly in an iOS standalone app with the `black-translucent`
  status-bar style. M39 Part 4 sets no `appleWebApp` metadata, so iOS keeps its
  default status bar. Landscape left/right insets are real on a notched phone.
- **Area:**
  - `apps/web/src/components/pages/PageScreen.tsx`: `md:sticky md:top-14`
    (~:1215) and `sticky top-29` (~:1499) still assume a 56px AppHeader.
  - `apps/web/src/components/front/PhoneFrontDoor.tsx` (~:365): `sticky top-0
    pt-6`, the top of `/` for a signed-out phone. Its stage's `pt-16` is sized
    to it, so the two change together.
  - The fixed layers: the Unscheduled rack, Ask's floating card, toasts, sheets
    and the phone's full-screen Ask (`.assistant-rail` `inset: 0`). Only the
    phone tab bar takes an inset (the bottom one).
  - Stale comments in `globals.css` (~:627, the widget rail) and PageScreen
    still describe AppHeader as `sticky top-0 h-14`.
- **Symptom:** with a non-zero top inset, AppHeader grows by the inset (M39 Part
  4, `--app-header-height`). The notebook editor's pinned bars, which hard-code
  `top-14`, tuck under it by the inset. The phone front door's header and the
  fixed layers draw under the status bar or notch.
- **Why not fixed here:** found by M39 Part 4's implementer and
  outside that part's scope, which was the manifest, the worker and the
  headers' insets. Each site needs its own look on a device, and the gate's
  real-device walk is where that happens.
- **Fix direction:** replace `top-14` / `top-29` with named rules in
  `globals.css` that offset by `--app-header-height` (the colour wall bans
  arbitrary values in a className, as `.below-app-header` already shows). Give
  the phone front door and the fixed layers
  `env(safe-area-inset-*)` padding the way `.phone-tab-bar` has the bottom one.
- **First noted:** 2026-10-09, M39 Part 4.
- **Resolved:** 2026-10-09, M39 Part 7. Each layer takes the insets of the edges it touches,
  through named rules in `globals.css` (the colour wall's precedent, `.below-app-header`). With
  every inset 0, each value is the one it replaced.
  - PageScreen: the editing toolbar is `below-app-header` (was `md:top-14`); the widget column is
    `.below-notebook-toolbar`, `--app-header-height + 3.75rem` (was `top-29`). `.tc-widget-rail`'s
    bound subtracts `--safe-area-top`.
  - PhoneFrontDoor: `.phone-front-door-header` (was `pt-6`) and `.phone-front-door-stage` (was
    `pt-16`), each plus the top inset, so the headline still clears the header.
  - `.unscheduled-rack`: left and right inset padding, and the bottom inset from 768px (below it
    the tab bar owns the bottom edge). `--rack-height` is measured from this box.
  - `.toast-dock`: `1rem + max(bottom inset, rack + tab bar)`. Both of those clear the inset in
    their own measured heights.
  - `ui/sheet.tsx`: `p-5` became `.sheet-rail` (top, right, bottom), `.sheet-full` (all four) and
    `.sheet-bottom` (sides and bottom; its top is `top-24`). This covers Part 6's conflicts sheet,
    the Discover filters, the notebook's insert sheet and New trip. The inset is added to the 20px,
    not `max()`ed with it.
  - Ask: `.assistant-bubble` (was `right-4 bottom-4`) and `.assistant-float` sit 16px from the
    safe area's corner, and the card's clamp gives up both vertical insets. `.assistant-sheet` pads
    its sides and bottom, and `.assistant-rail`'s full-screen phone form pads all four.
  - The stale "`sticky top-0 h-14`" comments in `globals.css` and PageScreen are rewritten.
- **Proof:** `e2e/m39-installable.spec.ts`, "M39 Part 7". Each walk runs with no insets and with
  insets (top 47, sides 44 and bottom 34 from 768px; top 47 and bottom 34 on a 411px phone). The
  assertions are "the old number plus the inset", so the run with no insets checks that nothing
  moved.
  - Red first, on a build of the tree before the fix
    (`CI=true pnpm test:e2e e2e/m39-installable.spec.ts --project=desktop --retries=0 -g "Part 7"`).
    Every no-insets case passed. Every insets case failed on the site it names: `toolbar top
    Expected: 103 Received: 56`, `widget rail top 163/116`, `widget list 733/780`, `bubble right
    1220/1264`, `bubble bottom 850/884`, `card right 1220/1264`, `card bottom 850/884`, `rack row
    left 44/0`, `rack row right 1236/1280`, `rack row bottom 866/900`, `rail sheet top 67/20`,
    `right 64/20`, `bottom 54/20`, `toast bottom 850/884`, front door `header 71/24`, `headline
    111/64`, Ask `sheet inset 34/0` and the full-screen probe, `bottom sheet bottom 54/20`, `full
    sheet top 67/20`, `full sheet bottom 54/20`.
  - After the fix, on a fresh build: `16 passed`, with `--retries=0`.
  - `.assistant-rail`'s full-screen phone form is read from a probe element. After hydration every
    phone surface asks for the sheet, so no real panel reaches that form.
- **Follow-up, the same day (self-review of PR #369):**
  - The insets are named once, `--safe-area-{top,right,bottom,left}` on `:root`, and every rule
    reads those rather than calling `env()` itself. The three sheet sizes share one rule.
  - A dragged floating card is clamped to the safe area as well, not the viewport:
    `assistantPosition.ts` takes the insets, which `AssistantRail.tsx` reads off a probe element's
    computed padding (`.safe-area-probe`). A computed padding is px in every engine; Chromium also
    resolves `env()` inside a computed custom property, but Safari could not be checked here.
  - The docked Ask rail (768px and up) pads its bottom, so its composer clears an iPad's home
    indicator. Not its right: it is in flow, and `body`'s padding already moves it in.
  - The phone front door's footer, the end of its own scroller, pads its bottom
    (`.phone-front-door-footer`).
  - `--rack-height` observes the rack's border box, so an inset that changes under an open page (a
    rotation) reaches the board's gap above the rack.
  - The Part 7 e2e cases find elements by role or test id (`notebook-toolbar`, `widget-rail`,
    `front-door-stage`) rather than by CSS or XPath.
  - Red first, on one build with each of those fixes undone (and the toolbar's `below-app-header`
    dropped): `toolbar top 103/NaN`, `widget rail top 163/116`, `widget list 733/780`, `dragged
    card right 1220/1264`, `dragged card bottom 850/884`, `composer bottom <= 866/888`, `rail inset
    34/0`, `--rack-height` after the inset changed `73.1875/39.1875`, front door `header 71/24`,
    `headline 111/64`, `footer inset 54/20`. The clamp's unit tests went red with the right and left
    insets dropped (`x 46/16`, `x 1016/1060`).
- **Left for the device walk:** where a sheet's content sits relative to the home indicator (20px
  above the safe area, not at it). Centred dialogs (`ui/dialog.tsx`) take no inset. The notebook
  toolbar's 60px (`.below-notebook-toolbar`, `.tc-widget-rail`) is still a hard-coded height, as
  `top-29` was before it.
