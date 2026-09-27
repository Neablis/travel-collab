# ADR-057: The assistant searches for a widget, and a link widget is guarded at the insert

**Status:** **Proposed — 2026-09-26.** Mitchell's decision in chat (below) is the mandate; the
design details are the implementer's, pending his review (listed at the end).
**Deciders:** Mitchell (product/eng); Claude — drafted
Amends: **ADR-056 decision 6** (links are not offered to the assistant) — reversed, with two guards.
Related: **ADR-043** (a tool is a module; a scope is a grant), **ADR-042** (a hand-written tool
names a server-side row), **ADR-039** (a widget is a selection; presets are data), ADR-015
invariant 5 (tool schemas are derived), `prompt.ts` (the untrusted-data fence).
Milestone: `docs/milestones/M30-notebooks-and-links.md` (its assistant line).

## Context

Mitchell, 2026-09-26, on M30 no longer seeding the trip strip or the countdown:

> *"I'm ok with them not being in the default as long as they should still be used. Let's make
> sure the AI assistant can still create and make changes in a notebook though, we might need a
> tool to search the widgets, it will be too expensive to just give the AI agent all the widgets
> in its context always."*

**What the assistant could do in a notebook, audited the same day.** On a page-scoped turn
(the only surface granting `pages`) it holds `insert_text` and `insert_widget`, and both
*insert at the caret*. It could not create or delete a notebook, and could not edit, move,
rebind or remove a widget or a block already on the page — there is no tool for any of it,
and a page turn's result is a list of nodes to insert, not a diff. It could insert every
registered widget except the two link widgets (`composable: false`, ADR-056 decision 6).

**What it cost.** Every page turn's system instruction carried `primitiveCatalog()` whole, as
one `Macros:` line — **12,921 of the instruction's 15,804 characters** (~3.2k of ~3.95k tokens
at chars/4), on every step of every page turn, whether the turn inserted a widget or wrote a
paragraph. The trip strip and the countdown were in it; nothing but the catalogue told the
model they existed.

## Decision

1. **The catalogue leaves the prompt; two read tools replace it.** `search_widgets` (query,
   optional `shape`, `entity`, `acceptsFilter`, `limit`) returns a compact ranked list — each
   match's id, title, one line, shape, the filters it still accepts, its `withheld` rule, its
   non-filter params with their allowed values, and **`insert`: the exact `{name, params}` to
   pass to `insert_widget`**. `get_widget(id)` returns one row in full: every input with its
   label, choice options and default, the field paths a field input takes, and — for a link —
   this trip's notebooks, days and tabs. Both are `pages`/`read`, so the grant table offers
   them exactly where `insert_widget` is offered and nowhere else.
2. **The index and the ranking live in `@tc/pages`** (`widgetSearch.ts`) — pure, derived from
   the registry and the preset table, no trip. Rows are every preset the assistant can insert
   (repeat presets excluded: `insert_widget` does not make a repeat) plus every primitive no
   preset id already stands for. Ranking is token matching over id, title, keywords, aliases
   and description with fixed weights, a crude plural stem and a stop-word list, ties broken by
   index order. **No embeddings**: ~45 curated rows, and a ranking nobody can predict is one
   nobody can test.
3. **What the prompt keeps**: one rule pointing at `search_widgets`, the three shapes as a data
   line (the categories a search narrows by), the link rule below, and every rule it had that a
   search result would not repeat. **15,804 → 2,684 characters.** The two tools add 1,925
   characters of schema to the page turn's tool list and `insert_widget` grows 51, so the fixed
   cost of a page-turn step falls by **~11,100 characters (~2.8k tokens)**. A search costs
   ~2.3k characters of result, once, on a turn that wants a widget.
4. **`insert_widget` reads the assistant's spellings, by input TYPE** (`spelledParams`, never a
   widget name): a `day` input given a number is that 1-based day, stored by id; a `target`
   input is `{notebook: n}`, `{day: n}` or `{view}`; a `url` input is guarded (5). The widget's
   own schema is still the validator (ADR-037 decision 4) — this only translates.
5. **`link.external` takes only an address the user typed in the message being answered.**
   The set is parsed from that message alone (`typedAddresses.ts`) and checked at the one door;
   anything else — an address from a stop's notes, a page, a Playbook day, an earlier message —
   is refused with a sentence telling the model to ask. Chosen over routing the insert through
   the approval card: page inserts already land in the editor for review, and a link's address
   is the one part of it a reviewer is least likely to read. Provenance is what ADR-056 feared,
   so provenance is what is checked.
6. **`link.internal` names its target by number, never by id.** `get_widget` lists this trip's
   notebooks through a turn-minted `NotebookRefs` (a port over `listPageEntries`), numbered
   from 1; `insert_widget` resolves a number only if this turn listed it, and refuses any target
   carrying a uuid. Notebook titles and first lines reach the model fenced (`untrusted`).
7. **Both link widgets drop `composable: false`.** The field stays on `MacroDef` and no widget
   declares it; `COMPOSABLE_MACRO_NAMES` now equals `MACRO_NAMES`.

## Consequences

- Every widget a person can insert, the assistant can find by its own title and insert — the
  trip strip and the countdown included (`widgetSearch.test.ts`, "findability").
- A page turn that wants a widget takes one more step (search) than before. The simulated model
  does exactly that — search with the user's sentence, insert the top match — so the flag-off
  path exercises the chain end to end (`route.int.test.ts`, `m10-simulated-ai.spec.ts`).
- The day filter is now expressible correctly by a model: it was a `DayRef` object the
  catalogue never described. A number is what the tools and rules already say.
- **No contract change.** Tool inputs and outputs are kernel zod schemas; the page document,
  `AssistantProposal` and `PageListEntry` are untouched.

## Not decided here — review points for Mitchell

1. **Editing what is already on a page.** The audit's larger finding: the assistant can add to
   a notebook but cannot change, move, rebind or remove anything in one, nor create or delete a
   notebook. That needs a document-diff proposal (node addressing, a review step for removals),
   which is a design of its own, not a tool — and "make changes in a notebook" may mean it.
2. **The address guard's reach.** An address typed two messages ago does not count. Stricter
   than necessary for a person, deliberately; say if it should span the thread.
3. **The ranking is a guess at what people type**, measured against titles and a handful of
   requests. The `ai.ask` records (the `ai-usage` skill) would show real `search_widgets`
   queries and whether the first match is the one inserted.
