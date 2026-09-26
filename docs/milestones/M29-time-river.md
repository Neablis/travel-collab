# M29 — The time river

**Status:** Minted 2026-09-26 from Mitchell's asks in chat; **in flight beside M14, not
the current milestone** (M14 stays current — its open boxes wait on a person). Built as
four stacked PRs, plus a fifth for the phone. Decision record for part 1: **ADR-055**.

## Why this exists

The design handoff's latest pass redraws the stop editor and the Plan surface
(`.design-sync/handoff/SPEC.md` §36.9 and §36.9b; artboards in
`.design-sync/handoff/design/Trip Planner Redesign.dc.html` — the Add-a-stop sheet,
`kindChips` / `whyChips` / `modeChips`):

- **§36.9 — the Kind control.** A three-way segmented *Kind* (Planned · Pending ·
  Transit), then ONE second row: *By* (the seven modes) for Transit, *Why* (To book ·
  Maybe) for Pending. Card badges are one or two words and never wrap.
- **§36.9b — Plan is a time river.** Day columns drawn to scale on one shared axis, so
  mornings line up with mornings and free time is visible as empty space; how a block
  is drawn says how locked in it is.

Mitchell, 2026-09-26, on what to build from it:

> *"Add pending reason. It should be nearly identical as how travel has a type, and
> easily extendible."*

> *"I improved the kind selector for activities, it's not a tab list, it didn't get the
> travel type icon buttons over text though. I prefer the icon buttons so use that for
> both places it has a kind (travel and pending)."*

And on the design's *Booked* state: skip it for now — no booking fact exists to draw it
from.

## Scope — four stacked parts

1. **`pendingReason` and the Kind control** *(this PR)*. `PendingReason` (`book |
   maybe`) on the stop, legal only on `pending`, mirroring M24's `mode` in every
   consumer (ADR-055). The editor's Kind becomes a segmented control; its second row is
   an icon-radio row for both kinds that have one (`IconRadioGroup`, with
   `TravelModePicker` and `PendingReasonPicker` as thin wrappers). Badges *To book*
   (warning), *Maybe* (neutral), and a transit stop's mode. `needsBooking` unchanged.
2. **Plan columns become a to-scale time river** — read-only layout. One shared axis
   across the days (the trip's earliest start to latest end), **44 px an hour**. Block
   styles per kind: *planned* — surface with a 1.5 px edge in the day's city colour;
   *To book* — surface, dashed warning outline; *Maybe* — faint hatch and dashed outline,
   **never faded**; *transit* — info tint, dotted outline, mode and duration.
   Overlapping stops sit side by side in half-width lanes marked *OVERLAP*. Size
   thresholds: title only when short, time and area from 40 px, tags from 70 px. Untimed
   stops get a defined place rather than vanishing. **+ Add a stop** sits 22 px below the
   axis.
3. **Gestures.** Double-click empty time to add a stop there; drag across empty time to
   sketch one that long; drag a block's bottom edge to change when it ends; drag a block
   and the drop lands at the time under the pointer, previewed as an outline of the
   block's own length. **The drop rule is the same for every drag source** — a block on
   this day or another, a card off the "Any time" shelf, a stop off the Unscheduled
   rack. *Decided by Mitchell, 2026-09-26* (this closes the question the first cut of
   part 3 left open, where a rack stop kept the rack's fitted time and the river refused
   it): *"When dragging and dropping from anywhere, it should have same functionality of
   set the start time to where it's dropped, retain length it had, with a common sense
   default, 1h if no start/stop existed before."* So the start is the quarter hour under
   the drop (less the grab offset, for a block); a stop with a window keeps its length,
   one without gets an hour; the whole stop is kept between the axis's top and midnight;
   and a move to another day plus the new time is one batch, one undo. A drop that names
   no time — a card position, a column's gaps, the phone's list — keeps the rack's fitted
   time for an untimed parked stop (`rackDropWindow`). (A window always has both ends in
   the contract, so "only a start" cannot occur.)
4. **The seeded Overview, rewritten** — SPEC §36.10b as inspiration, not a copy.
5. **The phone gets the river** *(added 2026-09-26, after part 3)*. The phone's Plan
   day is the same `DayRiver` as a desktop column, and its four gestures get touch
   versions on any touch pointer. See *Part 5* below.

## Out of scope — written down so it is not assumed

- **Booked styling** (§36.9b's city-colour block, *BOOKED ✓*, the *Booked* badge): there
  is no booking fact to draw it from. Mitchell, 2026-09-26: *"skip it for now"*.
- **Implied transit** (§36.10) — the drawn *MOVING · Kyoto → Osaka* leg.
- **The co-edit conflict block** (§36.3's *Keep yours / Keep Mei's*).
- The other §36 items.
- **Changing `needsBooking`** so a *Maybe* stop stops counting as "to book" — a possible
  follow-up recorded in ADR-055, not part of this milestone unless Mitchell says so.

## Part 5 — the phone gets the river

Parts 2 and 3 left the phone on the stop-card list, because the design's phone Plan is
one (`phoneStops`) and SPEC §10 calls the phone a companion. It was an open question on
the part-3 PR. Mitchell, 2026-09-26:

> *"cards should get the river, we might need to think through the gestures, but keep
> functionality as similar as possible."*

So a phone's Plan day renders the same `DayRiver`, with the same layout, block styles
and colours, under the same "Any time" shelf, one day at a time as before
(`Column`/`Board`'s `oneDay`). Only a stop with no time is still a card.

**The gestures, mapped.** They follow the POINTER, not the width: any touch press gets
them (`pointerType === "touch"`, and `pointer-coarse:` for the grip's size), so a touch
tablet at its wide layout gets them too, and a mouse on a narrow window keeps the mouse's.

| Mouse (unchanged) | Touch |
|---|---|
| Double-click empty time | **Hold** empty time (450 ms) and let go: the same hour, in the add sheet. Two taps do nothing. |
| Drag across empty time | Hold empty time, **then drag**: the same sketch, the same 30-minute floor. |
| Drag the bottom-edge grip | Drag the grip at once, no hold. Under a coarse pointer it is a **44×44 target** reaching 10px below the edge (the bar stays 22×3), `touch-action: none`. A tap on it opens the stop, as a tap on the block does. |
| Drag a block (native HTML5 drag) | **Hold the block** until it lifts (half opacity, a shadow), then carry it: the outline is drawn on whichever river is under the finger, and letting go there is the same `resolveDrop` → `place` a mouse drop is (`RiverGestures.onDropAt`). Let go on the **rack** and it is parked. Let go anywhere else (header, tab bar) and nothing moves. |
| Click a block | **Tap** it. |

**Why a hold rather than a double-tap** for adding: the sketch needs a hold anyway, so
one gesture covers both; two taps are what a scrolling thumb does by accident; and a
phone browser reads a double-tap as zoom.

**Scrolling is the browser's until a hold fires.** A press that drifts more than 8px or
lifts before 450 ms is a swipe or a tap, and nothing about it is prevented. Once a hold
fires, a non-passive `touchmove` listener (registered for as long as the river is
editable, because the browser decides whether a touch sequence can be held when it
starts) cancels the page's scroll under the finger, and a held gesture near the top or
bottom of the visible river scrolls the page itself (`edgeScrollDelta`). "Visible" is
below the sticky header and above the rack and tab bar, read from the heights they
publish (`--sticky-stack-height`, `--rack-height`, `--phone-tab-bar-height`): on a
390×844 phone the header alone covers the top ~300px.

**What a touch cannot do the way a mouse does, and the path it keeps:**

- **Moving a stop to another day on a phone.** One day is on screen, so there is no
  other river to carry it to. The editor's **Day** field, as it was for the card list.
  (A touch tablet can carry it across; the rail cannot be a drop target without a
  second day to show.)
- **Unscheduling.** A mouse drops a block on the rack; so does a finger now. The
  native drag a long-press would start on a block is refused for touch, so only one of
  the two runs.
- **Exact times.** Snap is 15 minutes, as for the mouse; the editor's Start and End
  fields are still the way to say 10:10.
- **Keyboard and screen reader**: unchanged. Enter on a block opens the editor, whose
  End time is the keyboard's resize.

**SPEC §13.1's 44px floor on a to-scale block.** A block's height is its time, so a
30-minute stop is ~20px tall. On a phone the block's edit target keeps `buttonVariants`'
44px floor and reaches into the time below a short block (a later block paints above
that reach, so it only ever takes empty time), and Remove and Dismiss keep a 44px reach
on a 16px mark, as a tag chip does. `m26-phone-targets` measured the first phone build's
hour block at 40px, and that is what these fixed. **Cost:** a hold in the empty 24px
below a short block lifts that block rather than sketching.

## Exit gate

Part 1:

- [ ] **`pendingReason` is refused off `pending`** by the command unions, the decider
      (an update whose result would keep one) and the saved-day write path, each with a
      test **seen to fail** without the rule.
- [ ] **ADR-055 accepted**, `docs/contracts/CHANGELOG.md` carries the entry, the OpenAPI
      document is regenerated, and every consumer moved in the same change (invariant 5).
- [ ] **The Japan fixture exercises the field** (2 `book`, 6 `maybe`, read off the
      export) and `pnpm seed:verify` pins the counts.
- [ ] **[walk]** The stop editor shows a segmented Kind; choosing Pending shows the *To
      book* / *Maybe* icon row with *To book* chosen on a new stop; choosing Transit
      shows the mode icons; hovering an icon names it; clicking the chosen icon clears it.
- [ ] **[walk]** A card reads *To book* (amber), *Maybe* (neutral) or its mode, and no
      badge wraps at 390 px.

Part 2:

- [x] **[walk]** Plan draws every day on one shared axis at 44 px an hour: a 09:00 stop on
      Day 1 and on Day 5 sit at the same height. *Agent's walk, 2026-09-26, production
      build, `/demo?view=Plan` at 1440px: the top edge of all 14 rivers measured at the
      same y (168px), and each column ticks 6am–11pm; a column with an "Any time" shelf
      still starts its river level with its neighbours (subgrid rows). Unit:
      `board.test.tsx` "draws every day on the trip's one shared axis", seen to fail
      with the axis taken from Day 1 only (`Unable to find … 10pm`).*
- [x] **[walk]** Each block style is distinguishable at a glance — planned, To book,
      Maybe (hatched, not faded), transit (dotted, with mode and duration). *Agent's walk,
      same build, a trip carrying every kind: planned (1.5px city-colour edge), TO BOOK
      (dashed amber), MAYBE (hairline hatch, full-ink title), PENDING, and "Train ·
      Shinkansen … 2 h 15 m" (info tint, dotted). `DayRiver.test.tsx` names each kind,
      seen to fail with the To book tag and the transit title removed.*
- [x] **[walk]** Two overlapping stops sit in half-width lanes marked OVERLAP; an untimed
      stop is visible; *+ Add a stop* sits below the axis. *Agent's walk: the demo's Nezu
      Museum / Lunch at Kagari pair in half lanes, both OVERLAP; a three-way overlap in
      thirds; an untimed stop on the column's "Any time" shelf; + Add a stop under every
      axis. The phone keeps the stop-card list, as the design's phone Plan draws it.
      (Superseded 2026-09-26: the phone draws the river too — Part 5.)*
- [x] The layout (axis extent, lanes, thresholds) is a pure function with unit tests seen
      to fail. *`apps/web/src/components/board/riverLayout.ts` + `riverLayout.test.ts`;
      seen red under `pnpm redfirst` for the 24px minimum, the bottom clamp, the empty-trip
      fallback, lanes capped at two, lane reuse and the 40px threshold.*

Part 3:

- [x] **[walk]** Double-click empty time opens the add sheet at that time; dragging
      across empty time opens it with that start and length. *Agent's walk, 2026-09-26,
      production build (`test:e2e:ci-like`), Chromium at 1280×900, driven by
      `e2e/m29-time-river.spec.ts`: a double-click at 12:05 opened "Add a stop" with Start
      12:00 and the saved stop read "12 pm – 1 pm"; a drag from 1 pm drew a brand-edged
      ghost reading "1 pm – 3:30 pm" and opened the sheet at 13:00 with How long "2 h 30 m"
      (a drawn length none of the five options holds is offered as drawn, not rounded).
      Snap is the design's `SNAP = 15`; under 30 minutes a sketch opens nothing.*
- [x] **[walk]** Dragging a block's bottom edge changes its end; dragging a block drops
      it at the pointer's time, with an outline preview of its own length. *Same walk: the
      grip on an 8–9 am stop dragged to 10:30 stretched the block live, toasted "Now ends
      at 10:30 am" and survived a reload; a 4–5 pm block held by its middle and dragged
      onto the other day drew a "2 pm – 3 pm" outline and landed there, and ONE undo put
      it back on its own day at 4 pm (MoveActivity + UpdateActivity are one batch). ~~A stop
      off the Unscheduled rack keeps the rack's own rule (`rackDropWindow`) — the river
      refuses it as a target.~~ **Superseded 2026-09-26 (Mitchell, see Scope 3): a stop off
      the rack lands on the river by the same rule** — `riverGestures.placeWindow` for the
      window, `resolveDrop`'s `place` outcome for the commands, no per-source branch.
      `m29-time-river.spec.ts` drags a parked 9–11 am stop onto Day 2 at 1 pm and sees
      "1 pm – 3 pm", then one undo parks it again at 9–11; `m10-unscheduled-rack.spec.ts`
      drops an untimed parked stop at noon and sees "12 pm – 1 pm".*
- [x] Each gesture's command is asserted at the dispatch layer, and the e2e script walks
      one of them through `pnpm --filter web test:e2e:ci-like`. *`TripBoardScreen.test.tsx`:
      a sketch sends `AddActivity` with `{11:00, 13:15}`, a resize sends `UpdateActivity`
      with the new window; `DayRiver.test.tsx`: a double-click's window; `resolveDrop.test.ts`:
      a drop's `place` outcome and `placeCommands`' one batch. All four gestures walk in
      `m29-time-river.spec.ts` (12/12 with m1, m2, m10-rack on ci-like; the part-2 board
      set, 33/33). Every new test seen red — the e2e spec with the board's gestures
      withheld failed all four for its reason (no sheet, no ghost ×2, no grip).*

Part 4:

- [ ] **[walk]** A new trip's Overview reads as the rewritten page, built only from
      registry widgets.

Part 5 (the phone, and any touch pointer — see *Part 5* below):

- [x] **[walk]** A phone's Plan day is the river, not a card list: the same shelf, axis,
      block styles and colours as a desktop column, one day at a time, the rail changing
      which. *Agent's walk, 2026-09-26, production build (`test:e2e:ci-like`), Chromium
      `isMobile` + `hasTouch` at 390×844 and 411×852: the demo's Day 2 and a fresh trip
      drawn as rivers, the river ending with + Add a stop above the rack and tab bar when
      scrolled to the bottom. `board.test.tsx` "on a phone, draws the day's river and
      names every overlap on it", seen red with the river withheld on a phone (`Unable to
      find an element by: [data-testid="day-river"]`).*
- [x] **[walk]** Under a finger: a tap opens a block's editor; a hold on empty time, let
      go, adds an hour there; a held block carried to a new time lands there, and let go
      on the rack is parked; the grip is a 44px target that resizes; a plain swipe
      scrolls and creates nothing. *`m26-phone-plan.spec.ts` "M29 — the river on a phone",
      six tests, driven by a real Chromium touch sequence (`fingerOn`,
      `Input.dispatchTouchEvent`). Each seen red on a mutated production build, for its
      own reason: river withheld on a phone (all six: `day-river` count 0); hold never
      fires (`river-ghost` not found; `data-lifted` never set); grip's coarse size
      removed (`Expected: >= 44, Received: 22`); every touchmove cancelled (`scrollY
      Expected: > 285, Received: 185`); grip's `touch-none` and touch lock both removed
      (the breakfast block never reads *8 am – 10:30 am*); every river click swallowed
      (no *Edit activity* heading); the rack's `data-rack-drop` removed (the rack never
      reads *Unscheduled 1*).*
- [x] **[walk]** A touch tablet gets the same touch gestures at its wide layout: a held
      block is carried onto another day's river. *`m29-time-river.spec.ts` "on a touch
      tablet …", 1180×820, `pointer: coarse` asserted first. Seen red with the lift
      limited to its own river (`river-ghost` not found on Day 1) and with the hold
      disabled (`data-lifted` never set).*
- [x] Each touch path is asserted at the component layer, seen red. *`DayRiver.test.tsx`
      "under a finger" (6 tests): hold-and-release's hour, a double-tap is not an add,
      hold-and-drag's sketch, a pre-hold move is a scroll (its `touchmove` goes
      uncancelled; after a hold it is cancelled), a carried block's `onDropAt` window and
      the click its release must not also be, the rack landing, and the grip's tap vs
      drag. Thirteen mutations under `pnpm redfirst`, each red on an assertion (one first
      went red on a TypeError and was re-aimed until it failed one); e.g. the drift check
      disabled → `expected <div …river-ghost…> to be null`, the grab offset ignored →
      `expected '2:30 pm – 3:30 pm' to be '2 pm – 3 pm'`. `riverGestures.test.ts`:
      `edgeScrollDelta`, seen red with the bottom band disabled (`expected 0 to be greater
      than 0`).*
- [x] Keyboard and screen reader unchanged; a read-only river offers no touch gesture.
      *No keyboard path was touched; the read-only river binds no pointer handler at all,
      which the existing read-only test fails on.*

Whole milestone:

- [ ] `pnpm check`, `pnpm --filter web test:int`, `pnpm --filter web test:e2e:ci-like`
      (**never plain `test:e2e`**) and `pnpm seed:verify` green on the last part.
- [ ] A retro is appended at gate close.
