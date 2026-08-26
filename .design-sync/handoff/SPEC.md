# Spec — what the design file cannot say out loud

Companion to `design/Trip Planner Redesign.dc.html` and `design/Trip Planner Mobile.dc.html`.
Current as of 2026-08-24.

## 1. Focus scope — the model behind the chrome

There is exactly one focus scope at any moment: **account → trip → day**. It decides what
the global header, the trip header and the assistant show. Nothing else should introduce a
competing notion of "current thing".

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

`design/Trip Planner Mobile.dc.html` is deliberately narrower in scope than the desktop
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
the map. Open R4 tension: Map now has day chips *and* the 268px side rail. They are not
identical (chips give trip-wide shape, the rail gives per-day detail), but if it reads as
duplication in use, slim the rail to route/distance and let the chips own day selection.

### Trip title is the way into trip settings

The rename pencil and the ⚙ button are both gone. The trip name + state badge are one
button that opens Trip settings, where the name field already lived. Hover gets a
`--color-moss` background so it reads as clickable.

### Still open

- **Calendar's future.** It survives this pass for one reason: it is the only dense,
  no-scroll read of trip shape (how many weekends you have). The retirement path is to put
  the month grid into the header day rail as an expand, so shape lives in one persistent
  strip. Not built.
- Tagging many-to-many table; Notebook repeater tag parameter; account-scope Notebook values.
