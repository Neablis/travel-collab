# Design handoff — the living bundle

This folder is the **only** handoff. Dated snapshot folders are gone: previous states live
in version control, not beside the current one. Re-read this file each time — it is
rewritten in place.

Last substantive pass: 2026-09-02 (billing surfaces for M20 / M21)

**Commit this folder into the repo at `.design-sync/handoff/`**, replacing the previous
bundle. It supersedes the 2026-08-30 bundle.

**This pass closes the book on the current design direction.** Exploratory work on a
different planning model has started in the design project (`Wireframes.dc.html` — five
competing models, nothing decided). None of it is in this bundle and none of it is a
build instruction. Everything here describes the design as it stands and is safe to build.

What is new since the last bundle:

- **Billing has four designed surfaces** — pricing on the landing page, an operator console
  (route `admin`), the collaboration gate in Trip settings, and plan + usage in the account
  sheet. `SPEC.md` §17 is the whole design; `DRIFT.md` §2c is what it needs. **Read both
  before estimating M20 or M21.** Three things to take from them before anything else:
  **the two prices are placeholders** and the design has not chosen them; **the nested
  ladder is presentation only**, and no screen may read a display order as authority; and
  **publishing / migrating plan versions is deliberately not in the UI** (Mitchell,
  2026-09-02), which narrows M20 link 7 — its tier panel is read-only.
- **The shared day has a map, and Playbooks is a fifth phone tab.** `SPEC.md` §16,
  `DRIFT.md` §2d. The previous bundle predated both. §16's three map constraints are each a
  bug that was hit and fixed in the design file; §13's four-tab list is superseded.
- **The design file in `design/` is refreshed** to the current prototype — the previous copy
  predated the day-view map, the phone Playbooks tab and all of the billing work.
- Still carried and unchanged: Playbooks as a public library (§15), the landing page (§14),
  Calendar as a city view (§12), mobile as a `surface` of this same file (§13), and
  `DS-UPSTREAM.md` for what is owed to the DS package.

The six binding **project rules** from the previous bundle are unchanged and still govern
what may exist on a page — read `RULES.md` first.

## Contents

| Path | What it is |
|---|---|
| `RULES.md` | The six project rules. Read this first — they decide what may exist on a page |
| `design/Trip Planner Redesign.dc.html` | The living desktop design reference — every screen, all copy, all interaction behaviour |
| _(mobile has no separate file)_ | The phone is a **surface inside the desktop design file**, reached by its `surface` prop. SPEC §10 scopes it, §13 states its foundations |
| `SPEC.md` | Written spec for what the design file cannot say out loud. **§17 (billing) and §16 (day map, phone Playbooks) are this pass**; §15 Playbooks, §14 landing, §12 Calendar, §11 rules |
| `DRIFT.md` | Design ↔ build reconciliation — §1 open drift (**D10 is billing**, D9 Playbooks scope), §2 landing, §2b Playbooks, **§2c billing, §2d day map + phone Playbooks**, §5 closed, §6 build checks, §7 their KIs |
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
