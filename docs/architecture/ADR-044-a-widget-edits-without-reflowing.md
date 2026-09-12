# ADR-044: A widget edits without reflowing — the chrome leaves the inline flow, the value never moves

**Status:** **Accepted — 2026-09-12.** Mitchell's decision, quoted below, is the acceptance; no
branch has been cut against it yet.
**Deciders:** Mitchell (product/eng); Claude (architect) — drafted
Related: **ADR-039** (a widget is a selection, not a name — the change that made this reachable),
ADR-035 Decision 1 (one node type, not two — upheld here), ADR-037/ADR-038 (a widget is a module;
the notebook document is a versioned AST)
Known issues: **KI-2026-09-05-c** (the entry this decides), **KI-2026-09-05-a** (the caret/selection
collision, now load-bearing rather than adjacent), KI-2026-09-06-c (the guard that keeps
`block`/`repeat` rendering as they are)
Spec: `.design-sync/handoff/SPEC.md` §13.5 (no floating controls on a phone), §19 (the phone Notebook)

## Context

**ADR-039 replaced seventeen named widgets with twelve primitives that each declare their legal
filter dimensions.** That was right, and it had a consequence nobody sized: `cost` is given five
dimensions by the legality matrix, so it reaches the editor as **five controls plus a days calendar,
laid out inline, inside a paragraph**. The retired widgets declared one or two, so the inline
placement had never had to carry a row this long. `flex-wrap` stops the row pushing the line
sideways, which keeps the layout intact without making it good.

Mitchell reported it twice on the PR 141 preview (2026-09-04), from two directions — the select
highlight looking wrong, and the days popover's UI "a little lacking" — and diagnosed it in the
first: *"maybe the root of the issue is we need to seperate the input editor to be a popover
editor, and the inline/block/rendered whatever element."*

It was filed as **KI-2026-09-05-c** and left open, because separating the editor from the rendered
value landed on two questions nobody had answered: whether the popover opens on the widget itself or
on an affordance beside it, and whether the widget stays a ProseMirror inline atom.

**Mitchell, 2026-09-12, answering both:**

> As long as a widget in edit mode can give a different layout than when in read mode, its impossible
> for a user to really get the page they want it. We need a way to have the widget have its controls
> near the element, but not impacting the inline flow of the html, thats why i suggested a popover or
> something. We need to be considerate of mobile interactions, or click handlers but that is solvable

## Decision

**The rendered value occupies identical space in read mode and edit mode. The chrome never
participates in inline flow.**

1. **Layout parity is an invariant, not a preference.** An editor whose layout differs from the
   published page cannot show the author the page they are composing. Any widget change is measured
   against this first.
2. **Controls move out of flow, into a popover anchored to the widget.** "Near the element" is
   satisfied by anchoring, not by adjacency in the document — an affordance placed *beside* the value
   would itself occupy inline space and break rule 1.
3. **The widget stays a ProseMirror inline atom.** ADR-035 Decision 1 ("one node type, not two")
   stands. This follows from rule 1 rather than being traded against it: a block-level editor node
   reflows between modes by construction. **No `PageDoc` migration is implied**, and M14's unowned
   block-node gate box is not a prerequisite.
4. **The trigger is the widget or an overlay anchored to it**, which makes the caret/selection
   collision (**KI-2026-09-05-a**) part of this work rather than a neighbour of it. Mitchell has ruled
   that collision and mobile interaction **solvable, not blocking** — they are scope, not gates.
5. **Scoped to `shape === "single"` primitives.** `block` and `repeat` widgets already render on their
   own row, so they neither exhibit the defect nor need the popover; leaving them alone also keeps
   KI-2026-09-06-c's guard honest.

## Consequences

**What gets better.** The author sees the published layout while editing, which is the property that
makes the notebook trustworthy to compose in. A primitive gaining a sixth dimension stops making the
sentence worse — the failure mode ADR-039 introduced is bounded rather than growing.

**What this costs.** Two existing tests encode the pre-decision behaviour and must change with the
implementation, which is expected work rather than scope creep:
`apps/web/src/components/pages/editor/WidgetChrome.test.tsx:279-285`, whose guard asserts `cost`'s
selects are present with **no interaction**, and `apps/web/e2e/m14-notebook-widgets.spec.ts`, which
clicks `cost`'s dates control with no "open the popover" step.

**What is deliberately not decided here.** The popover's own visual design — Mitchell's second
comment ("*i like the UX, but the ui is a little lacking*") is about the days calendar's appearance
and is downstream of this structural decision, not settled by it. Reuse the phone's existing
"Showing …" summary button and `bindSummary` rather than inventing a second vocabulary; that is the
affordance KI-2026-09-05-c's own Fix path already named.

**What would falsify this.** If anchoring a popover to an inline atom turns out to be unable to avoid
moving the caret — that is, if rule 4 cannot be satisfied without violating rule 1 — then the inline
atom is the wrong substrate and ADR-035 Decision 1 has to be reopened rather than worked around.
