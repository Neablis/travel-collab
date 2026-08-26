# Design handoff — 2026-08-26

**Commit this folder into the repo at `.design-sync/handoff/`**, replacing the previous
bundle. It supersedes the 2026-08-25 bundle.

What is new since the last bundle:

- **Calendar became a city view.** Cells carry one card per city the day touches, with a
  7am–11pm span bar, stop count, cost and an unbooked flag — no activity lists. It no
  longer overlaps Day columns, which closes the open question about retiring it.
- **Account settings exist**, holding distance units and an opt-in home-time-on-hover.
- **A design-system bug**: `Sheet`'s scroll body clips `Input`'s focus ring on the left
  and right. Worked around per-Sheet in the design; the fix belongs upstream. See DRIFT.

The six binding **project rules** from the previous bundle are unchanged and still govern
what may exist on a page — read `RULES.md` first.

## Contents

| Path | What it is |
|---|---|
| `RULES.md` | The six project rules. Read this first — they decide what may exist on a page |
| `design/Trip Planner Redesign.dc.html` | The living desktop design reference — every screen, all copy, all interaction behaviour |
| `design/Trip Planner Mobile.dc.html` | The mobile companion (on-trip retrieval + small edits — SPEC §10) |
| `SPEC.md` | Written spec for what the design file cannot say out loud. **§12 is this pass**; §11 is the rules pass |
| `DRIFT.md` | Design ↔ build reconciliation. **§ "Calendar / account settings pass — 2026-08-26" is this pass** |
| `data/japan-trip-seed.json` | Structure export of the Japan trip, for seed data |

## How to read the design file

It is a **design reference written in HTML**, not production code. Do not copy its markup.
It uses a small template runtime — `<sc-for>`, `<sc-if>`, `{{ value }}` holes, and
`<x-import component-from-global-scope="TravelCollabUI.X">`. Read it as intent: layout,
spacing, tokens, copy, component choice, interaction behaviour. `TravelCollabUI.*` mounts
map 1:1 to the real design-system package components.

One caveat added this pass: the design file loads the **precompiled** `_ds_bundle.css` with
no Tailwind JIT, so a few values are inline styles that would be utility classes in the
app. Treat an inline `max-height`/`opacity` as intent, not as a styling instruction.

## Resolving a "the design references X but never gives its copy" dead end

1. Search the design files for the nearest label or `aria-label` (desktop first).
2. Check `SPEC.md` § Component mapping — most "unnamed element" cases are a design-system
   component used in a specific way, not a missing component.
3. Check `RULES.md` — if the element you are looking for is trip-scoped chrome in the top
   bar, a duplicated value, or a drawer on a non-droppable page, it was **removed on
   purpose** and there is no copy to find.
4. Only if all three fail, ask. Do not invent product copy.
