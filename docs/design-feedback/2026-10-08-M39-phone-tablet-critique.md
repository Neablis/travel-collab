# M39 critique pack: phone and tablet, decided once (2026-10-08)

**Purpose.** M39 (`docs/milestones/M39-the-phone-is-decided.md`) builds nothing
until the design critique has made its decisions (Decision 1), and Mitchell
makes those decisions. This pack prepares that session. For each critique
bullet it gives what the screen does today, the real options, one
recommendation, and what building it would touch. Fill in the last column. Each
answer is then recorded in its KI entry, or as a SPEC amendment through a
design sync, because `.design-sync/**` is a build input. Sources: the
*Design critique: phone and tablet layout* candidate (`docs/candidates.md`,
2026-09-25), the PWA candidate (2026-10-02), the phone-conflict candidate
(2026-09-01), and the KIs they name.

**No screenshots in this pack.** See *Evidence* at the end. Every number below
is quoted from its KI with that KI's date. The code citations were re-checked
against `main` at `9fa22ff` on 2026-10-08.

## Decisions

| # | Decision | Options | Recommended | Mitchell's answer |
|---|---|---|---|---|
| 1 | Phone trip header: what pins, what collapses (`KI-2026-09-24-i`) | A. Keep it as is · B. Compact pinned bar (title + day rail), the rest scrolls away · C. Nothing pins except the day rail · D. Collapse on scroll and come back on scroll-up | **B**: pin one ~56px row (short title, overflow menu holding Add stop / History) with the day rail under it. Fold Unscheduled into the end of the day | |
| 2 | What a trip opens to on a phone (`KI-2026-09-25-f`) | A. Overview, as §24 says (keep the notebook) · B. Overview, with a phone-sized rendering of it · C. **Plan** on a phone, Overview one tab away | **C**, per M39 Decision 2. **This is a SPEC §24 change** (§24 says *"Entering a trip lands on Overview"* and makes no phone exception) | |
| 3a | Tablets and the 44px floor (`KI-2026-09-24-j`) | A. Floor below 768px only (today) · B. Floor at any width when `pointer: coarse` · C. Floor up to 1100px whatever the pointer | **B**, per M39 Decision 3 | |
| 3b | What the tablet board looks like at 768–1100px | A. Desktop board, as today · B. Desktop board with a two-column minimum, and Ask opens as an overlay sheet rather than docked · C. The phone layout stretched wide | **B** | |
| 3c | The floating Ask button covers stop costs | A. Leave it · B. Move it into the header or tab row · C. Reserve a gutter so no column sits under it | **B**. §13.5 says *"Nothing floats over data"* | |
| 4 | The day-chip row gives no sign that it scrolls (`KI-048` item 3) | A. Edge fade that tracks `atStart`/`atEnd` · B. Arrow buttons · C. Snap to whole chips · D. A fade, plus a chip-name button (the Calendar's `Fri–Sat ›` pattern) | **A + C**: a fade on whichever side has more, and snapping so no chip is cut mid-card | |
| 5 | Trip-settings date editor (`KI-048` item 5) | A. Keep the Popover · B. Inline disclosure, as the design's row does | **B**, already settled as inline. Confirm only; it needs an e2e (`m3-place-and-time.spec.ts` depends on the popover's dismiss) | |
| 6 | Phone conflict state (DRIFT §8, SPEC §13 *Still open*) | A. Reuse `ConflictBanner` above the day on Plan · B. A count chip in the pinned bar that opens a sheet · C. Only a per-card marker | **B + a per-card marker**: the chip shows the conflict wherever you are, and the card shows which stop | |
| 7 | Service worker scope (M39 Decision 4) | A. Static assets only, never `/api/**`, `/s/**`, `/invite/**`, `/monitoring` · B. Also cache trip reads | **A**. B reverses ADR-012 and ADR-046 | |
| 8 | Push notifications (M39 Decision 5) | A. Out of M39 · B. In | **A**. Nothing generates one until M46's chat | |
| 9 | "Feels like an app": `viewport-fit=cover` and the top inset | A. Ship `viewport-fit=cover` together with a top-inset fix · B. Ship the manifest without `cover` and add it later | **A**. One `viewport` export, with `env(safe-area-inset-top)` on the pinned header | |

---

## 1. The phone trip header (`KI-2026-09-24-i`)

**Today.** At 390×844 (production build of `0c45caf`, 2026-09-24) the pinned
header is about 305px tall: a two-line title, status, dates, and Add stop and
History. With the tab bar (about 60px) and the pinned Unscheduled strip (about
45px), the list gets about 435px and the first stop card starts at y≈691. The
day rail scrolls away while Add stop and History stay put. That is the reverse
of SPEC §13.4: *"The day rail never collapses."*
- The header is still `sticky`: `TripHeader.tsx:177`. The file has not changed
  since the KI was filed.
- The day rail mounts inside Plan's scrolling content:
  `TripBoardScreen.tsx:1052` (*"The day rail belongs to Plan, and scrolls with
  it"*) and `:1065-1075` (`DayChips`).
- The Unscheduled rack is `position: fixed` (`UnscheduledRack.tsx:68`), which
  makes it a floating control over the list, against §13.5.
- **Not re-measured today.** The 305px figure is two weeks old. Nothing that
  sets the header's height has changed since, so it is probably still right.

**Options.**
- **A. Keep it.** Costs nothing, and the problem stays: on the most-used
  surface, half the screen is chrome.
- **B. A compact pinned bar plus the day rail.** One row (back, a one-line
  title, and an overflow menu holding Add stop / History / Settings) with
  `DayChips` under it, pinned together. Status and dates scroll away. The
  pinned part is about 56 + 60px, against about 305px today. This matches §13.4
  (the rail pins) and §13.6 (*"mobile has no top bar to hang actions on"*, so
  actions belong in menus and sheets). Cost: Add stop moves behind a tap, but
  §13.5 already puts adding *"at the end of the day"*.
- **C. Only the day rail pins.** The smallest amount of chrome. You lose the
  trip name while scrolling, so the screen looks like any other trip.
- **D. Collapse on scroll down, return on scroll up.** A familiar pattern, but
  it moves under the thumb and it is new state that the desktop does not have.
  §13 *Mobile is a variant layer* argues against that.

For Unscheduled: either fold it into the end of the day, as a row after the
last stop, or put it in the overflow menu. Either way it stops floating. That
matches §13.5.

**Recommendation: B, and Unscheduled becomes an end-of-day row.**

**Building it touches:** `TripHeader.tsx` (a phone branch for the compact row),
`TripBoardScreen.tsx` (moving `DayChips` into the pinned region on the phone),
`UnscheduledRack.tsx` (the phone placement), and the `m26-phone-*` e2e specs.
Medium: about 2–3 days with tests. It conflicts with any work in progress on
`TripHeader.tsx`.

## 2. What a trip opens to on a phone (`KI-2026-09-25-f`)

**Today.** A bare trip URL resolves to Overview
(`LensRouter.tsx:64-74`, where `resolveView` falls through to
`return "Overview"`). On a phone that is the desktop notebook document inside a
padded card, about 8,560px tall (measured 2026-09-24,
`d-overview-mid-390.png`). The tab bar lights Overview correctly now
(`PhoneTabBar.tsx:184`, after the resolved KI-2026-09-24-l).
- **A related bug, still present.** `TripBoardScreen.tsx:856` passes
  `tab: view === "Map" ? "map" : "plan"` to `phoneAskContext`, so the phone
  assistant still treats Overview and Calendar as Plan.

**Options.**
- **A. Keep Overview as the phone landing.** This follows §24 (*"You read a
  trip before you change it"*). The first screen of every trip stays an 8,560px
  desktop document.
- **B. Keep Overview, and give it a phone rendering.** It is still §24, but
  §25 says Overview *is* a notebook page rendered by `docBlocks()` with *"no
  bespoke Overview layout"*. A phone rendering means phone variants of the
  registry widgets. That is a large design job, and it is the same work that
  DRIFT §8 parks for phone notebooks (*"per-widget rebinding on 390px needs
  its own pass"*).
- **C. Land on Plan on a phone; Overview stays one tab away.** M39 Decision 2
  recommends this. §10 already scopes a phone to *"retrieval and small edits"*,
  and Plan is the day you are in. Cost: **a SPEC §24 amendment through a design
  sync** (a phone exception to *"Entering a trip lands on Overview"*), and
  `resolveView` gains a surface input.

**Recommendation: C.** Separately, the `phoneAskContext` mapping should be
corrected whatever is chosen. It is a one-line fix with a test.

**Building it touches:** `LensRouter.tsx` (`resolveView` picks its default by
surface, and the default must not flash Overview on SSR), `PhoneTabBar.tsx`
(nothing, if the URL carries `?view=Plan`), `TripBoardScreen.tsx:856`, a SPEC
§24 amendment, and an e2e in the `phone` project. Small: about 1 day, plus the
design-sync round.

## 3. Tablets: the 44px floor, the board, and Ask (`KI-2026-09-24-j`)

**Today.** At 820×1180 and 1024×768 (measured 2026-09-24): on Plan, 244 of 287
controls are under 32px (account menu 30×30, lens tabs about 26px, stop
Edit/Remove about 28px, quick-ask buttons about 20px). The floating Ask button
covers the right-hand column's costs. Docked Ask at 820px leaves the board
about 440px, one and a half columns. At 1024×768 only about 220px of the board
shows above the fold.
- The floor is released at 768px by width, not by input type:
  `button.tsx:39` `PHONE_TOUCH = "min-h-11 min-w-11 md:min-h-0 md:min-w-0"`
  and the `buttonVariants` base at `:64`. `button.tsx` has not changed since
  the KI.
- The Ask launcher at ≥768px is `position: fixed` bottom-right
  (`TripBoardScreen.tsx:1187-1189`).
- DRIFT §8: *"No tablet design at all."*

**Options for the floor (3a).**
- **A. Width-gated (today).** iPads get mouse-sized targets.
- **B. `pointer: coarse`, at any width.** M39 Decision 3 recommends this. A
  touchscreen laptop gets 44px targets and a desktop mouse keeps today's
  density. In Tailwind v4 this is one custom variant replacing `md:min-h-0`
  with "fine pointer and ≥md". Risk: denser desktop layouts that assume 28px
  controls could reflow on touch laptops. The phone e2e project has no touch
  (PWA candidate), so a `pointer: coarse` tablet project is needed to see it.
- **C. Width-gated up to 1100px.** Simple, but a small desktop window gets
  touch-sized controls, and an iPad Pro in landscape (1366px) still does not.

**Options for the board (3b).** A. Keep the desktop board. B. The desktop
board, with Ask opening as an overlay sheet at 768–1100px so the board keeps
its full width (two columns at 820, three at 1024). C. The phone's one-day
layout, stretched. C wastes the width and is a third layout; B changes only
where Ask docks.

**Options for Ask covering costs (3c).** A. Leave it. B. Move the launcher
into the trip header or tab row, so it is not floating at all. C. Reserve a
right gutter as wide as the button. B is the only option that meets §13.5;
C spends about 60px of board on a button.

**Recommendation: 3a B, 3b B, 3c B.**

**Building it touches:** `components/ui/button.tsx`, `input.tsx` and any other
`md:min-h-0` sites (a variant in `globals.css`), the assistant launcher and
rail (`components/assistant/`, `TripBoardScreen.tsx:1185-1230`),
`e2e/m26-phone-targets.spec.ts` plus a new tablet project with `hasTouch`.
Medium: about 3 days. The floor change touches every screen, so it needs a
visual pass on desktop as well.

## 4. Signalling that the day-chip row scrolls (`KI-048` item 3)

**Today.** `DayChips.tsx:225` is a bare `overflow-x-auto` row of fixed 92px
chips, with no fade, arrow or snap. At 1440px the last chip is cut mid-card and
looks like a rendering error (KI-048, 2026-08-26, *still holds* 2026-09-25).
On a phone this matters more if decision 1 pins the rail.

**Options.** A. An edge fade that tracks `atStart`/`atEnd`. B. Arrow buttons.
C. `scroll-snap` to whole chips. D. The Calendar's pattern
(`resolved/KI-20260924-k`): a fade plus a button naming the hidden range.
A and C need scroll state, not just a CSS class. B costs two 44px targets on a
phone. D is precise, but on a 14-day trip "Days 8–14 ›" is noise.
`MapRail`'s gearing is the precedent KI-048 cites.

**Recommendation: A + C.** Snapping alone removes the cut-mid-card look, and
the fade says "more this way". It is the same treatment at every width.

**Building it touches:** `DayChips.tsx` (overflow state plus classes), a unit
test on the fade state. Small: about half a day.

## 5. Trip-settings date editor (`KI-048` item 5)

**Today.** The Dates row opens `TripDateControl` in a `Popover`
(`SettingsSheet.tsx:185`, `:288-289`) that opens downward over "Total for the
trip". The design's row expands inline.

**Already settled as inline** (the candidate entry: *"inline is already the
settled answer; it needs building and an e2e"*). **Confirm.** Constraint from
KI-048: `e2e/m3-place-and-time.spec.ts:40-54` relies on the popover's
outside-click dismiss. An inline version must reset `datesOpen` when the sheet
closes, and only a ci-like run of that spec proves it.

**Building it touches:** `SettingsSheet.tsx`, `m3-place-and-time.spec.ts`.
Small: about half a day.

## 6. The phone conflict state (DRIFT §8)

**Today.** The desktop shows conflicts through `ConflictBanner`, rendered by
`Board.tsx:694` above the columns. The phone's Plan uses the same `Board` with
one day (`Board.tsx:191-205`, *"Not a phone-only view"*). It was not checked
today whether the banner actually renders, and how, on a phone. The design
has no phone conflict state (SPEC §13 *Still open*: *"the mobile equivalent is
undecided"*; DRIFT §8: *"rule 6 requires all three"*). So the open question is
**what the design says, not whether code runs.**

**Options.**
- **A. `ConflictBanner` above the focused day.** Reuses the component. But a
  conflict on another day is invisible from this day, and the banner takes
  more of the fold (see decision 1).
- **B. A count chip in the pinned bar that opens a sheet** listing each
  conflict with its suggested resolutions (Invariant 3: conflicts are data,
  never modals). It is visible from every tab, it costs one chip, and it
  follows §13.6 (*"Sheets, not pages"*).
- **C. A per-card marker only.** Quiet, but a cross-day conflict (a
  date-anchored event broken by a reschedule) has no card on the day you are
  looking at.

**Recommendation: B, plus a per-card marker** (the card's spine or a small
glyph) so the affected stop is findable. This needs a design-sync artboard
before it is built (M39 scope: *"built to whatever design the critique
produces"*).

**Building it touches:** a phone conflict sheet (built on `ConflictBanner`'s
rows, as §13 *variant layer* requires), the compact bar from decision 1,
`ActivityCard.tsx` for the marker, and a test seen red without it (exit gate).
Medium: about 2 days after the design exists.

## 7. Service worker scope (M39 Decision 4)

Static assets only. Never `/api/**`, `/s/**`, `/invite/**` or `/monitoring`.
Hand-written, because the build is Turbopack; `scripts/copy-maplibre-worker.mjs`
is the precedent. Offline trip data reverses ADR-012 and ADR-046 and needs its
own ADR. **Confirm.** The exit gate already requires a unit test over the
route matcher, seen red with `/api/` allowed. About 1 day.

## 8. Push notifications (M39 Decision 5)

Out. Nothing generates a notification today, and M46's chat is the first
feature that would. **Confirm.**

## 9. "Feels like an app": `viewport-fit=cover` and the top inset

**Today.** `app/layout.tsx:34` exports `metadata` only. There is no `viewport`
export, no `app/manifest.ts` and no service worker. The bottom inset already
exists (`globals.css:772`, `:811`, `env(safe-area-inset-bottom)` on the tab
bar), but it only takes effect once `viewport-fit=cover` is set. Nothing uses
`safe-area-inset-top`, so an installed iPhone app would draw the pinned header
under the status bar.

**Recommendation: ship `cover` together with the top inset** on whatever
decision 1 pins. Splitting them means either an installed app with a clipped
header or a second release. Together with the manifest and PNG icons
(`scripts/generate-og-assets.mjs`), this is about a day.

---

## Walk in the same session (already fixed, new on screen)

- **The Plan board's sticky stand-in scrollbar**
  (`resolved/KI-20260922-b-…`). Fixed for the desktop scrollbar that started
  about 200px below the fold. It has never been looked at with a Windows mouse,
  whose scrollbar is thicker and always visible. Walk it at 1366×768.
- **The Calendar's hidden-days control** (`resolved/KI-20260924-k-…`). At 820px
  a fade plus a `Fri–Sat ›` button; at 1024px `Sat`; at 1280px nothing. Check
  it reads as a control, not a label. If decision 4 picks D, this is the model.
- **Phone tag chips' 44px hit area** (`resolved/KI-20260924-m-…`). The button
  is 44px tall and the visible chip is unchanged (`-my-3`). Check that tapping
  between two wrapped rows hits the chip you expect.

## Evidence: what was and was not captured

No screenshots. Two attempts, then stopped, as the brief required:
1. **Production** (`https://caesura.today/demo`): the agent proxy refused the
   CONNECT (`403`, `connect_rejected`, organization policy).
2. **Local dev server** (`pnpm dev` on :3001 after the session hook brought up
   Postgres and `.env.local`): `/demo` rendered its banner, but every
   `/api/**` route answered Next's HTML 404, including `/api/health`. So the
   board showed "Not Found". The container runs Node 22 while the project pins
   24 (`pnpm lanes`, KI-2026-09-02-a). That was not investigated further.

So every pixel figure above is the KI's, dated, and not re-observed. Before
the session, take the screenshots at 390×844 and 820×1180 from a preview
(`walk:preview` with the bypass secret) or a local machine. The useful set:
the Plan fold, Plan scrolled, the Overview landing, tablet Plan with Ask
floating and docked, the chip row at 1440, and settings with Dates open.
