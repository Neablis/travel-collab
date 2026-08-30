# Design handoff — the living bundle

This folder is the **only** handoff. Dated snapshot folders are gone: previous states live
in version control, not beside the current one. Re-read this file each time — it is
rewritten in place.

Last substantive pass: 2026-08-30 (Playbooks as a public library)

**Commit this folder into the repo at `.design-sync/handoff/`**, replacing the previous
bundle. It supersedes the 2026-08-26 bundle.

**This pass closes the book on the current design direction.** Exploratory work on a
different planning model has started in the design project (`Wireframes.dc.html` — five
competing models, nothing decided). None of it is in this bundle and none of it is a
build instruction. Everything here describes the design as it stands and is safe to build.

What is new since the last bundle:

- **Playbooks became a public library, and there are three new routes** — a shared day
  (`day`), a leaderboard (`board`) and public profiles (`profile`). `SPEC.md` §15 is the
  whole surface; `DRIFT.md` §2b is what a build needs first. Read both before quoting an
  estimate: it needs `cities: string[]` per playbook, a city search endpoint, public
  visibility on a day, a reviews table, denormalised counters, and **an adds ledger keyed
  by (day, trip)** — the leaderboard's ranking rule is not implementable without it.
- **The city `<option>` dropdown is deleted, deliberately.** City search is now server-side
  with four real states. Do not restore the static list.
- **The design file in `design/` is refreshed** to the current prototype — the previous
  copy predated Discover, the shared day, the board and profiles entirely.
- **`DRIFT.md` is the current-state version** (§1 open drift, §2 landing, §2b Playbooks,
  §5 closed, §6 build checks, §7 their KIs). Nothing in it holds M10 Phase 9.
- Still carried from the 2026-08-26 pass and unchanged: the landing page (`SPEC.md` §14),
  Calendar as a city view (§12), account settings, mobile as a `surface` of this same file
  (§13), and `DS-UPSTREAM.md` for the items owed to the DS package.

The six binding **project rules** from the previous bundle are unchanged and still govern
what may exist on a page — read `RULES.md` first.

## Contents

| Path | What it is |
|---|---|
| `RULES.md` | The six project rules. Read this first — they decide what may exist on a page |
| `design/Trip Planner Redesign.dc.html` | The living desktop design reference — every screen, all copy, all interaction behaviour |
| _(mobile has no separate file)_ | The phone is a **surface inside the desktop design file**, reached by its `surface` prop. SPEC §10 scopes it, §13 states its foundations |
| `SPEC.md` | Written spec for what the design file cannot say out loud. **§15 (Playbooks / day / board / profile) is this pass**; §14 landing, §12 Calendar, §11 rules |
| `DRIFT.md` | Design ↔ build reconciliation — §1 open drift (D9 is Playbooks scope), §2 the landing page, **§2b Playbooks / board / profiles**, §5 closed items, §6 build checks, §7 their KIs |
| `data/japan-trip-seed.json` | Structure export of the Japan trip, for seed data |
| `DS-UPSTREAM.md` | Bugs and gaps owed to the **design-system** package, not to this product. Route these to the DS repo |

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
