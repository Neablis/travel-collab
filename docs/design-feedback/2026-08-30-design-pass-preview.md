# Design pass — 2026-08-30 (live preview)

Findings from a design pass run by hand against PR #98's Vercel preview,
reported through the Vercel toolbar (which anchors each comment to the element
and route it was written on) and recorded here as they were worked.

Thirteen threads, twelve of them from one sitting. Ten are fixed on this
branch; one is open pending a repro; two are proposals waiting on a decision.

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

### 13 — A Kyoto-shaped hero map (proposal)

> "Could we create a more real 'Fake' Map background that better reflects
> Kyoto? It has a very iconic city style, and this just looks like a random
> river. Still keep this stripped down esthetic though"

Real design work rather than a defect, and the one item here that should not
be done unilaterally — "iconic Kyoto" has several defensible readings and the
current art is a deliberate stripped-back abstraction that the responsive
suite pins at four widths. Waiting on a direction.

## What this pass did not cover

Only the routes reached in one sitting: `/signin`, `/welcome`, and the trip
board's Schedule/Timeline, Schedule/Calendar and Map views. Untouched: the
Money and Places lenses, Playbooks, Trip settings beyond the budget row, the
new-trip wizard beyond the same row, invites and sharing, and every mobile
viewport.
