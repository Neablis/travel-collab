# M29 — The time river

**Status:** Minted 2026-09-26 from Mitchell's asks in chat; **in flight beside M14, not
the current milestone** (M14 stays current — its open boxes wait on a person). Built as
four stacked PRs, **all four merged by 2026-09-26** (#242, #244, #245, #243). Decision
record for part 1: **ADR-055**. What is left is walks and the gate-close items.

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

## Out of scope — written down so it is not assumed

- **Booked styling** (§36.9b's city-colour block, *BOOKED ✓*, the *Booked* badge): there
  is no booking fact to draw it from. Mitchell, 2026-09-26: *"skip it for now"*.
- **Implied transit** (§36.10) — the drawn *MOVING · Kyoto → Osaka* leg.
- **The co-edit conflict block** (§36.3's *Keep yours / Keep Mei's*).
- The other §36 items.
- **Changing `needsBooking`** so a *Maybe* stop stops counting as "to book" — a possible
  follow-up recorded in ADR-055, not part of this milestone unless Mitchell says so.

## Exit gate

Part 1:

- [x] **`pendingReason` is refused off `pending`** by the command unions, the decider
      (an update whose result would keep one) and the saved-day write path, each with a
      test **seen to fail** without the rule.
      *(Ticked 2026-09-27. Landed in `3ebdddd` (#242). Seen to fail with `pnpm redfirst`,
      one mutation per site, each restored and green again: filtering `pendingReason` out
      of `refuseKindDetailOffKind` in `packages/contracts/src/trip.ts` fails four
      `packages/contracts/test/adr055-pending-reason.test.ts` cases; the same filter in
      `saved.ts` fails *is refused on the saved-day write path too*; passing
      `pendingReason: null` to `kindDetailRejection` in `packages/domain/src/trip/decide.ts`
      fails *refuses a reason patched onto a stop that is not pending* (`expected { ok:
      true … } to match object { ok: false … }`).)*
- [x] **ADR-055 accepted**, `docs/contracts/CHANGELOG.md` carries the entry, the OpenAPI
      document is regenerated, and every consumer moved in the same change (invariant 5).
      *(Ticked 2026-09-27. ADR-055's status is *Accepted — 2026-09-26, Mitchell's decision,
      in chat*; `docs/contracts/CHANGELOG.md:49`; `openapi.json` carries `pendingReason`
      and `src/server/public-api/openapi.test.ts` — the drift check against the generated
      document — passes 4/4 on `33305d5`; consumers moved in `3ebdddd`, listed in its
      message.)*
- [x] **The Japan fixture exercises the field** (2 `book`, 6 `maybe`, read off the
      export) and `pnpm seed:verify` pins the counts.
      *(Ticked 2026-09-27. `packages/fixtures/src/japan/expectations.ts:65` pins
      `pendingReasons: { book: 2, maybe: 6 }`, counted in `verify.ts:228`; `pnpm
      seed:verify` 108/108 on `33305d5`.)*
- [x] **[walk]** The stop editor shows a segmented Kind; choosing Pending shows the *To
      book* / *Maybe* icon row with *To book* chosen on a new stop; choosing Transit
      shows the mode icons; hovering an icon names it; clicking the chosen icon clears it.
      *(Ticked 2026-09-27, walked in a browser as `e2e/m29-kind-control.spec.ts` › *the stop
      editor's Kind is segmented…*, on `test:e2e:ci-like` (a production build), 2 of 2
      green. The UI calls Transit **Travel**. "Names it" is the native `title` tooltip.
      Seen red three ways: a new stop defaulting to no reason (`aria-checked` `"false"`),
      `title` removed from `icon-radio-group.tsx` (`Received: ""`), and a second click
      keeping the choice (`Received: "true"`).)*
- [x] **[walk]** A card reads *To book* (amber), *Maybe* (neutral) or its mode, and no
      badge wraps at 390 px.
      *(Ticked 2026-09-27, `e2e/m29-kind-control.spec.ts` › *a card's badge reads To book
      in amber…*, 390×844, ci-like 2 of 2. The colour is compared against the resolved
      token (`--color-warning-tint`, `--color-moss`, `--color-info-tint`), not a class
      name. Seen red with `book: "neutral"` (`Expected: "rgb(242, 231, 204)" Received:
      "rgb(240, 237, 228)"`). Wrap is measured as height < 2 lines. Removing
      `whitespace-nowrap` alone did **not** turn it red, because these three labels fit
      at 390 px anyway. The check was shown to bite with `w-min` (`To book wrapped:
      36.375px for a 16.2px line`). So a longer future label is guarded only by the
      measurement, not by the class.)*

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
      axis. The phone keeps the stop-card list, as the design's phone Plan draws it.*
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

Whole milestone:

- [ ] `pnpm check`, `pnpm --filter web test:int`, `pnpm --filter web test:e2e:ci-like`
      (**never plain `test:e2e`**) and `pnpm seed:verify` green on the last part.
- [ ] A retro is appended at gate close.
