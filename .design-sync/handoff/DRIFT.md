# Design ↔ build drift — Caesura / travel-collab

Source: `Neablis/travel-collab@main` (tree `44dda6f5b911`), read 2026-08-23.
Design: `Trip Planner Redesign.dc.html`.

The repo already answers the "what isn't built" question itself:
`apps/web/src/lib/preview-registry.ts` is a single registry of 18 not-yet-functional
surfaces, each with a milestone, and a sync test keeps it honest against actual
`<Preview id>` usage. **Treat that registry as the authoritative unbuilt list** — I've
used it as the spine of this report rather than guessing.

`<Preview>` itself (`components/ui/preview.tsx`) wraps real markup with real fixture
data, shields pointer events, and stamps a `Preview · M9` badge. So Preview-wrapped UI
is *designed and shelled, not wired* — not a design gap.

---

## 1. Drifted — code and design disagree, you pick

| # | Thing | Code | Design | My call |
|---|---|---|---|---|
| D1 | Product name | `AppHeader` says **Trip Planner**; `metadata.title` is `travel-collab` | **Caesura** | Design wins — you gave me the name this turn. Change both in code. |
| D2 | Unauthenticated home | Bare `<Heading>travel-collab</Heading>` + a `Sign in` link to NextAuth's default page | Full landing hero + custom sign-in/sign-up screens | Design wins — this is the new work from this turn. |
| D3 | Global header contents | Logo, `Trips`, `Playbooks`. No account control. "Quick add" deliberately omitted (needs a trip) | Logo, nav, **avatar that signs out** | Design wins on the avatar (you can't sign out anywhere today). Code is right to omit Quick add. |
| D4 | New-trip flow | A `Dialog` with **one field: name**. `CreateTrip` in `packages/contracts/src/trip.ts` carries *only* a name | My new first-run screen adds **"Roughly when?" chips** | **Code wins** — my chips have no contract field. Either drop them or treat as a contract change. Flagged as my error. |
| D5 | Trip header actions | Also has inline rename, status `Badge`, `SyncIndicator`, Undo/Redo, **History popover w/ version preview + revert**, `Notebook` link | Undo/redo now live in History; Notebooks is a menu; save state moved to the logo; **inline rename is gone** | ~~Code wins~~ **Superseded by the rules pass (see R4, R6, R7 below).** Only the status `Badge` is still code-wins. |
| D6 | Home "next trip" | `TripSummary` has **no start date**, so "next trip" is just `visibleTrips[0]` | Design implies real upcoming-by-date | Code wins for now; needs a server field to do it honestly. |
| D7 | Sync failure | `SyncIndicator` (pending dot) + `board/ConflictBanner` | My new **persistent sync-failure banner** | Design wins per your "banner" answer — but it should reuse `ConflictBanner`'s vocabulary, not a second pattern. |

## 2. Unbuilt — designed, shelled in code behind `<Preview>`

Straight from the registry. Everything I designed in the last several turns lands here,
which is the honest answer to why the rack "hint" copy had nowhere to come from:

**Blocked on a missing data field** (the registry says so explicitly):
- `rack-provenance` (M11) — who parked a stop and which day it came from. My "Was on Day X" tag has **no field behind it**.
- `cost-estimate-state` (M11) — confirmed-vs-estimate per cost. My "est" treatment has **no field**.
- `budget-breakdown` (M11) — Booked/Holds/Travel/Other. My settings breakdown has **no field classifying a cost**.
- `trip-invites` (M13) — `TripMember.role` is the literal string `"owner"`. My invite list with roles is **entirely ahead of the model**.
- `map-legend-modes` (M9) — transport mode per leg, no field.

**Blocked on a feature, not a field:** `home-worth-attention`, `home-decisions`,
`home-playbooks-strip`, `assistant-suggestions`, `assistant-quick-asks`,
`timeline-ghost`, `keep-day-flag`, `keep-day-dialog`, `playbooks-route`,
`insert-playbook`, `share-button`, `add-saved-day`.

Nothing to do in design for these — they're built as shells against the designs already.

## 3. Undesigned — real in code, absent from the designs

This is the biggest surprise and where I'd spend the next pass:

- **Notebook / Pages — an entire feature.** `packages/pages` (macro registry, templates,
  inline + block macros), `NotebookScreen`, `PageScreen`, `PageEditor` (TipTap),
  `MacroNodeView`, `ComposePanel`, and blocks (`ItineraryDayBlock`, `ItineraryTripBlock`,
  `CostsTableBlock`), routed at `/trips/[tripId]/pages`. Zero design coverage.
- **History & time travel.** `HistoryPanel` + `UndoRedoControls`, with *preview a past
  version* (read-only banner) and *revert to state*. Real, shipped, undesigned.
- ~~**Extra lenses.**~~ **Struck 2026-08-26** — `ItineraryLens`, `DailyOverviewLens` and
  `FullTripOverviewLens` no longer exist in the build, so there is nothing here to design.
  `ScheduleLens` and `MapRail` do still exist and are covered by the four designed views.
- **Trip lifecycle.** Delete → undo toast → `RestoreTrip`, and `duplicateTrip`. The
  optimistic delete pattern (drop the row on confirm, re-add on failure) is a real
  interaction with no designed counterpart.
- **Dev login.** A `dev-login` credentials provider behind `AUTH_DEV_LOGIN`. Probably
  intentionally undesigned, but it's the only non-Google way in.

---

## Decisions (2026-08-22)

| # | Call | Status in design |
|---|---|---|
| D1 | **Caesura everywhere** — code should change | Done in the DC |
| D2 | **Build** landing + custom sign-in/sign-up | Designed |
| D3 | Avatar with a menu — **Your account + Sign out** only | Designed |
| D4 | Keep the when-chips as a **Preview-wrapped shell** | Done — own treatment, dashed border + "needs a CreateTrip field" |
| D5 | **All of them** — match the code exactly | Done: Notebook link, inline rename, status badge, sync label, undo/redo, History popover |
| D6 | Keep upcoming framing — **add a start date to TripSummary** | Contract change for code |
| D7 | **Reuse ConflictBanner** — one banner pattern | Done — sync failure now uses `Banner variant="danger"` |

## Review pass — comment resolutions

- **Day rail in Map: removed.** Earlier call kept it in all four views for header
  stability. Map already carries a full-size day rail down its side, so the header
  strip was a second selector for the same job; Map now gets that height back.
  Timeline / Day columns / Calendar keep the strip unchanged.
- **Rail bars: no grey.** Ride legs were tinted, which read as "disabled" next to
  solid stop legs. Ride legs are now the same city colour at 3px instead of 6px —
  travel reads as thinner, not weaker. Day totals inherit the day's ink.
- **Budget meter moved into its own header row**, so a long city list and the meter
  can't collide in the same grid cell.
- **Mobile cards: colour spine is now flush.** The city stripe was an inset rounded
  bar inside padded cards; it now runs edge to edge as a real spine (card padding
  moved inward), matching the desktop timeline.
- **Trip-list rows** rebuilt on the same flush-card structure for consistency.
- **Mobile day-header gradient** now holds solid surface until the last 34px, so
  scrolled content doesn't ghost through the title.

Next: Notebook / Pages — a **trip journal** (written during and after), with **live** macro blocks that always reflect the plan.

## Suggested order

1. You settle D1–D7 (only D4 is a real correction to my work).
2. I design §3 — Notebook first, since it's a whole feature; then History. ~~then the
   extra lenses~~ (struck — they no longer exist). **Note as of 2026-08-26:** Notebook is
   blocked on the SPEC §7 / `templates.ts` contradiction, and History was designed
   2026-08-25.
3. I refresh the handoff so `AGENT-PROMPT.md` points at the registry instead of
   restating unbuilt features as if they were pending design.

## Design pass — 2026-08-24

- **Assistant re-presented as a floating bubble** that drags anywhere and expands into a
  floating panel, with the old side rail kept as an explicit **dock** mode (SPEC §9). The
  rail is no longer the only way to have the assistant, and it is no longer evicted on
  narrow windows.
- **Seed trip moved to Sep 20 – Oct 3, 2026** so the multi-month calendar is the default
  view, not an edge case. This surfaced a real bug worth flagging to the build: date labels
  took their month from the *trip*, so October days rendered as September. Fixed in the
  design by deriving every label from start date + day index — **check the build for the
  same assumption** (`CalendarLens`, `MapRail`, any day-chip label).
- **Mobile scope stated out loud** (SPEC §10): retrieval and small edits on the trip, not
  planning. Recorded so future mobile screens don't drift back toward a second planner.

## Rules pass — 2026-08-25

Six project rules were adopted (`RULES.md`, SPEC §11) and the desktop design was
reconciled against them. Build-side consequences:

| # | Change in design | Build check |
|---|---|---|
| R1 | `Share` / `Quick add` / `New trip` removed from the header | `components/AppHeader.tsx` — header should hold account scope only; Share moves to `trip/TripHeader.tsx` |
| R2 | Drawer renders in Day columns only | `trip/rackDisclosure.ts` — gate on the columns lens, not `timeline || columns` |
| R4 | Trip-header save dot removed; logo carries save state | `trip/SyncIndicator.tsx` moves to the header logo; remove the in-trip instance |
| R4 | `Travel` chip suppressed on transit stops | wherever stop tags render — transit already shows a badge |
| R5 | Filter row removed; tag chips are the control, dim not hide | `lenses/CalendarLens.tsx` must stop filtering cells; needs an opacity pass keyed on the focused tag |
| R7 | Undo/redo relocated into History | `board/UndoRedoControls.tsx` + `board/HistoryPanel.tsx` — both were on the *undesigned* list and now have a design |
| R7 | Notebooks menu at the far right of the view row | `components/pages/NotebookScreen.tsx` entry point; new menu is not in code |
| R2 | Map day rail restored, clicking jumps | `lenses/MapLens.tsx` + `lenses/MapRail.tsx` — reverses the 2026-08-23 removal |
| R6 | Trip title *is* the settings button; **pencil icon and ⚙ removed, inline rename removed** | `trip/TripHeader.tsx` — delete the `Pencil` import, the `renaming` state, and the `Rename trip` icon button; the `<h2>` becomes the button that opens `SettingsSheet`. `trip/SettingsSheet.tsx` — the trip-name row stops being read-only and becomes the one place renaming happens (its comment on L152 is now stale). Update `TripHeader.test.tsx` (`describe("TripHeader rename")`) and `e2e/m8-make-it-real.spec.ts` (`getByRole("button", { name: /rename trip/i })`) to drive rename through settings. **Supersedes D5's "code wins".** |

Carried forward from 2026-08-24 and still true: **day labels must derive their month from
start date + day index**, not from the trip start — check `CalendarLens`, `MapRail`, and
every day chip.

Design-system note for implementers: arbitrary Tailwind utilities (`max-h-[min(420px,80vh)]`)
are inert against the precompiled bundle used by the design file. In the real app the JIT
will compile them, so this is a design-file constraint, not a product one — but any value
copied *out of* the design file may be an inline style for that reason.

Removed this pass: the Trips page's **"Worth your attention"** panel (nudge rows). There
was no code counterpart; it is now gone from the design too.

## Calendar / account settings pass — 2026-08-26

Build-side consequences of SPEC §12.

| # | Change in design | Build check |
|---|---|---|
| C1 | Calendar cells render **city cards**, not activities | `lenses/CalendarLens.tsx` — cell content is now a per-city rollup (name, 7am–11pm span bar, stop count + cost, window, unbooked flag). Needs a day→cities split helper keyed on the LAST `transit` stop |
| C2 | Stop-level drag removed from Calendar | drop handling for calendar cells keeps day reorder only; the stop-drag source is gone |
| C3 | Calendar day selection is persistent, not a pulse | remove the flash-on-jump animation; selected cell holds `inset 0 0 0 2px <accent>`. Calendar keeps day focus across view switches (Map still clears it) |
| C4 | Clicking a calendar day no longer navigates to Timeline | it selects in place |
| C5 | **Account settings** Sheet is real | new surface off the avatar menu: name, email (read-only), home airport, Display section. `Your account` currently has no destination in code |
| C6 | Distance units are account scope | one formatter owns every distance; do not add a per-trip unit field |
| C7 | Home time on hover, default off | needs `trip.tz` and a tz for the account's home airport. Do **not** implement as a global display mode — see §12 |
| C8 | Map hides the header day chips | `lenses/MapLens.tsx` — supersedes the R4 tension logged 2026-08-25 |
| C9 | Budget: "left" is the emphasised value | `trip/TripHeader.tsx` — Badge (`success`/`warning`) for what's left, slate mono for spend-of-total |

### Design-system bug — belongs upstream, not in consumers

`Sheet`'s body is `<div className="flex-1 overflow-y-auto">`. `overflow-y: auto` forces
`overflow-x: auto`, making it a scroll box that clips paint outside its padding edge.
`Input`'s `outline-2 outline-offset-1` draws 3px outside its border box, so **every
full-width input in every Sheet loses its left and right focus ring.** The design works
around it per-Sheet; the real fix is horizontal padding on `Sheet`'s scroll div in the
design-system package. Same class of bug in any Dialog scroller with one-sided padding.

### Resolved since 2026-08-25

- **D5 / R6 (trip rename).** Confirmed: no pencil, no inline rename anywhere in the design.
  The dead `startRename`/`commitRename` handlers that made this ambiguous have been
  deleted from the design file. Renaming happens only in Trip settings.
- **Calendar's future** (§11 "Still open"). Resolved by C1 — Calendar earns its place as
  the city/shape view. No retirement path needed.
- Dead values removed from the design file with no template reference: `dragHint`,
  `mapIntro`, `sugHeading`, `suggestions`, `sugCount`, `blHint`, `fabBottom`.
  The per-tab drag hints and the "What I noticed" feed are gone from the UI.
- The Unscheduled drawer no longer force-opens mid-drag, which was shifting the whole
  bottom of the page (and the assistant with it). It stays where the user left it.


## Baseline / handoff reconciliation — 2026-08-26 (second pass)

Answering "have the baseline, previews and docs drifted?" — yes, in three separate places,
now closed.

**1. The handoff had forked.** Five folders held overlapping copies of the same bundle, one
of them (`design_handoff_trip_planner/`) carrying a design file that no longer matched the
live one. A build agent reading the wrong folder would have implemented a stale design.
`design-sync/handoff/` is now the only handoff; the dated snapshots are deleted, because
previous states belong in version control rather than beside the current one.

**2. Design-system findings had nowhere to go.** The baseline at
`_ds/travel-collab-ui-baseline-…/` is a one-way compiled snapshot, so every DS bug found
while designing was being logged here as if it were product work. Those items now live in
`design-sync/handoff/DS-UPSTREAM.md` as five issues to raise against the DS package:

| # | Item |
|---|---|
| U1 | `Sheet`'s scroll body clips `Input`'s focus ring (accessibility; moved out of the 08-26 section below) |
| U2 | No city-accent scale — two consumers reimplement the same oklch ramp and hash; ramp is saturated at ten cities |
| U3 | No icon-button, chip, or menu-item primitive — 58 raw `<button>`s in the desktop file |
| U4 | Precompiled bundle has no Tailwind JIT, so arbitrary utilities are inert in design files |
| U5 | Vendored baseline ships the bundle only — no component docs, types, or variant grids |

**3. Mobile had left the baseline.** `Trip Planner Mobile.dc.html` carried 74 hardcoded hex
values and used five of the thirty DS components. Fixed this pass:

| Change in design | Build check |
|---|---|
| **Zero literal colours.** City accents declared once on the page root as `--c-<city>-tint|-ink|-solid`, inherited by every screen | the app should read the shared accent helper, not a mobile palette. The map layer takes the resolved value because MapLibre cannot parse CSS variables |
| **Hakone was blue on mobile, brand-green on desktop.** Mobile was assigning colours by eye; both files now run the same FNV-1a hash over the city name | any place the phone client picks an accent |
| **Dates aligned to the 08-24 reseed.** Mobile still said "Oct 3 – 16" and "Day 6 · Wed Oct 8"; the trip is Sep 20 – Oct 3 and Day 6 is Fri Sep 25 (Tokyo → Hakone). Day rail is now Thu 24 – Mon 28 with real cities | none — this was design-side staleness only |
| **Trip list matches `tripCards`**: New Orleans (Booked, Sep 4 – 7) and Lisbon (Draft, dates not set), using the desktop's own state colours rather than city accents | none |
| **SPEC §13 states the mobile foundations** — 44px targets, flush city spine, mono for data, permanent day rail, sheets over pages, no invented data — and the design file renders them as a foundations strip | new phone screens are checked against §13 |

**Deliberately not done, logged instead:** Day 6's three Plan cards still carry times and an
ordering that predate the seed data, and one of them uses an estimate treatment for a stop
the desktop has as `booked`. Reconciling stop content is a content pass, not a token pass —
SPEC §13 "Still open".

**Also newly open:** mobile has no defined offline/sync-fail or conflict state, which
project rule 6 requires of every screen.

### Verification pass — same day

Two defects found reviewing the mobile pass, both fixed:

- **The accent ramp was not perceptually distinct.** Tokyo (150) and Hakone (170) sat 20°
  apart, which at tint chroma is one colour at chip size; on adjacent rail days only the
  selection ring told them apart. The ramp is now `25 · 60 · 95 · 130 · 165 · 200 · 240 ·
  280 · 315 · 350` — minimum 35° gap — in **both** design files. Bucket assignment is
  unchanged (the hash is untouched), so only the hue at each index moved: Tokyo 165,
  Hakone 200, Kyoto 315, Osaka 95, Nikkō 350, New Orleans 130. **Build check:** the shared
  accent helper's hue list. DS-UPSTREAM U2 now carries the 35° floor as a requirement.
- **Mobile's floating "+" covered stop costs.** It sat over the right edge of the scroll
  list, so at some scroll position it always hid a right-aligned mono value. Removed;
  adding a stop is now a dashed end-of-day row, matching desktop's "Add a stop after 9 pm".
  Recorded as a mobile foundation: nothing floats over data.
- Also caught while there: mobile still had a **⚙ in the trip header**, which rule R6
  removed from desktop on 2026-08-25. Gone; the trip title is the settings button, as on
  desktop. **Build check:** the phone client's trip header.

  **Correction to the note above:** "the map layer takes the resolved value because MapLibre
  cannot parse CSS variables" was only half the problem — MapLibre parses CSS Color 3 only,
  so it rejects `oklch()` too, and a rejected paint value falls back to black rather than
  erroring visibly. The design file now converts the accent **arithmetically** (oklch → oklab → linear sRGB →
  sRGB, `oklchToRGB()`) instead of carrying a hex twin that would drift from the ramp.
  Neither of the two obvious shortcuts works: canvas `fillStyle` and `getComputedStyle`
  both downconvert CSS Color 3 but **preserve `oklch()` verbatim**, so they return the
  input unchanged and the failure looks fixed while the line still renders black. Verified
  live: `getPaintProperty('l-route','line-color')` → `rgb(0, 119, 127)`. **Build check:**
  anywhere an accent reaches a map paint property, a chart library, or an SVG attribute —
  the ramp is oklch and most non-CSS consumers cannot read it.

- **The next-trip countdown was fiction in both files.** Desktop said "in 60 days", mobile
  "in 25", and the home dateline says Tuesday, August 4 — which is 47 days from the Sep 20
  start. All three were independent hardcoded strings. Both files now derive the dateline
  and the countdown from one pair of constants (`TODAY`, `NEXT_TRIP_START`) via
  `daysUntil()`, and both render "in 47 days". **Build check:** this is DRIFT **D6** biting
  — `TripSummary` has no start date, so the server cannot compute this either. The field is
  still owed; until it lands the countdown cannot be honest in the product.

- **Mobile's component gap written up as DS-UPSTREAM U6.** Mobile now *adheres* to the
  baseline but cannot *express* its five touch patterns through it, so they are inline in
  both design files. Proposed as variants of existing components — `DayChip`,
  `Chip size="touch"`, `Card spine`, `Sheet header`, plus one new `TabBar` — rather than a
  mobile package. Two of the five also collapse hand-built desktop implementations.

## Mobile folded into the prototype — 2026-08-26 (third pass)

The phone is no longer a separate file. `Trip Planner Mobile.dc.html` is deleted; the phone
is a **surface of `Trip Planner Redesign.dc.html`**, selected by its `surface` prop
(`desktop` | `phone`), rendered as an overlay so no desktop markup was restructured.

Why: every defect fixed in the two passes above — the stale Oct 3 dates, blue Hakone, the
leftover ⚙, the 25-vs-60 countdown — existed *only* because there were two files. None were
design mistakes; all were copies falling out of sync, each caught by hand. Sharing one state
makes that class of bug structurally impossible instead of a thing we audit.

**What the phone now shares, not copies:** `TRIPS`, the accent ramp and city hash,
`buildDays()` items, `state.focus`, `state.tagFilter`, `state.setOpen`, `state.addOpen` and
the add/edit form state. The phone has exactly two values of its own — which tab is showing
and whether the surface override is active.

| Interaction | How it works | Build check |
|---|---|---|
| Day rail selection | The desktop's own `chips[].jump` — picking a day on the phone moves desktop's `focus`, and vice versa | one focused-day concept per trip, not one per surface |
| Plan / Map / Notebook / Trips | `state.phoneTab`; app-level tabs exist only on the phone | `TabBar` is the one genuinely new component (DS-UPSTREAM U6e) |
| Edit sheet open/close | Shares `addOpen` + the add form state; the desktop `Sheet` and the phone bottom sheet are two presentations of one state, and each stands down on the other surface | the phone sheet owns Cancel/title/Save because mobile has no top bar (U6d) |
| Long-press to reschedule | 460ms hold on a stop card opens the sheet with the time as the subject, then Save moves the stop and re-sorts the day | needs the 15-minute snap and the re-sort; the overlap warning fires rather than blocking |

**Two real bugs this surfaced in the desktop file:**

1. **Save never saved a time.** `saveAdd` only wrote tag overrides, so editing a stop's start
   time did nothing — on either surface. There is now one `saveStopEdit()` that moves the
   stop (keeping duration, snapping, re-sorting) and both surfaces call it. **This was a
   live desktop bug, not a mobile one.**
2. **A capture-phase `document` pointer listener is not survivable.** The first long-press
   implementation attached `pointerdown`/`move`/`up` to `document` with `capture: true`,
   which swallowed pointer events the host page needs and hung the preview with no console
   error. Gesture handlers belong on the element. Worth knowing for the real app, where the
   same listener would fight the drag system.

**Also fixed:** the phone rail was tinting every day by its *starting* city, so all six
Tokyo-departing days rendered identically — including the Hakone travel day. Rail chips now
carry the destination bar the desktop chips already had.

**Still open:** the phone has no offline/sync-fail or conflict state (project rule 6), and
Notebook on the phone is a day-scoped read of the focused day rather than the full macro
document. Both are recorded in SPEC §13.

### Phone map — container guard + a defined offline state

Two findings, one fixed and one converted into design:

- **Real bug:** `_phoneMap()` lacked the container-identity guard `initMap()` has. `sc-if`
  remounts `#phonemap`, so the instance stayed bound to a **detached** node and its style
  load aborted silently. It now rebuilds when `getContainer() !== el`, and resizes on
  re-entry. **Build check:** any map mounted inside conditional markup needs this guard.
- **Environmental, not fixable here:** in the preview host the second MapLibre instance
  never finishes loading its style (`isStyleLoaded()` stays false; forcing repaints and
  resizes does not help; the style URL itself fetches 200). The desktop map uses the same
  URL and the same library, so this is a host limitation around a second instance, not a
  design defect — it should load normally in a real browser.

Rather than ship a silent grey pane, the Map tab now has the **offline state project rule 6
already required**: after 2.6s without tiles it shows "Map tiles didn't load", says the
day's stops are still readable, and offers *Try again* (rebuilds the instance) and *Open
Plan*. This closes half of the rule-6 gap logged in SPEC §13 — the phone still has no
**conflict** state.

**Also converted this pass:** the rAF call site for `_phoneMap()`, for the same reason as the
rail. **Correction to how that was first written up:** `requestAnimationFrame` is not
"never delivered" here — it is *starved* in the preview host, firing only when something
forces frames. That distinction matters, because it cuts both ways: work the design needs
done (rail sync, map init) may never run in the preview, while work the design needs
*avoided* runs reliably in a real browser and not here. The phone focus reset below is the
second kind — it looked like flaky probe noise in preview and would have been constant for
a real user. Verify rAF-gated behaviour by calling the function directly, never by waiting.

### Phone showed no stops — tab bar and route were independent

Reported from the live view: the phone header said "68 stops · 6 cities" while the Plan
screen showed no activities.

Root cause: `phoneTab` and `route` were two separate sources of truth for "where am I".
With `route: 'home'` and the tab defaulting to `plan`, the Plan screen rendered its header,
rail and summary from trip-level data but had no focused day, so `phoneStops` was empty —
a screen that could not exist on desktop, because on desktop the timeline only renders
inside a trip.

Fix: **the tab IS the route.** Trips means `route: 'home'`; Plan / Map / Notebook mean
`route: 'trip'`. Tab highlighting derives from the same expression, so the bar can no
longer disagree with the screen, and the phone Map is only constructed inside a trip.

**Build check:** the phone client must not have app-level tab state independent of the
router. This is the same class of bug as the two-files drift — two places holding one
truth.

**Verified:** phone + `route: 'home'` now lands on the Trips list (not an empty Plan);
tapping Japan gives `route: 'trip'` with 4 stop cards on Day 1, first card "Land at
Haneda, 2:30 pm – 4 pm, $310".

**Follow-up, same root cause one layer down:** `tripCards[].open` set `route: 'trip'` but left
`phoneTab: 'trips'`, so the list kept rendering while no tab read active — a state the bar
could not represent. `'trips'` is no longer a storable tab value at all; `phoneTrips` is
`route !== 'trip'`, so the list state is expressed by the route alone and no call site can
desync it. Verified: Trips tab → Japan card → `route: 'trip'`, list gone, 4 stop cards, Plan
highlighted brand. **Build check:** the phone router must own "am I in a trip"; tab state
stores only which view inside one.

### Desktop scroll-spy was overwriting the phone's day selection

Root cause: `_watchScroll()` installs a capture-phase `document` scroll listener, so scrolls
originating **inside the phone overlay** — the stop list, and `syncPhoneRail()` writing
`rail.scrollLeft` — reached `_central()`, which recomputes `focus` from the still-mounted
desktop timeline (`#planscroll` at scrollTop 0) with no surface guard. Result: the phone
snapped back to Day 1, breaking the rail, which is its only day switcher.

Both `_sc` and `_central()` now return early on the phone surface — the rail is the sole
authority for `focus` there.

**This is the cost of sharing state, and worth stating plainly:** one `focus` is right, but
desktop-only *derivation* of it has to be gated per surface. A shared value needs one owner
per surface, not one owner overall. **Build check:** the phone client must not run the
timeline's scroll-spy.

## Reconciled against the build — 2026-08-26 (fourth pass)

Read this sync: `docs/STATUS.md`, `docs/known-issues.md`, and the build's own audit index
(`docs/design-feedback/2026-08-26-design-sync-ui-audit.md`). **The build audited the handoff
before we audited the build**, and their report is the counterpart to this file. Where they
disagree with us, they were mostly right.

### Corrected on our side

| What | Detail |
|---|---|
| **Seed data dates** (their audit §E) | `japan-trip-seed.json` said **Oct 3 – 16, entirely inside October** while SPEC §4 says Sep 20 – Oct 3 — and the preview's demo reset imports that JSON, so the build's demo data could never produce the two-month calendar §4 exists to protect. The handoff dated the trip three ways; now it dates it once. All 14 days regenerated with real weekdays (Sun Sep 20 → Sat Oct 3), cities unchanged. |
| **SPEC §1 struck** | Mitchell **rejected the account → trip → day focus-scope model as a whole** and cancelled Phase 1b unbuilt. §1 is now marked rejected rather than quietly left standing. Two of its factual claims were also false: `FocusProvider` holds one field, and **`MapRail._railLock` never existed** — §1's 900ms lock cited a pattern that was not there. |
| **§1's Calendar/rack rule superseded** | Overtaken by the drawer reversal: removed from Timeline and Calendar, gated by `board/lensAcceptsDrops.ts`, returning per lens as drop targets land. |
| **Mobile answered** | Their **KI-46** ("mobile is the desktop layout at 402px; the handoff's mobile file is a different product") is answered from our side this session — the phone is a surface of the one design file, not a separate product, and SPEC §13 states its foundations. |

### Our D-items now have build-side ticket numbers

- **D6 (`TripSummary` has no dates) is their KI-34**, still open, and *worse than D6 described*:
  it is not only a display approximation — `nextTrip` is `visibleTrips[0]`, so with no date to
  sort by the home hero **can surface the wrong trip**, not merely the wrong date on the right
  one. Our derived countdown ("in 47 days") is honest design-side and remains unbuildable
  until KI-34 lands.
- **Tag chips and dim-in-place filtering are blocked by KI-47** — there is no `tags` field, and
  it blocks five designed surfaces. Worth knowing before more tag UI is designed: the phone's
  filter chips inherit this.
- **DRIFT §3's "extra lenses" bullet is stale and struck** — those three lenses no longer exist.

### Their open items that touch our designs

| KI | What it means for design |
|---|---|
| **KI-43** | `Board.tsx` stacks one full-width `Banner` per conflict above the columns — 12 on the Japan seed, ~700px, board below the fold. The design puts conflicts **inside** the card, which `Column.tsx` already does. Design is right; the fix is theirs. |
| **KI-44** | `.tc-page-editor` is applied to every page and **defined nowhere in the repo**, so Notebook prose renders with no typography. Cheapest real fix in the audit. |
| **KI-45** | `Preview size="container"` covers host content, including a currency amount in Trip settings. |
| **KI-48** | Six one-file cosmetics, including `1 travellers`. Our copy says "4 travelers"; the pluralisation bug is theirs. |

### Two decisions that are not ours to make, and are not code either

- **SPEC §7 contradicts `packages/pages/src/templates.ts`.** Our §7's whole premise is prose
  with live macro chips; the build **deliberately removed macro authoring in M8** and seeds
  templates with no macro nodes. Nobody should build to §7 until that is settled — and it
  directly affects the phone Notebook we have queued, which is why that stays unstarted.
- **Whether a day column sorts by start time** the way the design does is still open (their
  audit D3). Their `db-seed.ts` reverse-order bug is fixed and was never in the preview, but
  the seed fix does not answer the product question.

### Where the build stands, for our planning

M10 Wave 2 Phases 5–8b are merged; **Phase 9 is M10's exit gate and is the next work**. The
audit's verdict on the trip surfaces is "close" — timeline, calendar, day-chip rail, map rail,
trip header, Trip settings, Playbooks, the new-trip wizard, the unscheduled rack and the
end-of-trip block all read as designed. Nothing in the audit holds M10's gate.
