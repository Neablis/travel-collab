# Design sync — handoff

**Commit this folder into the repo at `.design-sync/handoff/`** (next to the existing
`.design-sync/previews/`). It is the design bundle that was missing: when a design table
referenced an element whose copy lived only in the design file, there was nothing in the
repo to recover it from, and the agent correctly stopped and asked. With this committed,
that class of dead end is resolvable in-repo.

## Contents

| Path | What it is |
|---|---|
| `design/Trip Planner Redesign.dc.html` | The living design reference — every screen, all copy, all interaction behaviour |
| `SPEC.md` | Written spec for what the design file cannot say out loud: the focus-scope model, decisions, and the component-mapping rules |
| `DRIFT.md` | Design ↔ build reconciliation: drifted / unbuilt / undesigned |
| `data/japan-trip-seed.json` | Structure export of the Japan trip, for seed data |

## How to read the design file

It is a **design reference written in HTML**, not production code. Do not copy its markup.
It uses a small template runtime — `<sc-for>`, `<sc-if>`, `{{ value }}` holes, and
`<x-import component-from-global-scope="TravelCollabUI.X">`. Read it as intent: layout,
spacing, tokens, copy, component choice, interaction behaviour. `TravelCollabUI.*` mounts
map 1:1 to the real design-system package components.

## Resolving a "the design references X but never gives its copy" dead end

1. Search `design/Trip Planner Redesign.dc.html` for the nearest label or `aria-label`.
2. Check `SPEC.md` § Component mapping — most "unnamed element" cases are a design-system
   component used in a specific way, not a missing component.
3. Only if both fail, ask. Do not invent product copy.
