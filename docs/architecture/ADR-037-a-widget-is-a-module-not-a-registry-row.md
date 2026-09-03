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
**Five callers, one code path**: click-to-insert in the sidebar, drag-and-drop, the slash
menu, the assistant's `insert_widget` (M14 link 8), and a template seeding a page with default
bindings (link 7).

That is the invariant worth stating: **there is no way to put a widget into a document that
skips validation.** A second insert path is how a document acquires a node no resolver can
read — and with five entry points that is no longer a hypothetical.

**The insert surface is a sidebar, not the Sheet §18 specifies** (Mitchell, 2026-09-03):

> definitely side bar and drag in or click insert and it puts the widget inline at cursor
>
> [slash] definitely in, shortcut for sidebar

So: a **persistent sidebar** listing widgets; **click inserts at the cursor**; **drag drops
one where it lands**; and **`/` opens the same list inline** as a shortcut. All four are the
same command above with a different origin.

Three things that follow, and the third is a real constraint:

- **This supersedes §18's two-step Sheet.** The design says *"Insert is two steps in one
  Sheet"*; the build is doing something else on Mitchell's decision. `DRIFT.md` should record
  it so the next design pass reconciles rather than re-specifying a Sheet.
- **Binding moves entirely to the chrome row.** With no modal step, *Point it at* has nowhere
  to live at insert time — which is exactly why decision 6's "renders not set up" is load
  bearing rather than defensive. Insert, then point it.
- **Slash reverses an M8 decision and must be acknowledged, not slipped in.** M7 shipped `{{`
  autocomplete; M8 removed macro authoring from the editor and there is a test named *"offers
  no macro autocomplete"* (`PageEditor.test.tsx`) plus a comment in `MacroNodeExtension`
  explaining the atom is inline so `{{` could work anywhere. A slash menu is a different
  gesture with a different guarantee — **it inserts a validated node, it never lets anyone
  type macro syntax** — so §7's "users never see or type macro syntax" survives. That
  distinction is the whole reason this is allowed, and it should be written at the site rather
  than left for someone to rediscover when they delete the M8 test.

### 5. A preview is a fixed sample, never a computed value

Carried from ADR-035 and §18, restated because it is a property of the *module*: a widget's
`preview` must not assert numbers the live widget computes, or the sheet and the page
contradict each other in one session. The design already does this — `w-person`'s preview is
*"Whoever you point it at — their stops, and their share so far"*, phrased generically on
purpose.

### 6. Every widget renders in every state, including "not set up"

Mitchell, 2026-09-03:

> every widget should be able to render with no inputs, that doesn't mean common sense
> defaults, just means it can render like "not set up" so it doesn't crash if the underlying
> data changes to something incorrect

**"Not set up" is a first-class rendered state**, not an error path and not a fallback. A
widget with nothing bound, or bound to something that has since been deleted, renders a
placeholder saying so — legibly, inertly, and without taking the page down with it.

The critical half is the middle clause: **not common-sense defaults.** A widget pointed at a
day that no longer exists must say "not set up"; it must **not** quietly resolve to day 1.
That is already the established behaviour and it is tested — one of link 2's red-first breaks
was literally `if (!ref) return detail.days.length > 0 ? 0 : null` (an unbound widget guessing
day 1), made to fail on purpose. Silently rendering the wrong day is worse than rendering
nothing, because nothing about the page tells the reader it happened.

Three requirements follow, and only the first exists today:

**a. `resolve` is total.** Already enforced per-macro by
`registry.property.test.ts` — *"never throws, always ok|empty|unbound"*, generated over
arbitrary trips and params. Because that test iterates `MACRO_NAMES`, **a new widget inherits
the property the day it is registered**, which is exactly the "we can easily add more" goal.
Keep that iteration; never hard-code the list.

**b. `render` must be total too, and today nothing says so.** ADR-037 splits resolve from
render, so a total `resolve` feeding a `render` that throws on an odd payload still takes the
page down. The property test must be extended to run `render` over every state `resolve` can
return, not just to check `resolve`'s tag.

**c. `unbound` has to stop being day-shaped.** It is `{ status: "unbound"; needs: "day" }` —
a literal, from when `day` was the only input. With five input types it becomes
`needs: WidgetInput["type"]` (or the input's `name`, so a two-input widget can say *which* of
the two is missing — `w-stopline` takes a day **and** tags). Without that, "not set up" cannot
name what is not set up.

**Consequence for insert:** a widget may be inserted with nothing bound. That makes *Insert
it* legal from the sidebar without visiting the bind step at all — the widget lands, says "not
set up", and the chrome row is where you point it. This is a deliberate softening of §18's
two-step flow and it is what makes drag-to-insert coherent: you cannot fill in a bind step
mid-drag.

### 7. A widget may declare that it needs a field it does not have

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

1. **Asked badly the first time. Re-asked with examples**, since "can a widget own a whole
   sentence?" read as "can a widget render more than one word" — which is settled and is a
   yes (decision 3's `Seg[]`, and §18's own `w-person` renders three chips and prose from one
   binding).

   The actual ambiguity is **how many bindings a sentence has**. Both of these render
   identically on the page:

   > It's **Fri Sep 25** and you're in **Hakone**. **$310** of the budget is spoken for today.

   **Reading A — one widget, one binding.** You insert *"The day in a sentence"* and point it
   at Day 6. One node in the document. The chrome row shows one control:
   `[The day in a sentence] [Pointed at: Day 6 ▾]`. Re-pointing at Day 7 is **one** change and
   all three chips follow. But the prose is the widget's: you cannot change "and you're in" to
   "and we're in".

   **Reading B — three widgets in prose you typed.** You type `It's `, insert *A day's date*
   → Day 6; type ` and you're in `, insert *A day's city* → Day 6; and so on. Three nodes,
   three params, three bindings. The words are yours to edit. But re-pointing the sentence at
   Day 7 means changing **three** controls, and the chrome row has to either show three or
   aggregate them and rewrite three nodes at once.

   **The trade is authorability against one-control rebinding**, and the design shows both:
   `w-daydate` and `w-daycity` are separately insertable (B), while `w-person` is a listed
   widget rendering three chips from one binding (A).

   **My read: both exist, and that is fine** — A for widgets that ship a sentence, B for chips
   dropped into your own prose. Which leaves one genuinely open sub-question:
   **what does the chrome row do when one block holds several separately-bound widgets?**
   Three stacked rows is noisy; aggregating "these three all read a day" into one control is
   nicer but means one interaction rewrites three nodes. I lean **one row per block listing
   each bound widget**, because aggregation invents a grouping the document does not store.
2. ~~**Where does account scope come from?**~~ **SETTLED — Mitchell, 2026-09-03.**

   > notebooks are always account scope, they can access data from account like your name,
   > tier, etc. notebooks can be optionally account scoped, but that's today assigned on
   > creation. the creation of a notebook based on what trip initiated it locks the trip it
   > operates on.

   So `WidgetContext` is **`{ user, trip? }`** — the user is *always* present, the trip is
   present when the notebook was created from one and is **fixed at creation**. That is why
   `PageContext` keeps `tripId` and why it is not rebindable: a notebook's trip is not a
   binding, it is a property of the notebook.

   Two consequences a build must not miss:
   - **Every resolver must handle an absent trip**, because root-account notebooks are the
     stated direction even though they are out of scope today. A resolver that assumes a trip
     is a resolver that has to be rewritten when they arrive.
   - **Account widgets are in scope now.** Your name, your email, home airport and tier all
     become buildable — home airport because M17 shipped the field, tier once billing lands
     (M20/M21). `resolve` reading `user` is what unblocks them.

   Root-account notebooks (no trip, a different widget set) are **explicitly out of scope**.
3. ~~**Do the two person widgets get cut?**~~ **SETTLED — Mitchell, 2026-09-03: no, they are
   in this milestone**, and `persons` (plural) with them.

   That overrides the catalogue's recommendation, and the reason it recommended cutting still
   has to be paid for rather than wished away: **nothing links an activity to a person.** So
   the milestone owes an attribution model — what a person is "in for", what they booked,
   what they owe — before those two widgets can resolve anything. That is a domain change with
   events behind it, not a resolver.

   **This is the largest single item the widget work now carries**, and it should be costed as
   its own link rather than absorbed into "build the widgets".

4. **NEW, and the biggest one — a generic attribute widget over "trip globals".** Mitchell,
   2026-09-03:

   > I'm hoping we have some list of project level objects that can be generically rendered.
   > for instance if a city shows up in the day, we would have just a trip attribute widget,
   > and it would have all those trip globals, including all the cities so I can do
   > `{{trip.cities[Tokyo].activities.length}}` and it renders 15 or something like that, and
   > a developer adding a new global attribute gets it for free

   **The goal is right and it is the most valuable idea in this ADR**: a developer adding a
   trip attribute should get a widget for free, rather than someone hand-writing a module per
   field. Twenty-one hand-written widgets is a catalogue; a generated surface is a system.
   Worth taking seriously.

   **The `{{…}}` syntax is the part I would push back on**, for three reasons that are about
   this repo specifically rather than taste:

   - **It reintroduces exactly what §7 forbids and M8 removed.** *"Users never see or type
     macro syntax"* is a design rule, and M8 deleted macro authoring from the editor to honour
     it. A path expression in a document is macro syntax with a different bracket.
   - **It has no declared inputs, so it breaks ADR-035** — the accepted model where the input
     *type* picks the control. A freeform string has no type to pick from, so it gets no
     control, no *Point it at*, no `needs a field` badge, and no preview.
   - **It cannot satisfy decision 6.** `{{trip.cities[Tokyo].activities.length}}` on a trip
     that no longer visits Tokyo has to render "not set up" — which means the evaluator must
     know that `cities[Tokyo]` is a *lookup that can miss* rather than a property access that
     returns `undefined` and then throws on `.length`. A string parser cannot distinguish
     those; a typed path can.

   **A counter-proposal that keeps the goal and drops the syntax:** one `trip.attribute`
   widget whose input type is `attribute`, and whose control is a searchable select over a
   **generated manifest** of readable paths. The stored param is structured, not a string:

   ```ts
   { object: "trip", collection: "cities", key: "Tokyo", field: "activities.length" }
   ```

   A developer adding a trip attribute extends the manifest — ideally derived from the
   contract schema — and it appears in the picker for free, which is the actual requirement.
   No user-facing syntax; a real control; validated params; a closed set, so "not set up" is
   expressible and there is no evaluator to sandbox.

   **The genuinely valuable prerequisite either way** is the *"trip globals"* projection
   itself: a uniform view exposing days, cities, people, tags and bookings as addressable
   collections. **Cities do not exist as data today** — they are derived from
   `Location.city` on activities via `cityFor()` — so `trip.cities` has to be built before
   anything can address it. That projection is worth doing on its own merits and is what makes
   half the catalogue cheap.

   **Mitchell's call**, and it changes the shape of the milestone either way: the manifest
   approach is more machinery up front and much less per widget afterwards.

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
