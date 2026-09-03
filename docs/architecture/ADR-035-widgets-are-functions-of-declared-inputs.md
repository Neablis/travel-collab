# ADR-035: A notebook page is text and widgets; a widget is a function of declared inputs

**Status:** **PROPOSED — revised 2026-09-03.** Not accepted.
**Deciders:** Mitchell (product/eng) — pending; Claude (architect) — drafted
Design spec: `.design-sync/handoff/SPEC.md` **§18** ("Notebook widgets — a page has
no scope", 2026-09-02), which replaces §7's page-scope model
Milestone: `docs/milestones/M14-rich-layer.md` — link 1, which gates the builder half
Related: ADR-003 (what the event log covers), ADR-033 (one AI route), and the
`params` seam in `packages/pages/src/registry-types.ts:17`

> **This ADR was rewritten on 2026-09-03 and the earlier draft is superseded, not
> amended.** The first version was titled *"Repeaters are document content, not macro
> params"* and answered one question: where does a repeater's row template live. It was
> written on 2026-09-03 against SPEC §7, without knowing that **§18 had already replaced
> §7's model on 2026-09-02** — that commit reached `main` as `f365f0b` hours after the
> navigation half merged. The old draft is not wrong so much as too small: repeaters are
> one shape of one kind of widget, and the real decision is the model underneath them.
> What survives from it is decision 4 below (iteration items are never stored), which
> §18 does not contradict.

## Context

### What the design now says

A notebook page is **not "about" anything**. It is a document holding text and widgets,
and **each widget owns its own inputs**. Two widgets on one page can read two different
days — §18's worked example has one sentence pointed at Day 6 and a stop repeater
pointed at Day 9, with the page itself neither.

Mitchell's framing, 2026-09-03, is the same thing said shorter:

> we no longer care about the type of notebook, they arent a Trip notebook, or day,
> they are just a notebook, and text or widgets. Each widget has input params, and
> those input params can be configured in edit mode. For instance, if i have a
> timeline widget, in edit mode, i can select 1 or 2 or full trip (a date range), or
> if i set a budget widget, i can set if it has a filter and on what tags. Those are
> just examples, but **widgets are functions and inputs**.

### What the code has

Checked against `f365f0b`:

- `MacroKind` is `z.enum(["inline", "block"])`. No third kind.
- **Every macro is `NoParams`** — `z.object({}).strip()`, declared identically in
  `macros/inline.ts:7` and `macros/block.ts:8`, used by all seven entries. The
  `params: z.ZodType<P>` seam has existed since M7 and has never carried a value.
- `MacroNode.attrs` is already `{ name, params }` (`contracts/pages.ts`), so the
  document format already has somewhere to put a binding.
- `resolveMacro` already `safeParse`s params and already returns
  `{ status: "bad-params" }`, which `MacroView` already renders.
- `PageContext` is `{ tripId, dayRef? }`, persisted on every page row.
- `MacroNodeExtension` is an **atom** (`atom: true`, `group: "inline"`).

So the seam this needs was bought in M7 and never spent. What is missing is not the
ability to carry params — it is any statement of **what a param means**, which is what
lets a UI choose a control for it.

## Decision

### 1. A page has no scope. `PageContext.dayRef` is removed

`PageContext` becomes `{ tripId }`. With `dayRef` go the surfaces §18 lists: the
"This page is about" dropdown, the "this page follows Day 6" banner, the
**Trip-wide / Day 6 badge on the notebook index**, `PageScreen.handleBindDay` and
`focusDayBinding`.

This un-ships part of PR #126, which built that badge and its `scopeLabel` on 2026-09-03
against §7 — a day after §18 replaced it. That is a conformance change, not a regression,
and it is small: `scopeLabel` and `DayBindingControl` lose their only callers.

A contract change, so it takes AGENTS.md invariant 5's protocol — its own reviewed PR,
a `docs/contracts/CHANGELOG.md` entry, every consumer updated in the same PR.

### 2. The registry declares INPUTS, not just a params schema

A Zod schema says a param is a string. It does not say the string is a day, a person or
a tag — so it cannot tell a UI which control to render. Each registry entry therefore
declares its inputs:

```ts
type WidgetInput =
  | { name: string; type: "day";    label: string }
  | { name: string; type: "days";   label: string }   // from / through
  | { name: string; type: "person"; label: string }
  | { name: string; type: "tags";   label: string }
  | { name: string; type: "trip";   label: string };

interface MacroDef<P, T> {
  // …name, kind, description, emptyText, resolve as today…
  params: z.ZodType<P>;        // still the validator
  inputs: readonly WidgetInput[];   // NEW: what a control is chosen from
}
```

`params` stays the validator — it is what `resolveMacro` already enforces and what makes
a hand-edited or AI-written document safe. `inputs` is the **description** the insert
sheet and the edit-mode chrome row read to build controls. Five types, per §18's table;
the type picks the control, so a new widget taking a day needs no new UI.

`inputs: []` means the widget binds nothing and inserts immediately — "your name", "a
line for every trip you have".

Mitchell's two examples land on this directly: a timeline widget declares
`[{ name: "range", type: "days" }]` and a budget widget declares
`[{ name: "tags", type: "tags" }]`.

### 3. A binding lives on the widget instance, in the node's `params`

The binding a person chooses is stored in `MacroNode.attrs.params` — the field the
contract already has. Nothing new is stored on the page, which is what makes decision 1
possible: the page needs no scope because every widget carries its own.

**Bindings are configured in Editing mode, on the page**, per §18: a chrome row above
each bound block, carrying a brand-tint name pill and the widget's bind selects inline.
Changing one re-renders that block and nothing else. Reading mode shows no chrome. The
name pill is conditional on the widget having a name, so an itinerary widget under an
authored heading does not print the heading twice.

**Insert and rebind are the same act**, so they share one control set: the insert sheet's
"Point it at" step is the same `FormField` + `NativeSelect` per input that the chrome row
shows later.

### 4. Iteration items are a render-time argument and are never stored

*(Carried over from the superseded draft — §18 does not touch it, and it is the one part
of the repeater question that is independent of the scope model.)*

A repeater is a widget whose `kind` is `"repeat"` and whose *content* is the author's row
template — inline nodes in the page's own document, not a string and not a value in
`params`. A template string reintroduces the macro syntax §7 forbids and needs a second
parser; a serialised node list in `params` hides the syntax but puts document content in a
param bag where TipTap cannot edit it and ProseMirror's schema cannot see it.

`resolve` gains an optional item argument:

```ts
resolve(detail, ctx, params: P, item?: ItemScope): MacroResult<T>
```

`ItemScope` is the per-iteration scope the repeat renderer passes as it maps the row
template over resolved items. **It is never persisted.** Storing an item identity is
exactly what makes a document go stale when a day moves — the failure the whole feature
exists to disprove.

`repeat` is a second ProseMirror node type, not a mode of `MacroNodeExtension`: that
extension is an atom, and an atom cannot have editable content.

### 5. The assistant's page tools become insert-shaped

Under this model the assistant no longer needs to compose a whole document to change one
thing. Its page-scoped tool surface becomes:

- `insert_text(markdown)` — prose
- `insert_widget(name, params)` — validated by the registry's own `params` schema, so a
  hallucinated binding is refused by `resolveMacro`'s existing `bad-params` path rather
  than rendering wrong
- the existing read tools

This is strictly smaller than `compose_page` and it is the reason §18 helps the assistant
rather than complicating it: **the registry is already a machine-readable description of
what can be inserted and what it takes** (`description`, `emptyText`, and now `inputs`),
so the tool schema is derived from the registry rather than hand-maintained beside it.

`AskScope` already carries `{ kind: "page"; pageId }` and the `/ask` route already
verifies which page it is acting on rather than trusting the request body (ADR-033), so
the scoping this needs exists. What changes is the tool list, not the plumbing.

## Consequences

- **Contract changes**, in their own PR with a changelog entry: `PageContext` loses
  `dayRef`; `MacroKind` gains `"repeat"`; a `RepeatNode` joins `MacroNode`.
- **`MacroNodeExtension`'s "one node type, not two" comment stops being true** for
  content-bearing widgets and should be amended in the same commit rather than left
  asserting a rule the code broke.
- **The `templates.ts` blocker dissolves**, which is the single biggest consequence. §7's
  standoff was "the design wants macro chips, M8 removed macro authoring, and the seeds
  contain no macro nodes". Under this model a seeded template is *a document containing
  widget instances with default bindings*, and the authoring UI is the insert sheet plus
  the chrome row — neither of which is a text-macro editor. The question stops being
  "does macro authoring come back" and becomes "what does a seeded template instantiate".
- **A widget's registry preview must not assert numbers the live widget computes**, or
  the sheet and the page contradict each other in one session (§18). Person and cost
  previews are phrased generically for that reason.

## Alternatives rejected

- **Keep the page scope and let widgets inherit it.** This is §7, and it is what §18
  replaced. It cannot express the case that motivates the model: two widgets on one page
  reading different days.
- **Infer the control from the Zod schema.** `z.string()` cannot distinguish a person id
  from a tag. Inference would need branded types or a naming convention, both of which are
  a weaker version of declaring the input outright.
- **One generic "config" blob per widget with a bespoke editor.** Every widget then owns
  its own UI, which is how a registry of seven becomes a registry nobody extends.
