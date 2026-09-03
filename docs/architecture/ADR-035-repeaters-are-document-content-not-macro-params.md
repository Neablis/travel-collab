# ADR-035: Repeaters are document content, not macro params

**Status:** **PROPOSED — 2026-09-03.** Not accepted. M14 link 1 requires this
ADR to be *accepted* before any repeater code lands, so nothing in it is built
yet; this is the decision put up for that acceptance.
**Deciders:** Mitchell (product/eng) — pending; Claude (architect) — drafted
Design spec: `.design-sync/handoff/SPEC.md` §7, "The one new primitive"
Milestone: `docs/milestones/M14-rich-layer.md` — link 1, which gates links 4
and 5
Related: ADR-003 (the event log is planning state), and the `params` seam in
`packages/pages/src/registry-types.ts:17`

## Context

SPEC §7 asks for one new thing the Notebook cannot currently express:

> **Repeaters.** "A line for every day/stop/city" — one author-written sentence
> that repeats per item, with chips filled from each item ("Today we're going to
> *Hakone Open-Air Museum* in *Ninotaira*."). Rendered on a dashed rail labelled
> with what it repeats over.

and says, correctly, that the registry cannot express it. Checked against the
tree at `052aae9`:

- `MacroKind` is `z.enum(["inline", "block"])` (`packages/contracts/src/pages.ts`).
  There is no repeat kind.
- **Every macro is `NoParams`.** `const NoParams = z.object({}).strip()` is
  declared identically in `macros/inline.ts:7` and `macros/block.ts:8`, and all
  seven registry entries use it. The `params: z.ZodType<P>` seam
  (`registry-types.ts:17`) has existed since M7 and has never carried a value.
- The editor has exactly one node type for macros: `MacroNodeExtension`, an
  **atom** (`atom: true`, `group: "inline"`). An atom has no editable content by
  definition.
- `resolve(detail, ctx, params)` receives `PageContext`, whose only scope is
  `tripId` plus an optional `dayRef`. There is no per-item scope.

The whole feature therefore turns on one question, which is what this ADR
decides: **where does the author-written row template live?**

Two rules constrain the answer before any engineering does.

1. **"Users never see or type macro syntax"** (§7, stated as the rule the whole
   section rests on). Whatever a row template is, an author edits it the way
   they edit the rest of the page — typing prose and inserting chips.
2. **"Moving a day or a stop rewrites the page with nobody editing it"** (§7).
   A repeater's binding to its items must be resolved at render time. Anything
   that writes item identity into stored content breaks precisely the promise
   the feature exists to demonstrate.

## Decision

### 1. A row template is document content — inline nodes in the page's own doc

A repeater is a **new ProseMirror block node, `repeat`**, whose *content* is the
row template:

```
repeat(attrs: { name: "repeat.days" | "repeat.stops" | "repeat.cities", params: {} })
  └── inline*        ← the author's sentence: text nodes and `macro` atoms
```

The row template is not a string, not JSON in an attribute, and not a value in
`params`. It is the same inline content the rest of the page is made of, in the
same document, edited by the same editor.

This is the load-bearing choice, and it follows from rule 1 rather than from
taste. The two alternatives both reintroduce the syntax §7 forbids:

- **A template string with placeholders** (`"Today we're going to {stop.title}"`)
  is macro syntax, visible and typed, wearing different brackets. It also needs
  a second parser and a second renderer that neither `MacroView` nor the
  registry would own.
- **A serialised node list inside `params`** keeps the syntax hidden but puts
  document content inside a param bag. TipTap could not then edit it in place —
  the author would be editing a JSON blob through some bespoke sub-editor —
  and ProseMirror's schema, which is the real validator of what may sit inside
  a page, would have no view of it.

Storing it as content means the insert picker (M14 link 4) works inside a
repeat with no special case, undo/redo works, and `PageContent`'s existing
permissive doc shape already holds it.

**`repeat` is a second node type, not a mode of `MacroNodeExtension`.** That
extension is an atom, and an atom cannot have editable content; widening it
would mean making every macro node non-atomic to serve one kind that is.

### 2. `params` carries the collection, and that is what the seam was for

The `repeat` node's `name` attr resolves through the same registry as every
other macro, against a third kind:

```ts
export const MacroKind = z.enum(["inline", "block", "repeat"]);
```

A repeat macro's `resolve` returns **the items to iterate**, not a rendered
payload:

```ts
ok({ label: "every day", items: ItemScope[] })
```

`label` is what the dashed rail is labelled with ("A line for every day"), so
the rail's wording comes from the registry entry rather than from the
component — the same way `emptyText` and `description` already do.

This is where the untouched `params` seam earns itself. `repeat.stops` takes a
real param — which stops, and in particular the tag filter §11 already lists as
open ("Notebook repeater tag parameter") — so its schema stops being
`NoParams`:

```ts
params: z.object({ tag: z.string().optional() }).strip()
```

`resolveMacro` already `safeParse`s params and already returns
`{ status: "bad-params" }` on failure (`registry.ts:26-28`), and `MacroView`
already renders that case. Nothing about the param path needs building; it
needs using.

### 3. The item scope is a render-time argument and is never stored

`resolve` gains an optional fourth argument:

```ts
resolve(detail: TripDetail, ctx: PageContext, params: P, item?: ItemScope): MacroResult<T>
```

`ItemScope` is a discriminated union — `{ kind: "day"; dayId }`,
`{ kind: "stop"; activityId }`, `{ kind: "city"; city }` — passed down by the
repeat renderer as it maps the row template over the resolved items.

**`PageContext` is not extended, and this is the point.** `PageContext` is a
contract that is persisted on every page row. Putting an item scope in it would
make "this row is about day 3" storable, and a stored item identity is exactly
what makes a page go stale when a day moves — the failure §7's promise is
defined against. Keeping the scope as an argument means a repeat resolves from
the trip on every render and cannot encode an answer.

Item-scoped macros (`stop.title`, `stop.city`, `day.date`) return
`unbound("item")` when resolved with no item — the existing `unbound` shape
(`result.ts`) widened from `needs: "day"` to `needs: "day" | "item"`. That gives
the picker and the renderer an honest, already-designed state for a chip
dragged out of the rail it belongs to, instead of a crash or a blank.

### 4. An empty collection renders `emptyText` in Reading and the rail in Editing

The two modes answer differently, deliberately:

- **Reading** renders the registry entry's `emptyText` through the same muted
  `EmptyChip` every other macro's empty case already uses ("No days planned
  yet"). A traveller reading a day sheet for a trip with no stops gets a
  sentence, not an empty region and not a dashed authoring rail.
- **Editing** always renders the rail and the row template, even with zero
  items. Hiding it would mean an author cannot write or fix the sentence for a
  collection that happens to be empty right now — and the empty case is
  precisely when a trip is new and the author is writing.

This asymmetry is why the mode control (M14 link 2) is a prerequisite of the
repeater work rather than a peer of it.

## Consequences

**A contract change, in its own PR with a changelog entry** (AGENTS.md invariant
5): `MacroKind` gains `"repeat"`, a `RepeatNode` schema joins `MacroNode`, and
`MacroResult`'s `unbound` widens. Consumers: `packages/pages`, `MacroView`,
the editor extensions.

**`MacroNodeExtension`'s comment stops being true.** It says "One node type, not
two" and gives a good reason for it. That reason survives for *presentation*
kinds — inline versus block is still a rendering decision off `getMacro(name).kind`
— and does not survive for a node that has content. The comment should be
amended in the same commit, not left asserting a rule the code broke.

**The AI compose path can write repeaters.** `pageTools.ts` composes page
content, and a node type it does not know about is a node type it will not
produce. Whether compose learns repeaters is a separate call; what this ADR
fixes is that it *can*, because a repeat is ordinary document content.

**What this does not decide:** the picker's shape axis (M14 link 4), the mode
control (link 2), and whether the M8 macro vocabulary widens. This ADR makes
"Repeats" expressible; which macros appear under it is the vocabulary question,
and it is Mitchell's.

## Alternatives rejected

- **A `loop` macro whose `params` hold a template string.** Rejected under rule
  1: it is macro syntax with different brackets, plus a second parser.
- **A repeat that writes resolved rows into the document.** Rejected under rule
  2: the page would be correct only until something moved, which inverts the
  feature's entire claim.
- **Extending `PageContext` with the item scope.** Rejected in decision 3 — it
  makes a render-time scope persistable, and a persisted item identity is the
  staleness bug.
- **Doing nothing and letting `itinerary.trip` cover it.** It is the current
  state and it is what §7 rejects: `itinerary.trip` resolves a fixed block with
  a fixed layout, and the author cannot write the sentence.
