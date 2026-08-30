# M18b — Tag focus

**Status:** **Built 2026-08-30; the gate has NOT closed and no status flag was
flipped.** All six behaviours below are implemented and proven on
`pnpm --filter web test:e2e:ci-like` — see "The evidence". What is missing is
the checklist's own trigger: *a **deployed** gate demo passing*. This session
could not produce one — `VERCEL_AUTOMATION_BYPASS_SECRET` is still unset, so
nothing unattended can reach a protected preview (`docs/STATUS.md`,
"Blocking / broken right now"). Closing the gate is one confirmation on the
preview, and it is Mitchell's, in the same shape M16's close took on
2026-08-29 after PR #88 deliberately flipped nothing.

Approved 2026-08-29 and **placed the same day**, immediately after M16. Placing
it was Mitchell's call; the scope and exit gate below were already written when
it was carved out of M18's gate, which is why it needed only a place.
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

**Deliberately still unticked.** Every box below has machine evidence against a
production build (next section), and the checklist in
`docs/milestones/README.md` flips all four status flags *in one commit* when the
**deployed** demo passes. Ticking these alone would be the half-flipped gate
that checklist exists to prevent, and it would make the roadmap claim a close
nobody walked on the preview.

- [ ] Clicking a tag chip on a stop focuses that tag; clicking it again clears.
      Only one tag is ever focused.
- [ ] Timeline, Day columns and Map dim off-tag stops rather than removing them
      — a day with one matching stop still shows all its stops.
- [ ] Calendar shows `N of M match` per city card and dims a no-match card,
      rather than dimming stops it no longer renders.
- [ ] Focus is named beside the view tabs while active, with a working Clear.
- [ ] Focus survives a lens switch, and is not confused with day focus.
- [ ] No filter row, no "Show everything" control, and no multi-select anywhere.

### The evidence — what is proven, and how

Read as "these behaviours work", not as "the gate passed".

`apps/web/e2e/m18b-tag-focus.spec.ts`, four specs, run on
`pnpm --filter web test:e2e:ci-like` (the only lane that counts — KI-27). It
walks `/demo`, so it needs no database and runs against the canonical Japan
fixture, whose 68 stops carry 33 `meal`, 4 `lodging`, 11 `outdoors` and 8
`ticketed` tags. Day 1 is the worked example: four Tokyo stops, two of them
`meal`, one `lodging`, one untagged.

The walk asserts the **computed** opacity the browser produced, not a class
name we hoped for. That is M18's lesson applied rather than restated: its
headline Calendar rule passed nine unit tests and was wrong, because the tests
shared the implementation's assumptions about the fixture.

Unit coverage sits beside it — `FocusProvider.test.tsx` (the toggle and the
day/tag independence), `ActivityCard.test.tsx`, `TagFocusLine.test.tsx`,
`TimelineLens.test.tsx`, `CalendarLens.test.tsx`, `MapLens.test.tsx` and
`calendarCityCards.test.ts`.

### Two things the walk found that no test did

1. **The Clear control and every focused chip had the same accessible name.**
   Both said `Stop focusing on meal` — the chip's hover hint, reused for Clear
   because it reads well. On the Japan fixture that is **34 controls with one
   accessible name**, and nothing distinguishes the one that clears from the
   thirty-three that toggle. Playwright's strict mode refused the ambiguity
   outright; a screen-reader user would simply have been lost. Clear is
   `Clear meal focus` now. Every unit test passed both before and after.
2. **The 150ms fade makes a single opacity read a race.** The same assertion
   returned 0.77, then 0.45, then 0.37 on successive runs — a value that
   *moves* between runs, which AGENTS.md's own discriminator calls a timeout
   rather than a defect. The spec polls for the settled value; the transition
   stays, because it is the behaviour.

### Recorded deltas from the spec text

- **SPEC §11's cell overflow copy, `3 of 5 in focus`, has no surface left.** It
  described the Calendar cell's "+N more" line, and M18 replaced the cell's
  stop list with city cards — there is no overflow line to relabel. The exit
  gate's own wording (`N of M match` per city card) is what shipped, and it is
  the later of the two texts.
- **Chips remain a Day-columns affordance.** SPEC §11 says "tag chips on a stop
  are now the control" across all four lenses; M18 put chips on the day-column
  card only, and this milestone's Prerequisites say it "adds only the behaviour
  behind them". Timeline, Calendar and Map therefore honour focus and offer no
  chip of their own; the Clear beside the view tabs is the way out from those
  three. Giving the timeline row its own chips is a real follow-up, not a gap
  this gate left unmeasured.

## Prerequisites

M18's gate. `ActivityTag` and the chips exist as of M18's PR 3; this milestone
adds only the behaviour behind them. Nothing else on the roadmap is blocked by
M18b, so it can be placed anywhere.
