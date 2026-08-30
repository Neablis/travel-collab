# Spec — what the design file cannot say out loud

Companion to `design/Trip Planner Redesign.dc.html` (the phone is a `surface` prop on it, not
a second file). Current as of 2026-08-30 — §15 is the newest section.

## 1. Focus scope — ~~the model behind the chrome~~ **REJECTED, do not build**

> **Struck 2026-08-26.** Mitchell rejected this section **as a whole**, not deferred it, and
> Phase 1b was cancelled unbuilt. The rule that replaces it: *the top bar is for
> functionality larger than a trip, and the elements below the top bar are trip-scoped
> actions* — and on the header's Quick add, *"Only 'Add stop' where it is now"*. That is what
> `AppHeader.tsx` already said and what this project's own rule 1 now says. The section is
> kept here as a record of a rejected proposal; nothing below it is a design instruction.
>
> Two factual claims in it were also found false while the cancellation was scoped:
> `FocusProvider` does **not** distinguish scope from the day-chip ring (it holds one field,
> `focusedDay`), and **`MapRail._railLock` does not exist** — `MapRail` has a
> leading+trailing scroll throttle, which cannot tell a programmatic scroll from a user one.
> The 900ms lock below was written as if mirroring an existing pattern; there was none.
>
> §1's one non-header rule — that Calendar drops the unscheduled rack the way Map does — was
> superseded by a broader decision the same day: the drawer is removed from Timeline and
> Calendar entirely, gated by `board/lensAcceptsDrops.ts`, and returns per lens as each
> gains real drop targets. See this project's rule 2.

~~There is exactly one focus scope at any moment: **account → trip → day**. It decides what
the global header, the trip header and the assistant show.~~

| Scope | When | Global header | Assistant context |
|---|---|---|---|
| account | trips list, Playbooks | `New trip` + avatar | "Looking at all three of your trips" |
| trip | inside a trip, no day selected | `Share`, `Quick add`, avatar | "Looking at Japan: Tokyo → Kyoto → Osaka" |
| day | inside a trip, a day explicitly selected | same as trip | "Looking at Day 6 · Kyoto" |

Rules that matter:

- **Trip actions never appear outside a trip.** No Share, no Quick add on the trips list.
- **Day scope is entered explicitly** (clicking a day chip, calendar cell, or map rail row)
  and **left by scrolling**. Programmatic scrolls from selection itself must not clear it —
  the design file locks for 900ms; the map rail already had this pattern (`_railLock`).
- **Calendar and Map are trip-scope views by definition** — they draw the whole trip, so
  entering one drops day scope and hides the day-chips row and the unscheduled rack.
- **The day-chip ring is not scope.** It marks the day most central to the screen and
  follows scroll (vertically in Timeline, horizontally in Day columns). Scope says what
  you're acting on; the ring says where you are. Keep them separate.

## 2. Save state

Three states, driven by the real save queue. Replaces the old "All changes saved" text.

- **saved** — 11px dot, `--color-success-ink`. No label.
- **saving** — dot in `--color-brand` with two haloes expanding to 2.1× on a staggered
  1.4s loop, plus a `Saving…` label in brand. Deliberately loud: it was too subtle before.
- **error** — dot in `--color-danger`, label "Couldn't save — retrying".

Note `--color-success` **does not exist** in the design system. Use `--color-success-ink`.
Defined: `--color-success-tint`, `--color-success-ink`, `--color-warning`, `--color-danger`.

## 3. Trip dates — start only

The Dates row in Trip settings is editable but **start-only**. Clicking the range reveals a
single `input[type=date]` for the start; the end is derived from the number of days in the
plan and shown beside it (`→ Oct 16, 2026`). Copy: "Pick the day you leave. The end follows
the N days in your plan — add or remove a day and it moves."

Changing the start rewrites every day's weekday and date from the new start, so day headers,
chips and the calendar all move together. There is never a range that disagrees with the days.

## 4. Calendar spans months

The calendar is built from the trip's **real date range**, not from one month. It renders one
**stacked block per month** the trip touches, each with a header (`November 2026`) and a note
naming the days it holds (`Day 8 – Day 14`). Each block shows only the weeks that matter —
lead-in days before the start, nothing trailing past the end. No month paging.

Days are matched by **full date**, never by day-of-month: matching on day-of-month scattered
a Nov 27 → Dec 10 trip's December days onto November's 1st–10th.

**The seed trip now straddles a boundary on purpose.** Japan runs **Sep 20 – Oct 3, 2026**:
eleven days in September, three in October, so the two-month case is the default thing you
see rather than an edge case nobody looks at.

The same rule binds every date label outside the calendar. A day's month comes from
*start date + day index*, never from the trip's month — a trip does not have a month. The
day rail prints the month alongside the number on **day 1 and on the 1st of any month**, so
a rail reading "… Wed 30 · Thu 1 Oct · Fri 2" is never ambiguous.

## 5. Component mapping — the "unnamed element" answers

The design system has **no `Hint` component**. A 12px slate helper line is one of:

- **inside a form row** → `FormField`'s `hint` prop (renders `Text variant="muted"`, and
  swaps to the error text when `error` is set);
- **standalone, e.g. beside a toggle** → `Text variant="muted"`.

Never hand-roll a 12px slate span. Same principle generally: an element described only by
size and colour is almost always a design-system component used plainly — check
`components/<group>/<Name>/<Name>.prompt.md` before concluding something is missing.

Other mappings worth stating: the sync-failure bar and the History preview banner are both
`Banner` (`danger` / `info`) — reuse `ConflictBanner`'s pattern rather than adding a second
banner treatment. Account menu and History are both `Popover`.

**Popover triggers and Banner `actions` must keep a stable element identity across renders.**
A fresh React element every render makes Radix re-render in a loop and hard-locks the main
thread. This actually happened in the design file; it is not hypothetical.

## 6. Decisions (2026-08-22)

| # | Decision | Owner |
|---|---|---|
| D1 | Product name is **Caesura** everywhere — `AppHeader` and `metadata.title` still say Trip Planner / travel-collab | code |
| D2 | Build the landing page + custom Google sign-in/sign-up, replacing NextAuth's default page | code |
| D3 | Account menu on the header avatar: **Your account** + **Sign out** only | code |
| D4 | First-run "Roughly when?" chips stay as a **`<Preview>` shell** — `CreateTrip` carries only a name | code |
| D5 | Trip header keeps everything the build already has: inline rename, status badge, sync state, undo/redo, History, Notebook link | done |
| D6 | Add a **start date to `TripSummary`** so home's "next trip" is real rather than `visibleTrips[0]` | code |
| D7 | One banner pattern — sync failure reuses `ConflictBanner`/`Banner` | done |

## 7. Notebook — pages that read like documents

Route: `/trips/[tripId]/pages` (list) and `.../pages/[pageId]` (one page). Two audiences:
the planner building the trip, and the traveller who didn't plan it and just needs the day.

**Pages are prose with live values.** A value renders as a **chip** — tinted, faintly
underlined, the macro name in its `title`. It reads as words in a sentence but resolves from
the trip on every render, so moving a day or a stop rewrites the page with nobody editing it.
Users never see or type macro syntax.

**Every page has a scope.** Trip-wide, or pointed at one day via the "This page is about"
dropdown (that is `PageContext.dayRef`, already in the contract). Changing it re-resolves the
whole page and raises an info Banner naming what it now follows.

**Reading / Editing** is one segmented control. Editing reveals the repeat rail's label, its
"Edit the wording" action, and the insert affordance. Reading is the traveller's view.

**Prebuilt pages ship with the trip** — "Trip overview" (trip-wide) and "One day" (day-bound),
matching `templates.ts`'s `trip-overview` / `day-sheet` seeds, plus the user's own pages.
"Blank page" creates an **Untitled page** (matching `NotebookScreen`'s `handleCreate`), which
does not appear in the list until it exists.

### The insert picker — two axes, not one list

`Insert from the plan` is a Sheet with **search**, then **scope** (Your account / This trip /
The day this page is about — each a row with a live count and a one-line explanation), then
**how it reads** (All / One value / A block / Repeats). Scope × shape is a lens, so the picker
stays the same size as the registry grows. Each item shows the registry's own `description`, a
shape tag, and a real resolved preview.

Two states the picker must keep honest:

- A value with no field behind it (e.g. a home airport) carries a `needs a field` badge and
  says so on click instead of claiming an insert.
- Choosing a **day** value on a **trip-wide** page **binds the page to a day** and reveals the
  dropdown — the design of `MacroResult`'s `unbound("day")` case, matching
  `PageScreen.handleBindDay` / `focusDayBinding`. The day scope's hint changes to
  "Not pointed at a day yet — picking one of these will point it" when unbound.

### The one new primitive

**Repeaters.** "A line for every day/stop/city" — one author-written sentence that repeats per
item, with chips filled from each item ("Today we're going to *Hakone Open-Air Museum* in
*Ninotaira*."). Rendered on a dashed rail labelled with what it repeats over.

**The registry cannot express this yet.** `itinerary.trip` resolves a fixed block; there is no
loop macro and no params for an author-supplied row template. This needs a macro param schema
(the registry already owns per-macro `params`), and it is the main engineering decision the
Notebook creates.

**Account scope is also new** — `Your name` / `Your email` exist in the NextAuth session, but
there is no account model beyond that, so anything else at that scope needs fields first.

## 8. Deliberately not designed yet

- **Travelers UI** — the traveler avatars were removed from the trip header's meta pill;
  travelers are reachable only through Trip settings until this exists.
- **History** beyond the popover, and the extra lenses (Itinerary, Schedule, DailyOverview,
  FullTripOverview, MapRail).
- Everything in `preview-registry.ts` — that registry, not this file, is the authoritative
  list of unbuilt surfaces.

## 9. The assistant — one panel, three presentations

The assistant is **not a fixed rail**. One panel, three presentations, and the user picks:

| Mode | What it is | Layout cost |
|---|---|---|
| **Bubble** | A 56px brand circle, dragged anywhere, clicked to expand | none — `position: fixed` |
| **Floating** | 364×476 card with overlay shadow, dragged by its header | none — `position: fixed` |
| **Docked** | The old right-hand rail: 356px, full height under the header | **real** — a flex sibling, so the plan shrinks instead of hiding |

Rules that matter for the build:

- Expanding and collapsing keep the **bottom-right corner planted**, so the panel grows out
  of the bubble rather than jumping across the screen.
- Position is clamped to the viewport with a 16px pad, and re-clamped on resize. A narrow
  window no longer evicts the assistant — floating costs no layout width, so there is
  nothing to evict.
- Docked is the only mode that touches layout, and the only mode where dragging is off
  (cursor `default`). Its left edge is a **2px `--color-border-strong`** divider, not a
  hairline: it is a structural wall, not a card edge.
- Minimising from any mode returns to the bubble. Docking always opens the panel.
- Copy follows the mode — the empty state drops "Drag the header to park it anywhere"
  while docked, because that interaction is switched off there.

## 10. Mobile is a companion, not a second planner

The phone surface (design file `surface: phone`) is deliberately narrower in scope than the desktop
design: **retrieval and small edits while you are on the trip**, not trip planning.

- Two views, not four. Day columns and Calendar exist to show *density*, which a phone
  cannot show honestly.
- A pinned day-rail spine is the only navigation.
- Tags carry more weight than on desktop: the filter row is the only way to thin a 402px
  column, and the stop editor's tag picker sits above the fold with 44px targets.
- If a future screen needs multi-day restructuring, that is a signal it belongs on desktop
  — not a signal to widen the mobile scope.

## 11. Project rules (2026-08-25)

Six rules now govern every screen; the full text is `RULES.md`. They are not style
preferences — they decide what may exist on a page. Summary and what each one changed:

**R1 — the top bar is account scope only.** Project name / Trips / Playbooks / Avatar.
Nothing scoped to a single trip may live there. Removed from the header: **Share**,
**Quick add**, **New trip**. Share now sits in the trip header next to the trip title;
Quick add was already the in-trip FAB; New trip lives on the Trips page.

**R2 — no purposeless UI.** The unscheduled drawer renders in **Day columns only** — the
one view where a drop actually lands. Previously it also rendered in Timeline, where a
drag ended in "Open Day columns to drop this": present and inert.

**R3 — never nest dropdowns two levels deep.** No menu inside a menu, no select inside a
popover that itself opens from a menu. Currently clean; the watch item is the backlog
card's day select if that card ever moves into a menu.

**R4 — no duplicated information.** Removed: the trip page's "← Your trips" (the top bar
has Trips), "3 trips · 1 shared with you" (the grid below it is countable), the trip
header's own save dot (the logo carries save state), and the redundant "Travel" tag chip
on stops already badged as transit.

**R5 — few things, made easy.** More options is rarely better. This is why filtering was
replaced rather than extended (below), and why the trip title collapsed to one control.

**R6 — assume the best case, recover from the worst.** The happy path is the default view;
every screen still needs a defined empty, offline/sync-fail, and conflict state. Nothing
was outstanding on this pass.

### Tag focus replaces the filter row

The header filter row is **gone**. Tag chips on a stop are now the control: clicking
"Meal" on a stop dims everything not tagged Meal to 32% opacity across Timeline, Day
columns, Calendar and Map; clicking again clears. Single focus, one tag at a time —
multi-select was the part that earned its keep least.

**Focus dims, never hides.** The calendar used to filter its cells down to three matching
stops; it now keeps every stop rendered and dims the off-tag ones, so the shape of a day
survives the filter. Cell overflow copy reads "3 of 5 in focus" while focus is on. When
focus is active, a line beside the view tabs names the tag and offers Clear.

### The logo is the save light

One mark, two jobs. `◎` is brand at rest, **breathes** (1.5s opacity pulse, no spinner)
while saving, and turns `--color-danger` when it cannot reach the trip. The separate save
dot in the trip header was removed. Save state is technically trip-scoped while the logo
is account-scope; it stays there because it is *status*, not an action.

### Undo / redo moved into History

No undo/redo buttons in the chrome. ⌘Z / ⇧⌘Z are unchanged. The two buttons now sit as a
two-up row at the top of the History popover with their shortcuts printed, so the list
below gives them context. **The history list is the single source of truth**: undo walks
to the newest not-yet-undone entry, marks it undone, and toasts that entry's own
description; redo walks back up. Session edits still apply their real snapshot.

### Notebooks is a menu, not a tab

Notebook left the view tab strip — clicking a tab and being navigated to another route was
surprising. It is now a bordered pill (drawn notebook icon + "Notebooks" + ▾) at the **far
right** of the view row, deliberately styled as a different class of thing from the tabs.
It opens: **New notebook**, then the trip's notebooks with their day/trip-wide binding,
then **Browse all notebooks →**. One noun — "notebook" — in all three places.

Height: the popover content is capped inline with
`max-height: calc(var(--radix-popover-content-available-height, 420px) - 24px)` on the
inner wrapper, `min-height: 0` plus `overflow-y: auto` on the list. The create row and
footer are pinned; only the list scrolls. **Do not use arbitrary Tailwind values
(`max-h-[…]`) here** — this page loads the precompiled `_ds_bundle.css` with no JIT, so
uncompiled utilities land in the DOM and do nothing.

### Map keeps its day blocks

The header day rail is back in Map, and clicking a day scrolls the side rail and refocuses
the map. **Superseded in §12: Map hides the day chips.** Open R4 tension at the time: Map had day chips *and* the 268px side rail. They are not
identical (chips give trip-wide shape, the rail gives per-day detail), but if it reads as
duplication in use, slim the rail to route/distance and let the chips own day selection.

### Trip title is the way into trip settings

The rename pencil and the ⚙ button are both gone. The trip name + state badge are one
button that opens Trip settings, where the name field already lived. Hover gets a
`--color-moss` background so it reads as clickable.

### Still open (as of §11 — see §12 for what closed)

- Tagging many-to-many table; Notebook repeater tag parameter; account-scope Notebook values.

---

## 12. Calendar as a city view, account settings, focus rings — 2026-08-26

### Calendar stopped competing with Day columns

Calendar no longer lists activities. A cell now carries **one card per city the day
touches**, and each card summarises its own stops:

| Line | Content | Why |
|---|---|---|
| Title | City name, in that city's accent ink | The question Calendar answers |
| Span bar | Filled segment across a fixed **7am–11pm** track | Where in the day the plan sits — the weekend-shape read no other view gives |
| Meta | `4 stops` · day cost | Volume and money at a glance |
| Window | `10:30am–8:30pm` | Mono, secondary |
| Flag | `2 to book` in warning tint, **only when > 0** | The one actionable thing at this zoom |

Counted as unbooked: every stop whose kind is neither `booked` nor `transit`.

**Travel days split at the LAST transit stop.** Stops up to and including it belong to the
city you leave; everything after to the city you arrive in. The departing city renders as a
one-line strip (`Tokyo   8:20am`) and the arriving city gets the full card — the day
belongs to where you end up, and cell heights stay even across the week instead of doubling
on transit days. The strip's timestamp is the transit stop's **start** (the departure).

Flex allocation inside the strip matters: city is `flex: 1 0 auto`, the time
`flex: 0 1 auto; min-width: 0`. The timestamp abbreviates before the city name ever does.
There is no `↓` glyph — position carries the relationship.

**Tag focus at this zoom.** Instead of dimming individual stops, a card shows
`2 of 6 match`; a city with no matching stop drops to `opacity: 0.28`. Dim, never hide.

**Consequence:** stop-level drag is gone from Calendar — there are no activity chips left
to grab, so `overCal`'s source no longer exists. Day-level reorder (drag a day's header
onto another date) still works. Empty days render a dashed "Nothing planned yet" button.

### Selecting a day in Calendar is state, not a flash

The old behaviour ran a 780ms box-shadow pulse and navigated to Timeline. Both are gone.
Clicking a day **selects it and stays put**: the cell holds `inset 0 0 0 2px <accent>`
for as long as it is selected, mirrored by the ring on the header day chip. Calendar now
keeps day focus when switching views; only Map drops it, because the rail owns focus there.

### Account settings

`Your account` in the avatar menu opens an **Account settings** Sheet — previously it
flashed "not built yet". Contents, in order: **Your name** (drives the popover name and the
avatar initials), the signed-in email as a read-only row, **Home airport**, then a
**Display** section.

Sign out stays in the avatar popover only. Putting it in both was Rule 4.

**Display → Distance** (`Kilometres`/`Miles`, SegmentedControl). Account scope, not trip
scope — a trip does not have a unit, a person does. One helper, `kmLabel`, owns every
distance in the app: map rail totals, focus-card stats, the longest-hop line, map leg
labels, and the Timeline day summary. Miles below 0.19 render as feet; km below 1 as metres.

**Display → Home time on hover** (`Off`/`On`, default Off). Hovering a stop's time gutter
in Timeline reveals a mono secondary line: `SFO 10:30 pm −1d`, built from the home airport
code, the trip's UTC offset (`trip.tz`) and a fixed home offset.

This is deliberately **not** a display mode. Every time in a plan is inherently local —
"dinner at 7pm" means 7pm in Kyoto — so a global toggle would rewrite the itinerary into
home time and render the 8:20am Romancecar as 4:20pm the previous day. Home time is a
*reference*, surfaced on demand, and the plan never leaves the trip's own clock.

### Focus rings were being clipped — a design-system bug

`Sheet` renders its body as `<div className="flex-1 overflow-y-auto">`. Setting
`overflow-y: auto` forces `overflow-x` to `auto` as well, so that div is a scroll box
whose padding edge clips anything drawn outside it. `Input` focuses with
`outline-2 outline-offset-1` — 3px outside its border box — so **every full-width input in
every Sheet had its left and right focus ring cut off.**

Worked around in the design by insetting each Sheet's content wrapper
(`padding: 4px 4px 2px`), and by giving the two Dialog scrollers symmetric padding
(they only had `padding-right`). **The durable fix belongs in the design system**: add
horizontal padding to `Sheet`'s scroll div rather than making every consumer pad around it.

### Trip header

- The **left figure is the answer**: `$7,315 left` is a Badge (`success` under budget,
  `warning` over), and `$9,085 of $16,400` beside it dropped to slate mono. It used to
  blend into the reference numbers.
- The budget pill sat slightly above its sister pill; the row is `align-items: center` now.
- **Map hides the day chips.** The 268px rail says the same thing, so the map runs from the
  tabs down. This closes the R4 tension flagged in §11 — chips and rail no longer coexist.

### Mobile

- **Stop cards:** the 3px city spine was eating the left inset, so cost and tag read tight
  against the opposite edges. Inner padding is `15px 15px 15px 12px` — every side is 15px
  from the card's outer edge, spine still full-length and flush.
- **Trip rows:** the leading tile is 38px, matched to the text block's height, so its inset
  is 14px on all four sides.
- **Header fade bug.** The sticky header's gradient ran through its own date rail, fading
  the date cards. The header is solid `--color-surface` now and the fade is a separate
  30px strip positioned at `top: 100%` — content scrolls away *underneath* the cards. The
  motif is worth reusing elsewhere, but always as a strip below the surface, never as the
  surface's own background.

### Still open

- Tagging many-to-many table; Notebook repeater tag parameter; account-scope Notebook values.
- Home time currently uses a fixed home UTC offset; a real build needs a tz per trip and a
  tz resolved from the account's home airport.


## §13 — Mobile foundations

Mobile is a **surface of the same design system**, not a second one. §10 already set its
scope (retrieval and small edits on the trip, not planning); this section sets what is
binding on any new phone screen. Anything not listed here is inherited from the desktop
baseline unchanged, and a mobile screen may not introduce a pattern the desktop does not
have.

1. **44px targets, always.** Every tag chip, nav item and row action clears 44px even when
   the label is small. Chips grow by `min-height`, never by font size — the type scale is
   shared with desktop.
2. **The city spine is flush.** A stop card's accent runs edge to edge as a 3px spine with
   the card's padding moved inward; never an inset rounded bar. A dashed spine means the
   stop is not committed.
3. **Time and money are mono.** Every clock time, date, duration and currency uses
   `DataText`. Mobile drops the desktop's 92px time gutter, so mono is the only remaining
   signal that a value is data.
4. **The day rail never collapses.** It is the spine of every trip-scoped screen and holds
   the same selection across Plan, Map and Notebook. A phone can hold one day at a time;
   the rail is how you change which.
5. **Nothing floats over data.** No floating action button. A control hovering over a
   scrolling list will cover a value at some scroll position, and costs are right-aligned.
   Adding sits at the end of the day, as on desktop.
6. **Sheets, not pages.** Editing keeps the day visible behind it. The sheet carries its
   own Cancel / title / Save header, because mobile has no top bar to hang actions on.
7. **No invented data.** Mobile renders the same trip the desktop file renders — same
   dates, same day numbering, same stops. A field that does not exist on desktop is not
   mocked up on mobile.

### City accents are shared, not redrawn

The ten-hue city accent scale (SPEC §5) is the same on mobile. It is declared once on the
page root as `--c-<city>-tint | -ink | -solid` and inherited; no mobile screen carries a
literal colour. The scale itself belongs in the design-system package —
`DS-UPSTREAM.md` **U2**, which also records that the ramp is currently saturated at ten
cities.

### The phone is a surface, not a file

Mobile lives inside `Trip Planner Redesign.dc.html`, selected by the `surface` prop. It reads
the same trip, the same focused day, the same tag filter and the same edit-sheet state as the
desktop; its only own state is which tab is showing. A new phone screen is a new layout over
existing state — if it needs state the desktop does not have, that is the signal to ask
whether the desktop needs it too.

### The tab bar is the router

Trips = home; Plan / Map / Notebook = inside a trip. "Trips" is **not** a storable tab value —
the route alone says whether the list is showing, so no handler can desync them. The phone
must never hold tab state that can disagree with the route — a Plan screen outside a trip has no focused day and
renders an empty itinerary under a header that still counts stops.

### Mobile is a variant layer

Mobile is not a separate design system and must not become one. Where a phone pattern has a
desktop counterpart doing the same job, it is the same component at a different density —
see `DS-UPSTREAM.md` **U6** for the five patterns currently inline and the variants
proposed for them. The two layouts are picked explicitly, not by media query: mobile scope
(§10) makes them different screens, not one responsive screen.

### Still open on mobile

- **Day 6's stop list is not yet the desktop's.** The three cards on the Plan screen use
  the right city and the right day, but their times, order and one stop's estimate
  treatment predate the seed data. Reconcile against `TRIPS.japan.days[5]` next pass.
- **Derived values must be derived, not typed.** The next-trip countdown was three
  contradictory hardcoded strings across two files before it was caught. Any number that
  restates something else on screen — a countdown, a day count, a total — is computed in the
  logic class from one constant, never written into the template.
- The phone's **Map tab has an offline state** (tiles fail → titled panel, stops-still-readable
  message, Try again + Open Plan). The phone still has no **conflict** state, and no
  sync-fail state outside the map (project rule 6).
- **Notebook on the phone** reads the focused day only. The full macro document (templates,
  inline + block macros) has no phone treatment yet.
  Desktop reuses `ConflictBanner`; mobile needs the equivalent decided.


---

## 14. The landing page — 2026-08-26

Reached by the design file's `startScreen: landing`. It is the unauthenticated front
door and replaces the bare heading `app/page.tsx` renders today (DRIFT D2/D8).

### It runs on nothing

**No session, no fetch, no backend.** Every value on the page is a hardcoded marketing
fixture that lives in the marketing route itself — *not* imported from
`japan-trip-seed.json` or the seed importer. It looks like the product; it is not
connected to it. A data-model change must never be able to break the front door, and the
page must render identically to a signed-out visitor with the API down. It therefore has
no empty, offline or conflict state, and project rule 6 is satisfied trivially.

### Structure

1. **Rotating hero** — three views of a Japan trip (Day 5 Notebook, Day 6 Map, Day 7
   Timeline) on a 10s cycle. Full-bleed map with plan details to the right. Day pills
   read only "Day 5", no view labels; clicking one jumps to it and restarts the timer.
   Decorative SVG layers are `pointer-events: none` so the pills stay clickable — the
   same trap exists in any real implementation.
2. **Three equal-height blocks, flush to the card bottoms** —
   *Together*: a live timeline with Priya's lifted stop, Dana's comment thread, travel
   gaps. *Notebook*: prose with an inline, borderless, doc-style cost table
   (activity / who / cost; Day 6 total $596) — a table, not a card, because the point is
   that the notebook and the plan are one surface. *Playbooks*: a borrowed Phuket beach
   day, 4.8★, "Shared 214 times", dropping in as Day 2 of a calendar strip between
   jungle days.

### Copy rules

- **No "free", no "open source", no "no credit card".** Caesura is a product for groups,
  not a tool. The only footnote is **Early access**.
- No trailing explanatory captions on the example blocks ("was Day 2", "the trek
  slides…"). The examples carry themselves.

### Advertising ahead of the build is intended

The Notebook and Playbooks blocks show functionality the build has not finished — macro
values (§7, contradicted by `templates.ts`) and playbook sharing (three Preview shells).
**This is deliberate and is not drift.** A landing page states direction. Do not gate it
on those, and do not reduce it to what ships today. The line it must not cross is a claim
the product will never honour; the copy makes none.


---

## 15. Playbooks becomes a public library — 2026-08-30

Four routes, three of them new: `playbooks` (Discover), `day` (a shared day), `board`
(leaderboard) and `profile` (public profile). **None of this exists in code.**
`playbooks-route`, `insert-playbook` and `add-saved-day` were already `<Preview>` shells;
this section widens what they owe. DRIFT §2b lists the fields a build needs first.

### Discover: city search is server-side

The old `<option>` city dropdown is **gone and must not come back**. A debounced input
queries a 30-city index (region + day count) with ~240–440 ms simulated latency, and the
design asserts a `GET /cities?q=` style endpoint that does not exist yet. Four real states:
loading spinner, results, "no city matches", and a failure state wired to `syncOff` with
**Retry**.

**A day matches on *any* city it contains.** Days carry `cities: string[]`; a Kyoto query
returns the Uji day with the matched city filled and the rest outlined, plus a per-card
line ("Kyoto matched · also Uji"). Ranking is matched-city count first, then the chosen
sort. There is **no multi-city field in the contract** — this is the largest blocker on the
list, bigger than the missing `tags` (KI-47).

**Sibling chips** surface cities present in the current result set but absent from the
query, with counts, one tap to add. An empty query shows a "busy right now" city row
instead.

**Filters, four only** — rating floor, month it was run, budget per person, and sort (most
added / highest rated / most reviewed / newest). `Everyone / Yours / Saved` is a **scope
segment**: your own library is a filter on this page, not a second page (R5). States:
skeleton grid while fetching, an `EmptyState` offering *Drop the filters* / *Search
everywhere*, and an offline banner saying ratings are stale.

### Shared day (route `day`)

Full stop list with per-stop notes and city chips; author strip (name, days shared, how
often their days were added); sticky rail with the rating, a 5→1 histogram, the facts
(stops, window, budget each, month, adds) and **Add to a trip** → the *existing* insert
dialog, not a new one.

**Reviews are stars plus one optional line, capped at 140 characters.** Anyone signed in,
no gate; posting recomputes the average live. Three states present: empty ("nobody has
rated this yet"), offline (held on device, badged *Queued*) and conflict ("Mei changed
this day two days ago").

### Leaderboard (route `board`)

**Ranks on real-trip adds only** — not ratings, not post volume. The page states the rule
in copy: *an add only counts once per trip, and only after the trip has dates; copying
your own day into your own trip does not count.* That rule is the whole credibility of the
ranking — **a build that counts raw inserts will produce a different and gameable order.**
It needs an adds ledger keyed by (day, trip).

Your own row is tinted and badged, never pinned to the top. **Not in the top bar** — it is
trip-independent but not account scope, so it is entered from Discover ("Who shares the
most"), per R1. Offline shows a stale-ranking banner; there is no empty state, because the
board cannot be empty while any day is shared.

### Public profiles (route `profile`)

**Derived, never authored.** Every number — adds, days shared, average rating, reviews
received, cities known — is computed from that person's days, so a profile can never
disagree with Discover. No bio, no follow, no avatar upload: a profile answers "is this
person worth taking a day from" and nothing else. **A public user record is not needed.**

"Knows" city chips run a Discover search scoped to that city, so a profile is a way into
the library rather than a dead end. Back links are contextual — the profile returns to
day, board or Discover depending on where you came from, because the same page is
reachable three ways.

### Until the reviews table exists, every rating here is fixture data.
