# Design handoff — the living bundle

This folder is the **only** handoff. Dated snapshot folders are gone: previous states live
in version control, not beside the current one. Re-read this file each time — it is
rewritten in place.

Last substantive pass: 2026-09-05 (the phone tab bar is scoped; the notebook widget framework
and its three components; Save this day as a Playbook; the phone Notebook)

**Building notebook widgets? Read these three, in this order:**
1. `specs/notebook-widget-framework.md` — the three shape components, the four states, the
   ghost rule. **This is the file to reference when implementing any widget.**
2. `SPEC.md` §18–§19 — the model underneath it (a widget is a function of declared inputs,
   bound per instance; the phone).
3. `design/Notebook Widget Framework.dc.html` — open it in a browser: every shape in every
   state, with the rules printed beside them.

**Commit this folder into the repo at `.design-sync/handoff/`**, replacing the previous
bundle. It supersedes the 2026-08-30 bundle.

**This pass closes the book on the current design direction.** Exploratory work on a
different planning model has started in the design project (`Wireframes.dc.html` — five
competing models, nothing decided). None of it is in this bundle and none of it is a
build instruction. Everything here describes the design as it stands and is safe to build.

What is new since the last bundle:

- **The phone tab bar is scoped to where you are, and no tab is ever disabled.**
  `SPEC.md` §22, `DRIFT.md` §2h. Inside a trip the bar is Plan · Map · Notebook; everywhere
  else it is Trips · Playbooks. Plan and Map had no meaning on "Your trips", on Discover or on
  a shared day, and a greyed-out tab would have been UI with no purpose on the page. **The
  tab list is derived from the route, not a constant array** — that is the part a build has to
  change. The phone Notebook index gained the `‹ Trips` back link it now depends on, and the
  active tab is a `--color-brand-tint` pill behind the glyph rather than a colour swap alone.
- **The notebook widget framework — three reusable components, not just prose.**
  `specs/notebook-widget-framework.md` (`SPEC.md` §21), the gallery at
  `design/Notebook Widget Framework.dc.html`, and the components themselves:
  `NotebookInline`, `NotebookBlock`, `NotebookRepeat`. All inline widgets, all blocks and
  all repeats now behave identically because one component draws each class. Includes the
  **ghost**: a dropped-in widget renders as the shape of its value (`$XXX`, `NN rows`, its
  real sentence) and fills in per part as inputs bind. One rule needs a build decision —
  ghosts are editing-only.
- **`specs/save-a-day-as-a-playbook.md` — a flow that was built and never written down.**
  `SPEC.md` §20 points at it. Entry point, dialog, save action, the exact animation
  (elements, durations, easings, spark offsets), where a kept day surfaces afterwards, what
  a build owes, and five open questions. A build asking "how does a day become a Playbook"
  had no answer before this; §15 only described the library it lands in.
- **The phone Notebook is the whole widget model.** `SPEC.md` §19, `DRIFT.md` §2f. It was one
  repeater hardwired to the focused day; it is now index → page, with per-widget binds and the
  full insert registry. **It adds no API surface** — the same resolvers §18 already asks for —
  so Notebook should be costed as one number across both surfaces, not desktop-now /
  phone-later. The one divergence is density: rebinding is a 44px "Pointed at …" button opening
  a bind sheet, because the desktop's inline chrome row does not fit 390px.
- **Notebook pages no longer have a scope.** `SPEC.md` §18, `DRIFT.md` §2e. Each **widget**
  owns its inputs — a day, a stretch of days, a person, a tag set, a trip — bound when you
  insert it and rebindable in place, so two widgets on one page can read two different days.
  This is the one item in this bundle that makes the build's job **smaller**: it retires
  `PageContext.dayRef` as a page property (with `handleBindDay` / `focusDayBinding`), the
  page-header day dropdown, the "this page follows" Banner, and scope as a facet in the insert
  picker. It also **restates the oldest Notebook blocker**: settle what a seeded template
  *instantiates*, not whether macro authoring returns. §18 supersedes the page-scope half of
  §7; the struck text there is kept on purpose, because the code it names still exists.
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
  predated the Notebook widget model, the day-view map, the phone Playbooks tab and all of
  the billing work.
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
| _(mobile has no separate file)_ | The phone is a **surface inside the desktop design file**, reached by its `surface` prop. SPEC §10 scopes it, §13 states its foundations, **§19 is the phone Notebook** |
| `SPEC.md` | Written spec for what the design file cannot say out loud. **§21 (widget framework), §20 (Save as Playbook), §19 (phone Notebook), §18 (Notebook widgets — supersedes §7's page scope), §17 (billing) and §16 (day map, phone Playbooks) are this pass**; §15 Playbooks, §14 landing, §12 Calendar, §11 rules |
| `DRIFT.md` | Design ↔ build reconciliation — §1 open drift (**D10 is billing**, D9 Playbooks scope), §2 landing, §2b Playbooks, **§2c billing, §2d day map + phone Playbooks, §2e Notebook widgets, §2f phone Notebook**, §4 what's real in code and undesigned, §5 closed, §6 build checks, §7 their KIs |
| **`specs/notebook-widget-framework.md`** | **The notebook widget framework** — three shape components, four states per shape, the ghost. `SPEC.md` §21 summarises it; this file is the contract |
| `design/NotebookInline.dc.html` | Component — an inline widget: a segment list of your text, its values, and ghosts |
| `design/NotebookBlock.dc.html` | Component — a block widget: declared columns, rows, caption, total, one note line per state |
| `design/NotebookRepeat.dc.html` | Component — a repeat widget: one authored sentence per item; its rows **are** `NotebookInline` mounts |
| `design/Notebook Widget Framework.dc.html` | The framework gallery — every shape × every state, live, with its rules |
| `specs/save-a-day-as-a-playbook.md` | The Save-a-day-as-a-Playbook flow: entry point, dialog, save action, the exact animation, five open questions |
| `data/japan-trip-seed.json` | Structure export of the Japan trip, for seed data |
| `DS-UPSTREAM.md` | Bugs and gaps owed to the **design-system** package, not to this product. Route these to the DS repo |

## How to read the design file

It is a **design reference written in HTML**, not production code. Do not copy its markup.
The four notebook components in `design/` are the exception: they are the framework itself, and their **props and state names are the contract** — read their logic comments. Everything else in the folder uses a small template runtime — `<sc-for>`, `<sc-if>`, `{{ value }}` holes, and
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
