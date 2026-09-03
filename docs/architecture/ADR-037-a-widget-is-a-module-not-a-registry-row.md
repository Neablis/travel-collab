# ADR-037: A widget is a self-contained module, and rendering it can never produce markup

**Status:** **PROPOSED — 2026-09-03.** Not accepted.
**Deciders:** Mitchell (product/eng) — pending; Claude (architect) — drafted
Related: **ADR-035** (a widget is a function of declared inputs — this says how one is *built*),
ADR-038 (how the document that holds them is stored), ADR-015/Invariant 5 (tool schemas are
derived, never hand-written twice)
Catalogue: `docs/specs/2026-09-03-notebook-widget-catalogue.md` — the 21 the design shows

## Context

Mitchell, 2026-09-03:

> widgets will be something that will be frequently added to and improved […] every widget
> should have its interface, a command that adds it, what are valid inputs and know to detect
> that, csr protections, and a render function that returns the rendered output from the
> inputs. then we can easily add more once we know how to repeatedly make them from our base
> inputs

**The design has 21 widgets. The registry has 7.** And of the 21, thirteen are buildable
today, six need a contract change, two need a domain concept that does not exist. So this is
not "add fourteen widgets once" — it is a part of the app that grows for the life of the
product, and the cost that matters is the cost of the *fifteenth*.

### What adding a widget costs today, measured

Adding one widget currently means touching **four** places, only one of which is the widget:

1. a new entry in `macros/inline.ts` or `macros/block.ts`;
2. wiring it into the `DEFS` array in `registry.ts`;
3. **a new `case` in `MacroView.tsx`'s `switch (name)`** — because block payloads are
   dispatched to components by name, in a component, in `apps/web`;
4. a new block component under `components/pages/blocks/`.

Step 3 is the problem. It means **a widget is not addable inside `packages/pages`** — a pure,
I/O-free package — without editing a React component in the app, and it means the `default:`
branch renders `no renderer: <name>` for any widget someone forgets. The switch is a
hand-maintained duplicate of the registry: exactly the shape Invariant 5 exists to forbid,
and the same mistake `pageTools.ts` already avoids by deriving its tool schema from
`MACRO_NAMES`.

`InlinePayload = string` is the second problem, and the catalogue proves it rather than
asserting it: the design's own `w-person` renders as *chip, text, chip, text, chip, text* from
one binding. A display-ready string cannot carry that.

## Decision

### 1. A widget is one module that carries everything about itself

One file per widget, exporting a single object that satisfies a `WidgetDef` contract. Nothing
about a widget lives anywhere else — no switch case, no component registry, no second list.

```ts
interface WidgetDef<P, T> {
  name: string;                       // "day.stops" — stable, it is what a document stores
  title: string;                      // "A day's stops" — what the insert sheet lists
  shape: "single" | "block" | "repeat";
  description: string;                // human AND machine readable (insert sheet + AI tools)

  inputs: readonly WidgetInput[];     // ADR-035 decision 2 — what a control is chosen from
  params: z.ZodType<P>;               // the validator; the ONLY thing trusted at render time

  emptyText: string;                  // resolves to nothing
  preview: string;                    // the insert sheet's sample — see decision 5

  resolve(ctx: WidgetContext, params: P, item?: ItemScope): MacroResult<T>;
  render(payload: T): Rendered;       // decision 3 — data, never markup
}
```

`resolve` and `render` are deliberately **two functions, not one**. `resolve` answers "what
does this mean against the current trip"; `render` answers "what does that look like". Keeping
them apart is what lets the insert sheet show a preview without a trip, lets the AI path
validate without a DOM, and keeps `packages/pages` free of React.

### 2. Adding a widget means adding one file and one line

The registry is assembled from the modules; the modules are the source of truth. The test
that makes this real: **a registry-wide test asserts every widget has a renderer**, so
"forgot to wire it up" is a red test rather than a `no renderer:` chip discovered by a user.

This is the whole point of the ADR. If adding the fifteenth widget touches a component, the
model has failed regardless of how clean the types are.

### 3. `render` returns typed data. It can never return markup. This is the CSR protection

Reading "csr protections" as **client-side rendering safety** — what stops a stored document
from executing or injecting anything when it is rendered in a browser. (If CSRF was meant,
that is a different control and it lives on the write routes, not here; this path is a pure
function with no request in it.)

Four rules, and the first is the load-bearing one:

**a. The output is a closed union of data, never a string of HTML.** The existing C-era seam
already says this for blocks — *"block components consume resolver payloads (structured
data), never markup"* — and this generalises it and closes the gap that `InlinePayload =
string` left:

```ts
type Seg =
  | { kind: "text"; text: string }          // rendered as a text node
  | { kind: "chip"; name: string; text: string };  // rendered as a chip

type Rendered =
  | { kind: "inline"; segs: Seg[] }         // replaces InlinePayload = string
  | { kind: "block"; block: BlockPayload }
  | { kind: "rows"; rows: Seg[][] };        // a repeat: one segment list per item
```

React escapes text nodes by default, so a widget **cannot** emit an element, an attribute, a
URL or a script — not because it is asked not to, but because the type has nowhere to put one.
`dangerouslySetInnerHTML` is already absent from this path and a lint wall should keep it so.

**b. `params` is the only thing trusted, and it is validated before `resolve` sees it.**
`resolveMacro` already `safeParse`s and already has a `bad-params` path. A hand-edited
document, an AI-written one, or a page restored from an old version cannot hand a resolver a
shape it did not ask for.

**c. `resolve` is pure — no I/O, no clock, no randomness.** It reads the `TripDetail` the page
already loaded through a server-verified route. So opening a document can never cause a
request, and a document cannot be made to read a trip its reader cannot see: the resolver is
handed the data, it does not go and get it.

**d. An unknown widget name renders a visible, inert error chip.** Never blank, never the raw
name interpolated anywhere. Already true; keep it true, and cover it.

### 4. Insert is one derived command, not a UI action per widget

```ts
insertWidget(name: string, params: unknown): Result<MacroNode, InsertError>
```

It validates `params` against that widget's own schema and returns a node or a typed refusal.
**Three callers, one code path**: the insert sheet's *Insert it*, the assistant's
`insert_widget` (M14 link 8), and a template seeding a page with default bindings (link 7).

That is the invariant worth stating: **there is no way to put a widget into a document that
skips validation.** A second insert path is how a document acquires a node no resolver can
read.

### 5. A preview is a fixed sample, never a computed value

Carried from ADR-035 and §18, restated because it is a property of the *module*: a widget's
`preview` must not assert numbers the live widget computes, or the sheet and the page
contradict each other in one session. The design already does this — `w-person`'s preview is
*"Whoever you point it at — their stops, and their share so far"*, phrased generically on
purpose.

### 6. A widget may declare that it needs a field it does not have

`needs?: "needs a field"` — §7's one surviving picker rule, now a property of the module. The
sheet badges it and says so on click instead of claiming an insert. **Note the design's own
example is stale**: `Home airport` is flagged `needs a field` and M17 shipped
`users.home_airport`. The mechanism stays; that widget is no longer an instance of it.

## Consequences

- **`MacroView`'s `switch (name)` is deleted**, and with it the `no renderer:` branch. That is
  a real deletion in `apps/web`, not a new abstraction beside it.
- **`InlinePayload = string` widens to a segment list.** Every existing inline widget returns
  a one-segment list; the four current ones are mechanical to migrate. This is the only
  breaking change to the existing seven.
- **`MacroDef` becomes `WidgetDef`.** `resolve`'s signature gains the item argument ADR-035
  decision 4 already specified, and drops `PageContext` in favour of a `WidgetContext` that
  can also carry account scope — see open question 2.
- **Contract change**, so Invariant 5's protocol: its own PR, a changelog entry, consumers in
  the same PR.
- **`packages/pages` stays pure and React-free.** `render` returns data; `apps/web` owns the
  one component that maps `Rendered` to elements.
- **The cost of a new widget becomes one file plus one export line**, which is the thing
  being bought. Everything above is in service of that number.

## Open questions — Mitchell's, not a build's

1. **Can a widget own a whole sentence?** The document mock renders *"The day in a sentence"*
   — one name, one day binding, three chips and prose — but it is **not** in the insert list.
   Either it is a composite widget the list forgot, or it is an authored paragraph holding
   three separately-inserted widgets whose chrome row aggregates their binds. The first is
   simpler to build and store; the second is more expressive and makes "changing one binding
   re-renders that block" mean rewriting several instances at once. **This decides the
   document format**, so it should be settled before ADR-038 is accepted.
2. **Where does account scope come from?** Four widgets (your name, your email, home airport,
   every trip you have) read the *user*, not the trip, and `resolve` is handed only a
   `TripDetail`. Options: widen the context to `{ trip?, user? }`; or make account widgets a
   separate registry with its own context. Widening is fewer concepts and makes every resolver
   handle an absent trip; splitting keeps each registry honest and duplicates the machinery.
   I lean **widening**, because "a page can hold any widget" is the design's whole premise.
3. **Do the two person widgets get cut?** Per the catalogue: naming people is a cheap contract
   change, but attributing stops and money to people is a domain model — new fields, new
   events, a settle-up concept. **Recommend cutting both from the widget work** and scoping
   attribution separately, rather than blocking 19 widgets on 2.

## Alternatives rejected

- **Keep the switch and add cases.** It is the status quo, it costs one component edit per
  widget forever, and it silently degrades to `no renderer:` when someone forgets. The
  fifteenth widget is the one that proves this wrong.
- **Let widgets return HTML strings and sanitise.** Every sanitiser is a denylist that is one
  bypass from a stored-XSS in a document users share. The typed union has no bypass because it
  has no expressive power to abuse.
- **One giant `widgets.ts`.** Fine at 7, unreviewable at 21, and it makes every widget change
  a conflict on one file when several people are adding widgets at once.
- **Generate widgets from a schema/DSL.** Tempting for a catalogue this regular, and wrong
  this early: the resolvers differ in exactly the ways a DSL would flatten, and we have built
  three of the shapes rather than all four. Revisit once `repeat` exists and the twentieth
  widget is written.
