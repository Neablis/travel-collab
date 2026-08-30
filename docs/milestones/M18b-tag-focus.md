# M18b — Tag focus

**Status:** Approved 2026-08-29, **unplaced**. Not "next" merely by sitting
unchecked in `TODO.md`.
**Carved out of:** M18's gate, by Mitchell on 2026-08-29 — the same shape as
M11b Playbooks leaving M11's gate the day before. M18 lands the two fields and
every surface that *reads* `kind`, plus tag chips that render and can be set.
What it deliberately does not land is the behaviour those chips are supposed to
*drive*.

## What this is

SPEC §11 (2026-08-25):

> The header filter row is **gone**. Tag chips on a stop are now the control:
> clicking "Meal" on a stop dims everything not tagged Meal to 32% opacity
> across Timeline, Day columns, Calendar and Map; clicking again clears. Single
> focus, one tag at a time — multi-select was the part that earned its keep
> least.
>
> **Focus dims, never hides.** The calendar used to filter its cells down to
> three matching stops; it now keeps every stop rendered and dims the off-tag
> ones, so the shape of a day survives the filter. Cell overflow copy reads
> "3 of 5 in focus" while focus is on. When focus is active, a line beside the
> view tabs names the tag and offers Clear.

At Calendar's zoom the rule differs, per SPEC §12: a city card shows
`2 of 6 match` rather than dimming individual stops, and a city with **no**
matching stop drops to `opacity: 0.28`.

## Why it was carved out, and not just deferred quietly

Three reasons, all of which are about it being a different *kind* of work from
the rest of M18:

1. **It is the only piece that needs shared cross-lens state.** Everything else
   in M18 is a component reading a field it is already handed. Tag focus is one
   selected tag, held above four lenses, that every one of them must honour —
   closer to `FocusProvider`'s day focus than to a badge.
2. **Its Calendar behaviour is a different rule from its Board behaviour.**
   "Dim the off-tag stops" and "show `N of M match`, dim the whole card at 0.28"
   are two designs, and the second one interacts with the city cards M18 just
   changed.
3. **No M18 exit-gate box measured it**, and adding one would have held every
   other status flag stale for scope nothing else in the milestone touches —
   the precise argument that carved Playbooks out of M11.

## Scope

- One focused tag, held above the lens switch. Clicking a chip on any stop sets
  it; clicking the same chip clears it. Never more than one.
- Timeline, Day columns and Map: off-tag stops render at 32% opacity. **Dim,
  never hide** — the shape of the day has to survive the filter, which is the
  whole reason this replaced a filter row.
- Calendar: a city card shows `N of M match`; a card with no match drops to
  0.28. Cell overflow copy reads `3 of 5 in focus`.
- A line beside the view tabs naming the focused tag, with a Clear control.
- The chip's own affordance: a ring on the focused chip, and the hover hint the
  handoff writes (`Dim everything that is not meal` / `Stop focusing on meal`).

## Explicitly not in scope

- **A filter row.** It is gone; do not rebuild it. `docs/known-issues.md` KI-47
  carries the correction and why the reference survived in our docs for four
  days after the design deleted it.
- **Multi-select.** SPEC §11 names it as the part that earned its keep least.
- **Tag *powers*** — dashed cards for ideas, one-lodging-per-day, weather flags,
  the assistant chasing booking dates. Each is its own feature; the handoff
  lists them per tag, and none is a focus behaviour.
- **The Notebook repeater's `Only stops tagged …` filter.** SPEC §7, routed to
  **M14** on 2026-08-23 along with the rest of the Notebook redesign.

## Exit gate

- [ ] Clicking a tag chip on a stop focuses that tag; clicking it again clears.
      Only one tag is ever focused.
- [ ] Timeline, Day columns and Map dim off-tag stops rather than removing them
      — a day with one matching stop still shows all its stops.
- [ ] Calendar shows `N of M match` per city card and dims a no-match card,
      rather than dimming stops it no longer renders.
- [ ] Focus is named beside the view tabs while active, with a working Clear.
- [ ] Focus survives a lens switch, and is not confused with day focus.
- [ ] No filter row, no "Show everything" control, and no multi-select anywhere.

## Prerequisites

M18's gate. `ActivityTag` and the chips exist as of M18's PR 3; this milestone
adds only the behaviour behind them. Nothing else on the roadmap is blocked by
M18b, so it can be placed anywhere.
