# M29 — The time river

**Status:** Minted 2026-09-26 from Mitchell's asks in chat; **in flight beside M14, not
the current milestone** (M14 stays current — its open boxes wait on a person). Built as
four stacked PRs. Decision record for part 1: **ADR-055**.

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
   block's own length.
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

- [ ] **[walk]** Plan draws every day on one shared axis at 44 px an hour: a 09:00 stop
      on Day 1 and on Day 5 sit at the same height.
- [ ] **[walk]** Each block style is distinguishable at a glance — planned, To book,
      Maybe (hatched, not faded), transit (dotted, with mode and duration).
- [ ] **[walk]** Two overlapping stops sit in half-width lanes marked OVERLAP; an untimed
      stop is visible; *+ Add a stop* sits below the axis.
- [ ] The layout (axis extent, lanes, thresholds) is a pure function with unit tests seen
      to fail.

Part 3:

- [ ] **[walk]** Double-click empty time opens the add sheet at that time; dragging
      across empty time opens it with that start and length.
- [ ] **[walk]** Dragging a block's bottom edge changes its end; dragging a block drops
      it at the pointer's time, with an outline preview of its own length.
- [ ] Each gesture's command is asserted at the dispatch layer, and the e2e script walks
      one of them through `pnpm --filter web test:e2e:ci-like`.

Part 4:

- [ ] **[walk]** A new trip's Overview reads as the rewritten page, built only from
      registry widgets.

Whole milestone:

- [ ] `pnpm check`, `pnpm --filter web test:int`, `pnpm --filter web test:e2e:ci-like`
      (**never plain `test:e2e`**) and `pnpm seed:verify` green on the last part.
- [ ] A retro is appended at gate close.
