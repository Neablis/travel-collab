# M10 redesign — external review against the Trip Planner handoff (2026-08-14)

**Reviewer:** external pass, no prior involvement in M10's implementation.
**Under review:** [PR #23](https://github.com/Neablis/travel-collab/pull/23),
branch `claude/m10-trip-planner-visual-7bbacf` @ `6f06cc1`.
**Reviewed against:** `~/Downloads/design_handoff_trip_planner/` —
`README.md` (written handoff) and `Trip Planner Redesign.dc.html` (1,412-line
prototype), plus `docs/specs/2026-08-08-M10-redesign-incorporation-design.md`
(what M10 said it would build) and ADR-018.

**Method:** read the handoff and the prototype's own logic (`buildDays`,
`accent`, `celebrate`, `shapeOf`), read every changed component on the branch,
then ran the branch's dev server against a seeded local DB (`db-seed.mjs`,
"[Seed] Rochester to Niagara", 4 days / 2 cities / one empty day) and inspected
the live DOM at 1280 and 1100 px. Every measurement below is from the running
app, not inferred from source.

---

## 0. What I treated as decided, not drift

Three things differ from the handoff on purpose. I did not count any of them as
findings, and the plan that follows should preserve them:

1. **Under-construction marking.** `Preview` renders two treatments —
   `size="compact"` puts a small construction-icon badge on a control,
   `size="container"` puts a dotted border plus a `Preview · M9/M11` chip around
   a region. That is the intended visual language. *(One execution caveat under
   finding 14 — the badges currently land on top of real content.)*
2. **The right rail is today's AI chat, relocated.** The rail header, context
   line and Ask box are real (`composeAiPlan`); only the proactive half — the
   "What I noticed" suggestion cards and the quick-ask chips — is a Preview for
   M9. Matches the handoff's rail minus the pre-generated content.
3. **Per-city colour is a short repeating cycle.** `dayAccentFor` hashes the
   city into five design-system families (`brand`/`info`/`success`/`warning`/
   `danger`) instead of the prototype's ten OKLCH hue buckets. Accepted — with
   two consequences worth an explicit decision, listed under finding 19.

Also worth saying plainly: **`/playbooks`, the home Playbooks strip, "Worth your
attention", the ghost proposal and the timeline day-header block are good.**
They were built from the handoff rather than retrofitted onto an existing
surface, and they read as the design intends. The problems below cluster almost
entirely in the surfaces that already existed before M10.

---

## Tier 0 — Functional breakage

These are not styling gaps. They make the product unusable in ordinary
conditions and should be fixed before any further visual work lands.

### 1. The assistant scrim kills the entire trip page below 1180 px

`AssistantRail` always renders `<div aria-hidden className="assistant-rail-scrim
fixed inset-0 z-40 bg-ink/32" />`. `globals.css` sets that class to
`display: none` by default and `display: block` at `max-width: 1179px`. It has
`pointer-events: auto` and **no click handler**.

Measured at 1100 × 800 on `/trips/{id}`:

```
document.elementFromPoint(200, 500) → div.assistant-rail-scrim   (a day column)
document.elementFromPoint(150, 180) → div.assistant-rail-scrim   (the day chips)
```

Clicking the "Timeline" tab at that width does nothing — the view stays on Day
columns. Every control on the trip page (tabs, day chips, activity cards, Add
stop, edit, remove, drag and drop) is dead on any viewport under 1180 px unless
the user first finds the Hide control. On a 13" laptop in a non-maximised
window this is the default experience.

In the prototype the scrim is `onClick={{ closeAsst }}` — clicking it dismisses
the rail. Here it dismisses nothing and blocks everything.

### 2. The Add-stop / edit-activity sheet renders underneath the rail

Measured at 1280 × 720, sheet open:

| element | x-range | z-index |
|---|---|---|
| `[role="dialog"]` (the sheet) | 640 → 1280 | `auto` |
| `aside[aria-label="Assistant"]` | 924 → 1280 | `50` |

356 of the sheet's 640 px — including its title and close button — sit behind
the rail. The form is usable only in its left half. This is the single most
common write action in the product.

### 3. Below 1180 px the rail covers real content

`.trip-board-content` reserves `padding-right: 356px` only at `min-width:
1180px`. Below that the rail is still `position: fixed` at full width, so the
backlog card, the "+ Add activity" button and the later day columns run
underneath it (visible at 1100 px). Combined with finding 1 the right ~356 px of
the trip page is both invisible and inert.

---

## Tier 1 — The surfaces called out for review

### 4. The tabs at the top of a trip

Three separate problems.

**a. The tab strip and day chips are not in the sticky header.** In the
prototype, one `position: sticky` container holds the trip head, the `TabStrip`
*and* the day-chips row. Here only `TripHeader` is sticky; `TripViewTabs` and
`DayChips` render after it inside a `PageContainer`. Measured at `scrollY 422`:

```
header      → sticky, top 0, height 147px      (title + toolbar)
tab strip   → static, top -274px               (scrolled away)
day chips   → static, top -236px               (scrolled away)
```

So 147 px of permanent chrome is spent on the trip name and a button cluster,
while the two rows you actually navigate with are gone the moment you scroll.

**b. Six views behind a three-view design.** The handoff has exactly three peer
views. `TripViewTabs` renders those three plus a "More" popover holding Map,
Itinerary, Daily overview and Full trip. The More button relabels itself to the
active lens, so on Map the tab strip shows no selection at all and the current
view is named inside a dropdown trigger. The redesign never contemplated the
other four lenses; M10's spec explicitly left `LensRouter` untouched. That was
the right call for a visual pass, but it leaves the primary navigation of the
product undesigned.

**c. The day chips lost their typography.** The handoff chip is four lines: 11 px
day-of-week in the day's ink colour, a 16 px mono date number beside a 10 px
city, a fixed 14 px transition slot, then 8 × 3 px stop dots. The implementation
collapses lines 1–2 into `text-xs` ink-coloured day-of-week plus a single
truncated `DataText` (`"5 Rochest…"`), so the chips read as grey boxes with a
clipped string rather than a date scale. The fixed transition slot and the dots
are correct.

**d.** The chips row renders on every lens including Map, where it has nothing
to drive.

### 5. The Map view

This is the one surface with **no design at all** — the handoff has no map, and
M10's redesign→milestone table doesn't list one. `MapLens` took a 9-line diff on
this branch (a `data-testid` and a class), so it is materially pre-M10 code.

What's on screen: a stock maplibre "liberty" basemap — blue water, orange
motorways, OSM label typography — inside a hairline rectangle, with identical
brand-green teardrop pins for every stop. No per-day accent on pins, no route
line, no stop ordering, no day filter, no companion list, no empty/loading
treatment matching the rest of the app. Beside the restyled Timeline it reads as
a different product embedded in an iframe.

*(The map itself works — my first screenshot caught it pre-tile-load; tiles
render fine. This is purely a design gap.)*

**Brief, per decision 1:** the map is *per day*, not the whole trip at once —
route lines connecting that day's stops in order so the distance between points
reads at a glance, and scrolling moves the map from day to day. That makes it a
consumer of the same focused-day state the day chips and Timeline already share
(`FocusProvider`), which is the one piece of plumbing M10 did build. Open
sub-questions for the plan: straight lines or routed geometry (we have no
routing provider; straight lines are honest and free), what a day with zero
located stops shows, and whether the basemap keeps maplibre's stock palette or
gets a muted style closer to the app's.

### 6. The add-event UI

The handoff's "Add a stop" Sheet:

> "What or where" field with a description and a suggested-places list ·
> a 3-up **Day / Start / How long** row · a success `Banner` with the
> slot-availability note · "Who is in" crew chips · Notes with a hint ·
> footer line "Booked? Attach a confirmation after saving." · Cancel /
> **Add stop**

What ships: the pre-M10 `ActivityEditor`, unchanged except for a small paper
note block added above it. A `Card` nested inside the `Sheet` (double surface,
off-pattern), sheet titled "New activity", fields **Activity title / Start time
/ End time / Place name / Cost / Notes**, buttons **Save / Cancel**.

Missing: the day selector (you cannot choose which day from the dialog), the
duration control (start+end instead), "who is in", the suggested-places list,
the availability `Banner`, the footer line, and the copy throughout. `Cost` is
an app concept the design has no slot for. This surface is effectively
untouched by the redesign.

### 7. Drag and drop

Drag exists **only in the Day-columns lens** (`pragmatic-drag-and-drop`;
`Column` is the drop target, `ActivityCard` the draggable). There is none in
Timeline — the default view, where you cannot reorder or re-day a stop at all —
none in Calendar (cells aren't drop targets), and none on the Map.

It also regressed during this branch's restyle and was patched rather than
fixed. `Board.tsx`'s own comment records the cause: the taller sticky header
plus the day-chips row pushed later columns below the fold, and an off-screen
column is not a valid drop target — *"here it overflows by ~145px"* on a 720 px
viewport. The fix (`autoScrollWindowForElements`) makes the page scroll during a
drag; it does not recover the vertical space. And below 1180 px finding 1 kills
drag entirely.

### 8. The assistant hidden view

Handoff: a brand-filled floating pill at `right: 22px; bottom: 22px` — ◎ mark,
"Assistant", and a suggestion-count badge, with `shadow-overlay`.

Implementation: a `secondary` Button welded to the right edge at 50 % height —
`fixed right-0 top-1/2 -translate-y-1/2 rounded-r-none border-r-0 px-2 py-3
text-xs`. A small white tab on a white page; over the map it is close to
invisible. No mark, no count.

Related: rail visibility is component-local `useState(true)` in
`TripBoardScreen`, so it doesn't persist across navigation, and the prototype's
"auto-hide below 1180 px, auto-restore above" behaviour isn't implemented.

### 9. Set-trip-info / trip settings

Also undesigned by the handoff, and also pre-M10 code. A gear icon opens
`SettingsSheet`: `TripDateControl`, then `TripMoneySettings`, then Duplicate and
Delete buttons stacked behind a hairline — no head, no grouping, no explanatory
copy, no relationship to the redesign's language.

The same gap shows in the header identity block. The handoff's mono meta row is
`dates · length · stops · travelers`; what renders is a bare start date
("Sat, Sep 5") next to a budget meter bar ("85.50 of 400.00 USD"). Trip length,
stop count and traveller count — all available — aren't shown.

---

## Tier 2 — Everything else I found

### 10. There is no global app header

The prototype has a persistent top bar on all three routes: ◎ Trip Planner mark,
Trips / Playbooks nav, "Quick add", "New trip", account avatar. `layout.tsx`
renders fonts and `{children}` and nothing else. Consequences: `/playbooks` is
reachable only from a secondary button on home, and once there **there is no way
back** — no nav, no logo, no breadcrumb.

### 11. Home page head and vertical rhythm

- No mono uppercase date line above `Heading level={1}` ("TUESDAY, AUGUST 4" in
  the design).
- No "All trips" section heading and no "3 trips · 1 shared with you" count
  line — the trips grid appears with no label.
- `main.mx-auto.max-w-6xl.px-6.py-8` with `mt-6` between sections, against the
  design's `PageContainer width="content"`, 30 px top / 60 px bottom, 34 px
  stack gaps. Everything reads ~30 % tighter than intended.

### 12. Next-trip hero

- Picks `visibleTrips[0]`, not the next trip by date (documented: `TripSummary`
  carries no start date). Live, the hero shows a stray one-day "test" trip while
  two real seeded trips sit below it.
- Meta line is "Created Aug 14, 2026" instead of `dates · length · cities`, and
  there is no "in N days" beside the Next-trip badge.
- No avatar stack — a single 20 px "DA" chip stands in for the design's
  overlapping 30 px circles plus the names line.
- Stat tiles are **travelers / days planning / need a decision** against the
  design's **stops planned / not booked / need a decision**. "need a decision"
  is hardcoded `"2"`.
- `label="travelers"` is never singularised: a solo trip reads **"1 travelers"**.

### 13. Trip cards

Accent bar, display name, mono line and state badge are right. Missing the 13 px
summary line entirely, and the mono line shows a creation date rather than the
trip's date range. With five accent families, two of three seeded trips drew the
same colour.

### 14. Preview badges collide with real content

The badge is deliberately hung outside the host's corner, but on small hosts it
still lands on the control: the construction icon covers part of the **Share**
and **Ask** button labels and the keep-day flag, and the `PREVIEW · M9` chip
sits on top of the third stat tile in the hero. Worth a rule — e.g. reserve a
gutter on compact hosts, or move the marking to a border/hatch treatment on
controls.

### 15. Timeline detail drift

- The day-header route line is built from full geocoded `location.name` strings,
  so row 2 renders as *"Ugly Duck Coffee, Rochester, NY, USA → The Strong
  National Museum of Play, Rochester, Monroe County, New York, USA"* and wraps
  onto its own line. The design's line is short area names
  ("Nakameguro → Toyosu → Tsukiji"). The same full string is used as the
  activity's place line. There is no "area" field to use — this needs either a
  shortening rule or a contract change, not a CSS fix.
- When the route wraps, "2 stops ·" is left with a dangling separator.
- Activity `Badge` covers conflicts only; the design's Booked / Holding / Idea /
  Travel states have no field behind them (see open question 5).
- The attributee shows the raw `userId` ("dev-alice").

### 16. Calendar

Close, but the tint is applied to the **whole cell** rather than the design's
inner rounded tinted button, cells fall short of the 116 px minimum, and the
mono "+N more" line only appears on some cells.

### 17. New trip is one field, not the wizard

A single-field Dialog against the handoff's 4-step Sheet (destination → dates →
who/pace/tags → review). Deliberately deferred because `CreateTrip` carries only
a name — a contract decision to make, not a styling task.

### 18. Day columns keeps app concepts the design has no slot for

A full-width **Backlog** strip with a full-width primary "+ Add activity" button
sits above the day row; each column has an **X** remove-day button; an "+ Add
day" button rides in the scroll row. Column headers lack the design's mono
`date · city` meta line and its ghost "Keep" control. None of these are wrong to
have — they have nowhere to live in the redesign.

### 19. The 5-colour accent cycle distributes badly in practice

The short cycle itself is accepted. The problem is *which* colour each city
lands on. `dayAccentFor(city)` is `djb2(city) % 5` over five families
(`brand`/`info`/`success`/`warning`/`danger`). Running the real function over
real city names:

| city | family |  | city | family |
|---|---|---|---|---|
| Tokyo | success | | New Orleans | brand |
| **Kyoto** | **danger** | | Naoshima | info |
| **Osaka** | **danger** | | Lisbon | danger |
| Nikkō | success | | Paris | danger |
| Rochester | warning | | Rome | info |
| Niagara Falls | danger | | Barcelona | danger |
| *(no city)* | info | | Portland | danger |

Of 13 city names, **seven land on `danger`**, three on `info`, two on
`success`, one on `brand` — `warning` gets one. djb2 mod 5 has almost no spread
on short strings. The consequence: the handoff's own headline trip, **Tokyo →
Kyoto → Osaka, renders Kyoto and Osaka in the same colour**, which is precisely
what the day-accent system exists to prevent. (The prototype used ten buckets
*with linear collision probing* for this reason — the probing matters more than
the bucket count.)

Two fixes, independent of how many colours we keep: probe forward on collision
within the trip's own set of cities (the prototype's `cityBuckets` approach,
~15 lines), and give "no city known" an explicit neutral instead of a hashed
family — today an empty day hashes `""` into `info` and renders bright blue,
visually claiming to be a city of its own (day 3 of the seeded trip).

### 20. There is no unscheduled/orphan rack in the handoff

Checked directly: the prototype contains no bottom bar, no unscheduled tray and
no backlog. Searching it for `unscheduled|backlog|rack|parking|unplanned`
returns exactly two hits, neither of them a surface — `'… unplanned'`, the
warning-tint gap pill inside a leg (`if (idle >= 150)`), and the word
"backtracking" inside a suggestion card's body text. The only bottom-docked
elements in the design are the assistant pill (`right: 22px; bottom: 22px`) and
the toast (`bottom: 26px`, centred).

So the app's Backlog has no home in the redesign, and a bottom rack for it would
be **net-new design**, not something to recover from the handoff.

---

## Addendum — the design moved twice; three of my findings are wrong

Mitchell supplied `~/Downloads/design_handoff_update/` after the review above was
written. It contains two newer versions of the prototype. Line counts and real
text diffs:

| version | lines | vs. previous |
|---|---|---|
| `design_handoff_trip_planner/` — **what M10 was built from** (cited in the M10 spec) | 1,412 | — |
| `design_handoff_update/previous/` | 2,048 | 688 changed lines |
| `design_handoff_update/current/` | 2,623 | +612 / −37 |

So there are **two** generations of design drift, not one. The update bundle's
own `AGENT-PROMPT.md` describes `previous/` as "the version our current
implementation was built from" — that is not right: PR #23 was built against the
1,412-line file, and the 688-line jump to `previous/` is design the branch never
saw.

**Corrections to the review above, in Mitchell's favour on all three:**

- **Finding 5 is wrong. The Map has a design.** It arrived in `previous/` — the
  generation PR #23 never saw. `data-r="mapwrap"` is a full-bleed map from the
  tabs down, with a 268px floating **day rail** card overlaying the left side
  (per-day accent spine, city, mono totals, proportional bars, warning flags),
  a focused-day info card at `left: 300px; bottom: 18px`, and a pill legend at
  bottom-right ("On foot" solid / "By train or taxi" dotted / "Rest of trip"
  grey). Rail scroll drives the focused day; the day-chips row is hidden in map
  view because the rail replaces it. Mitchell's answer to open question 1 was
  describing this design, not inventing a brief.
- **Finding 20 is wrong. The unscheduled rack exists.** It is in `current/` —
  `data-bldrop="1"`, a sticky bottom drawer present in every view: caret,
  Show/Hide, "Unscheduled", neutral count Badge, collapsed by default; open it
  is a horizontal row of 208px `Card`s (`p-3`) with title, area, provenance
  line, and a full-width "Add to day…" `NativeSelect`, with a dashed empty
  state — *"Nothing parked. Drag a stop down here to take it off the schedule
  without losing it."* It is both a drop target and a drag source. I told
  Mitchell he was misremembering; he was reading a newer file than I had.
- **Finding 9 is half wrong. Trip settings has a design now** — `current/` adds
  a Trip settings `Sheet` (name, read-only dates, budget total + currency, a
  Booked/Holds/Travel/Everything-else breakdown with an unpriced count and an
  over-budget `Banner`, and an invite list with roles and Remove; "Invite
  someone" is deliberately a stub). The header also gains a bordered budget chip
  and a bordered meta pill.

### What else is in the two deltas

*`1412 → previous` (never seen by PR #23):* the Map view and its rail/legend; the
timeline leg line stops inventing transit ("29 min · Metro") and instead shows
free time before the next stop ("1 h 15 m until next stop" / "Back to back")
with a "Nothing planned" warning pill at ≥2.5 h; the drag-and-drop target
highlight is removed (insertion line + floating time chip are the only feedback);
the helper text beside the view tabs is removed on every view; rail days no
longer grey out when inactive.

*`previous → current`:* the unscheduled rack; budget and per-stop costs
(including an `est` marker for unconfirmed amounts and "No cost yet" for ideas,
a per-day cost chip, cost on timeline and day-column cards, and a "planned of
budget" line on home trip cards); non-blocking overlap warnings with a
"Start 1 pm" fix action and per-pair dismissal; the Trip settings sheet; "Add a
saved day" moving out of the header into an end-of-timeline "End of the trip"
block and a trailing "One more day?" column; a real "Add a day"; empty-day
renderings in all four views; per-day "Add a stop after 9 pm" rows; and a Cost
field on Add-stop.

### The design's flagged data-model risks are mostly already satisfied here

`AGENT-PROMPT.md` asks us to flag data-model implications rather than guess.
Checked against `packages/contracts`:

| design needs | this codebase |
|---|---|
| cost per stop | **exists** — `ActivityView.cost: Money`, with `MoneyInput` in the editor |
| budget + currency per trip | **exists** — `trip.budget`, `trip.currency`, and a `BudgetMeter` component |
| unscheduled / parked stops | **exists** — `trip.backlog` |
| days that hold zero stops | **exists** |
| coordinates on stops (for map routes) | **exists** — `Location.lat/lng`, populated by LocationIQ geocoding |
| confirmed vs. estimate cost state | **missing** |
| "was on day N" provenance | **missing** |
| invited people with roles/names | **partial** — `TripMember` is `{ userId, role: "owner" }`: a role field exists but `"owner"` is its only value, and there is no display name |

Five of eight are already modelled. The design team could not have known that;
it materially shrinks the delta. Only the last three need decisions, and under
decision 5 below they are marked under construction rather than built.

**Two more found while writing the plan**, both of which shrink the work further:

- **`TripDetail.tripCostTotal` and `.budgetRemaining` already exist**
  (`packages/contracts/src/detail.ts:41-42`), summed and derived server-side. The
  budget chip, the settings breakdown and the home "planned of budget" line read
  them rather than re-summing — a second client-side sum could silently disagree
  with the figure the rest of the app trusts.
- **Finding 9's premise is obsolete.** The `current/` design gives Trip settings a
  real front door: the header actions are now ghost **Trip settings** · ghost
  **Share** · primary **Add stop**, with "Add a saved day" moved out of the header
  into the plan flow. Decision 2's "we simply have no front-door for them" no
  longer applies to settings — only the sheet's contents need rebuilding.

---

## Decisions (Mitchell, 2026-08-14)

The open questions this review raised, answered. These are binding for the plan.

1. **Map — brief given, and since matched to a real design** (see addendum): a
   day-by-day map with route lines between a day's stops, scroll moving the map
   between days, driven by the same focused-day model the day chips and Timeline
   already share via `FocusProvider`. The `previous/` bundle supplies the full
   treatment — floating day rail, focused-day card, legend.
   **Straight lines, not routed geometry** (decided 2026-08-14): LocationIQ's
   directions API does work on our existing key (probed: walking route returns
   GeoJSON geometry, 1342.1 m, 982.3 s), but it needs a server route, a cache
   and a rate-limit strategy — a behaviour change, not a UI pass. Deferred to
   its own scoped work, where it would also upgrade the timeline legs and gap
   warnings, not just the map.
2. **Trip info / settings — do not remove the capability.** If the redesign gives
   no entry point, the commands and components stay; we simply have no
   front-door for them until a later pass. Record the loss of reachability
   explicitly in `docs/known-issues.md` so it is a tracked gap, not a silent one.
3. **Unscheduled items — the rack is real and specified.** My finding 20 was
   wrong; see the addendum. Build it to `current/`'s `data-bldrop` spec, backed
   by the existing `trip.backlog`. This retires the full-width Backlog strip
   currently sitting above the day columns.
4. **Four tabs, not three and not six.** "Lens" is this repo's internal word for
   a view of the trip (`?lens=` / `LensRouter`); a lens is what a tab selects.
   The tab strip is **Timeline · Day columns · Calendar · Map**. The "More"
   popover goes. Itinerary, Daily overview and Full trip lose their nav entry;
   per decision 2 their code stays and their unreachability is recorded.
5. **Do not add backend fields to satisfy the design.** Where the UI shows
   something we have not modelled (activity status Booked/Holding/Idea/Travel,
   per-stop "who", a short area distinct from the full place name), render it
   marked under construction rather than adding a contract field. Revisit later
   if the functionality is actually wanted.
6. **New trip: keep `CreateTrip` at one field, but build the wizard.** All four
   steps get built; each field is either wired (if the data model already
   supports it and it is cheap — trip dates and budget/currency already have
   commands) or marked under construction.
7. **Accent palette:** five families, not three — my earlier phrasing was wrong
   and is corrected in finding 19. The real problem is distribution, not count.

---

## Suggested sequencing (for discussion, not a plan yet)

- **Now, regardless of anything else:** findings 1, 2, 3. They are bugs.
- **Then the cheap structural wins:** move the tab strip and day chips into the
  sticky header (4a), collapse the tabs to the agreed four (4b), the global app
  header (10), the assistant hidden pill (8), the Preview badge collisions (14),
  home rhythm and hero copy (11–13), the accent collision-probe and the neutral
  for "no city" (19).
- **Then the real work:** the add-stop sheet (6), the new-trip wizard (17), the
  day-by-day Map (5), drag and drop beyond the board (7).
- **Then the marked-incomplete pass** (decision 5): status badges, per-stop who,
  area line — under-construction treatments rather than contract changes.
- **Carried as known issues, not fixed here** (decision 2): trip settings has no
  designed entry point; Itinerary / Daily / Full-trip lenses are unreachable
  from the nav.
