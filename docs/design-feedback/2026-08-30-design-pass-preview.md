# Design pass — 2026-08-30 (live preview)

Findings from a design pass run by hand against PR #98's Vercel preview,
reported through the Vercel toolbar (which anchors each comment to the element
and route it was written on) and recorded here as they were worked.

Seventeen threads. Sixteen are fixed on this branch; one is open pending a
repro.

## How this pass was run

- Surface: the Vercel preview built from this PR, walked at 1728×836 in
  Chrome on macOS.
- Verification of each fix: a local **production build** (`next build` +
  `next start`), not `pnpm dev`. The preview itself is behind Vercel
  Authentication and a bot checkpoint, so it cannot be driven from a cloud
  session without `VERCEL_AUTOMATION_BYPASS_SECRET` — see
  `docs/guidelines/cloud-agent-sessions.md` and `scripts/walk-preview.mjs`.
- `apps/web/src/lib/preview-registry.ts` remains the authoritative list of
  deliberately unbuilt surfaces. Nothing in it is reported here.

## Findings

| # | Route / surface | What's wrong | Outcome |
| - | --------------- | ------------ | ------- |
| 1 | `/signin` — dev-login form | Enter appeared to do nothing | Fixed |
| 2 | Trip meta pill | "N travellers" text is noise beside the avatars | Fixed |
| 3 | Money settings + new-trip wizard | Over-budget hint copy not needed | Fixed |
| 4 | Unscheduled rack | "Show"/"Hide" redundant; bar doesn't read as clickable | Fixed |
| 5 | Day chips | Stop dots misaligned on travel days | Fixed |
| 6 | Day columns | Last card sits flush under the Unscheduled bar | Fixed |
| 7 | Calendar cell | Date and "Day N" waste a line | Fixed |
| 8 | Map lens | Gap under the map; whole page scrolls | Fixed |
| 9 | Map lens | MapLibre attribution sits under the assistant button | Fixed |
| 10 | Map lens | Travel legs should be dotted, not solid | Fixed |
| 11 | Activity location | Full geocoded address shown everywhere | Fixed |
| 12 | Trip board (default lens) | Can scroll far past the bottom, intermittently | **Open — needs a repro** |
| 13 | `/welcome` hero art | Fake map should read as Kyoto | **Proposal — needs a decision** |
| 14 | Trip header badges (446px) | Two-word badges wrap mid-label | Fixed |
| 15 | Map lens (411px) | Broken on a phone: legend, day rail, scrolling | Fixed |

### 1 — Enter in the dev-login field looked inert (and ate the input)

Enter did submit, but only after React had hydrated. Before that the form is
server-rendered HTML with no `action`, so Enter fired the browser's native
implicit submission: a GET back to `/signin` that reloaded the page, emptied
the controlled username input, and wrote what had been typed into the address
bar as `?username=…` — and so into history, the referrer and server logs. The
window is widest on a cold preview, which is where the pass was being run.

Fixed by gating the submit button on hydration: HTML's implicit submission
does nothing when a form's default button is disabled.

| | before | after |
| - | ------ | ----- |
| JS off, Enter | `/signin?username=alice`, field emptied | `/signin`, field keeps `alice` |
| Hydrated, Enter | signs in | signs in |

Guarded by two tests in `apps/web/e2e/m15-front-door.spec.ts`.

### 2 — "N travellers" beside the avatars

Dropped. The stacked avatars already say who is on the trip. The control
stays — it is how the pill opens Trip settings — with the count as its
`aria-label`, now correctly singular for a solo trip ("1 traveller", which
the visible text had wrong anyway). The last avatar's stacking margin needed
cancelling once the text was no longer there to absorb it.

### 17 — The ownership tile

> "Can we drop this ownership tile all togther? DA?"

The pill's stacked member avatars, which also doubled as a third way into Trip
settings. The "DA?" is Mitchell reading a member's initials and not knowing
what they were for, which is the argument in one word.

Gone entirely — this is the second pass over the same control. Finding 2
dropped the "N travellers" text beside the avatars and kept the avatars as the
control; this drops the control. The pill answers *what this trip is* (dates,
days, stops, cities); *who is on it* is a different question, answered
properly by Trip settings' Travellers panel rather than by two grey initials.

Nothing is stranded: Trip settings had three entrances and keeps two — the
trip title, and the header's own ghost "Trip settings" button.

### 3 — "Used for the over-budget warning across lenses."

Dropped from Trip settings *and* from the new-trip wizard, which carried the
identical sentence. Removing only the one that was pointed at would have left
the copy alive on the other screen.

### 4 — Unscheduled rack toggle

The "Show"/"Hide" word said what the caret already says, in 11.5px grey, and
the bar still did not read as clickable. Replaced with contrast rather than
copy: caret and label go from `text-slate` to `text-ink` and the caret is a
size up, so the row reads as a control at rest instead of only on hover.
`aria-expanded` already carried the state the word carried.

### 5 — Day-chip stop dots

The city line collapses to zero height on a travel day (the city moves to the
transition line), so a travel chip's dots sat a line above its neighbours'.
The chips are flex siblings in a stretch row and already share a height, so
pinning the dot row to the bottom (`mt-auto`) fixes it without reserving
height for a line that is deliberately empty.

### 6 — Cards flush under the Unscheduled bar

The rack is `position: fixed`, so it reserves no space in flow, and the
board's 24px bottom padding was measured against the viewport rather than
against the bar sitting on top of it. The rack's height is already measured
(the assistant launcher's offset reads it); it now also feeds
`.trip-board-content`'s padding as a custom property, so the gap is 24px
*above the bar* and tracks the rack opening and closing.

### 7 — Calendar cell date and day on one line

Now one line, date left and "Day N" right, with the date as an ordinal
("14th"). This reverses an earlier two-line change, deliberately: that one
was made because a bare number butted against "Day N" read as one
run-together number ("8Day 1"). The ordinal suffix and the full cell width
between them remove that reason. No separator glyph — the cell already spends
"·" on city/time and "–" on the time range — which is also dc.html:668's own
layout, so this returns to the handoff.

### 8 — Map lens: gap under the map, and page scroll

The canvas was a flat `70vh`, which left a strip of page under the map on a
tall window and pushed the document just past one viewport on a short one.
It is now sized to exactly the viewport left below the header and above the
rack, measured (the header's height is not a constant — the chips wrap, the
header grows a line at narrow widths) and expressed as
`calc(100dvh - <measured top> - var(--rack-height))`.

### 9 — MapLibre attribution under the assistant button

The assistant launcher is `position: fixed` in the viewport's bottom-right and
the Map lens is full-bleed, so it is the same corner MapLibre puts its
attribution in. Being a fixed element over a canvas, the pill made the
attribution links unclickable, not merely untidy. The attribution now clears
the pill's footprint, and the reservation is dropped when the assistant rail
is open, because the pill only exists while the rail is closed.

### 10 — Travel legs dotted

A day's route was one solid polyline. It is now split into two layers per day
— ordinary legs and legs that touch a `transit` stop, the latter dashed.
Two layers rather than one tagged feature because MapLibre's `line-dasharray`
is a plain paint property and takes no data-driven expression.

**A judgement call worth confirming:** a leg counts as travel when *either*
end is a transit stop, not just the one it arrives at. A "Train to Kyoto" stop
is the movement itself, so the hop that reaches it and the hop that leaves it
both belong to it; dashing only one side left a solid half-leg hanging off
every train. Say so if you want only the arriving leg dashed.

### 11 — Too much address in the UI

`location.name` is the geocoder's full label — "National Museum of Play at The
Strong, Rochester, Monroe County, New York, 14607, USA" — and four surfaces
rendered it whole: the activity card, the editor sheet, the shared-trip view,
and the location picker's selected value (the one that was flagged).

A new `displayPlace()` (`apps/web/src/lib/place.ts`) renders venue, city and
country instead: "National Museum of Play at The Strong, Rochester, United
States". The country comes from `countryCode` through `Intl.DisplayNames`, so
it reads "Japan" rather than "JP". It is distinct from the existing
`shortPlace()`, which is the *one-token* whereabouts label a timeline route
line needs.

The geocoder **results list** deliberately still shows the full label: it is a
disambiguation surface, and two nearby matches can shorten to the same string.

### 12 — Scrolling far past the bottom (open)

> "I was able to scroll way past the bottom, not sure how, its not a always
> thing"

Reported on the default lens, anchored to `<html>`. Not reproduced. The map
lens had its own page-scroll problem (finding 8) and that one is fixed, but
this was a different route, and "not always" points at something transient
rather than at static layout.

The likeliest candidate is a drag: pragmatic-drag-and-drop appends a drag
preview to `<body>`, which can extend document height while a drag is in
flight. That is a guess, and it is recorded as one.

**Needs:** which lens, and what you had just done — in particular whether a
drag had happened on that page.

### 13 — A Kyoto-shaped hero map

> "Could we create a more real 'Fake' Map background that better reflects
> Kyoto? It has a very iconic city style, and this just looks like a random
> river. Still keep this stripped down esthetic though"

Three directions were put to Mitchell — the street grid, the river and hills,
or landmark silhouettes. He took the grid first, then corrected the whole
premise after seeing it: *"more what i meant as iconic section in kyoto thats
recognizable — the river with the bridges."* He sent an illustrated tourist map
as a reference for the idea and said explicitly it was not the style he
wanted.

That correction is the useful part of this entry. A city-wide lattice is an
abstraction of *anywhere gridded*; what is recognisable is a **place**. So the
second version zooms in on one — the Kamo through central Kyoto, the Takase
canal a block west, three bridges at the big cross streets, and the grid
stopping dead at both banks.

The bridges are the load-bearing detail. A street that simply runs across a
river reads as a line drawn over a line; one that stops at the bank everywhere
*except* where a heavier bar carries it over is what makes water look like
water. That is why the cross streets are drawn as two segments with explicit
endpoints rather than as full-width lines.

Three things the screenshots caught in that second version, none of which
reasoning would have: the river at 7 units was a flat pale column and needed
banks to read as a river at all; the bridges at `border-strong` came out
*lighter* than the water, so they read as three gaps rather than three
crossings; and the Takase at `info-tint` and 0.6 units was simply invisible.

The first version's history is kept below because its two measurement traps
still apply to anything edited in this SVG.

The diagnosis was as useful as the ask. The thing being complained about was
**not** in `LandingHeroArt` — that component draws the route and pins. It was
`LandingScreen`'s own section-wide backdrop: six lines, every one of them
skewed slightly off-axis (`M-6 30 L 166 24`), plus one 4.4-unit curve. Skew is
what made it read as random, and a lone meandering curve on an otherwise empty
ground can only be a river. A first attempt that added a grid inside
`LandingHeroArt` was thrown away for this reason: it produced two grids and
two rivers, which is worse than one of each.

What replaced it, all in `LandingScreen.tsx`:

- A **strictly orthogonal lattice** at 10-unit spacing. Heian-kyō was laid out
  on a Chinese-style grid in 794 and the modern city still follows it, which
  is unusual enough among Japanese cities to carry the identity alone. The
  straightness *is* the point — it is the one thing the old art got wrong.
- **Four arterials** a weight heavier, so the lattice has a hierarchy rather
  than being uniform ruling.
- **The Kamo**, leaning south-west, the only element allowed to ignore the
  grid.
- **Two Higashiyama contours** east of the river.
- **Plots aligned to the grid** instead of free-floating, so they read as city
  blocks rather than stray rectangles.

Two things the screenshots caught that reasoning alone did not:

1. `preserveAspectRatio="xMidYMid slice"` **crops** rather than stretches, and
   at 402×1014 the visible band is only x 60–100 of a 160-wide box. The first
   placement put the river and ridge at x 113–152, so a phone got a bare
   lattice with no Kyoto in it at all. They moved inward.
2. `slice` scales user units by the larger axis ratio — ~9× on a desktop hero
   but ~10× on a tall phone, which is a quarter the width. The river went from
   1.4% of the screen to 5.5% and turned back into the band it was replacing.
   It is now `vectorEffect="non-scaling-stroke"` at a flat 9px. The grid keeps
   user units deliberately: hairlines pinned to 1px would vanish on desktop.

Verified by screenshot at 1440×900 and 402×844, and the four responsive tests
that pin the hero (no overflow at 320/375/402px, map labels kept at desktop
width) still pass.

### 14 — Badges wrapping mid-label on a phone

> "dont use two words when one will do, word wraps cause issues. Readonly, I
> don't like these tags double lines on small screens"

Two changes, because the report has two halves. The copy: "View only" is now
**"Viewer"** — one word, and it names the role the badge stands in for, in the
same word the invite flow and TravelersPanel already use. The mechanism: a
badge is a chip, and a chip that breaks across two lines reads as broken
layout, so `Badge` is now `whitespace-nowrap` — every badge, not just this
one. The row that holds them wraps as whole items instead.

One trap this sprang, worth recording: `m11-invites.spec.ts` names its own
fixture trip "Viewer", so a substring match on the badge's new copy also
matched the trip heading and the assertion stopped being about the badge. The
locators are `exact` now.

### 15 — The Map lens on a phone

> "map view pretty broken on mobile, maybe remove legend on mobile, and figure
> out a different static location for the days, have less info and make that
> where you scroll so map jumping still works"

Reported at 411×760. A mobile layout for the Map lens rather than a fix: three
overlays (rail, focus card, legend) are all positioned for a desktop canvas,
and the 268px rail is both the day list and the scroll surface that drives map
jumping, so it could not simply be hidden. Two shapes were put to Mitchell —
a horizontal chip strip, or a peek-height bottom sheet — and he chose the
**strip**.

Below 768px the Map lens now mounts `MapDayStrip` in place of all three:

- **Days** are a horizontal chip strip pinned to the top of the canvas, the
  same idiom `DayChips` uses everywhere else, so there is one thing to learn
  rather than two. Focus is by **tap**, not scroll position — the rail's
  gearing exists to make a deliberate landing possible while scrubbing a
  vertical list, and scroll-driven focus on a horizontal strip would fight the
  sideways scroll needed to reach day 14.
- **The focus card** is gone; its one line of detail (stop count, distance, or
  the empty/unlocated note) moves under the strip, for the focused day only.
  Its height is reserved rather than conditional, so focusing a day does not
  shove the map down by a line.
- **The legend** is dropped outright. It is a key for colours the chips
  already carry, and it was the one overlay that cost canvas and returned
  nothing.
- **The camera's clearance** moves with the control: the rail's 284px of left
  padding would be two thirds of a 411px screen, so on a phone `fitBounds`
  reserves the strip's height at the top and a plain 24px on the other three
  sides.

Mounted by branch (`useIsPhone`, a JS media query) rather than hidden with
CSS, because the rail runs a ResizeObserver and a scroll listener over real
DOM — rendering it and hiding it would leave that machinery live against a
zero-height box.

**Guarded by:** four unit tests in `MapLens.test.tsx` (the swap in both
directions, the detail line, and the camera padding) and two e2e tests in
`responsive.spec.ts` at Mitchell's own 411px and at 1280px. The e2e also
asserts the document does not scroll at phone width, since the strip is a
control *on* the map, not a band the page scrolls past.

## Review findings on the pass itself

CodeRabbit reviewed the branch once it left draft and found two real defects in
the fixes above. Both were mine and both are fixed:

- **The Map lens attribution offset was keyed on the wrong predicate.**
  Finding 9 reserves 158px of canvas for the assistant launcher. It keyed that
  on the *absence* of `.assistant-open`, but the launcher renders under
  `!isDemo && !assistant.open` — so `/demo`, which never renders a launcher,
  still got 158px of gap in front of nothing. TripBoardScreen now sets an
  `assistant-launcher` class under exactly the render condition, and the CSS
  keys on that.
- **Route layers went stale on a kind-only change.** Finding 10 splits a day's
  route into solid and dashed layers by reading each stop's `kind`, but the
  map-creation effect keyed on pins alone (`activityId:lat:lng`). Flipping a
  stop to `transit` without moving it left the layers untouched and the leg
  stayed solid. The key now covers each day's stops in order and with their
  kind — order too, since legs are consecutive pairs and a reorder changes
  which legs exist without changing any coordinate.

Worth recording how the second one was verified, because the first attempt at
its regression test was worthless: it handed `rerender` a fresh `vi.fn()` for
`onSelectActivity`, which is itself a dependency of that effect, so the effect
re-ran for that reason and the test passed against the exact bug it existed to
catch. Running it against the pre-fix code is what exposed that. It now uses
one stable callback, and fails on the old key.

A third finding — move `@tc/contracts` imports out of the component layer —
was declined. The repo's lint wall bans `@tc/domain` and `@/server/*` from UI
and deliberately permits `@tc/contracts`, which is the shared type layer the UI
is meant to read; `MapLens` imported it before this PR and so does most of
`components/`. Acting on it would be a repo-wide architecture change, not a
review fix.

## What this pass did not cover

Only the routes reached in one sitting: `/signin`, `/welcome`, and the trip
board's Schedule/Timeline, Schedule/Calendar and Map views. Untouched: the
Money and Places lenses, Playbooks, Trip settings beyond the budget row, the
new-trip wizard beyond the same row, invites and sharing, and every mobile
viewport.
