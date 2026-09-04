# ADR-039: A widget is a selection over one entity, not a name

**Status:** **Accepted — 2026-09-04.** Written from Mitchell's preview comment and the
conversation that followed it; the three questions it left open were answered the same
evening and are recorded inline (decisions 6, 7 and 8). This said *"acceptance is kicking off
the implementation branch against it"*, and phase 1 of the spec's §8 order of work — the
primitives, the filter vocabulary and the legality matrix — is built. Phases 2-5 follow in
the order §8 gives, and §8 now records what phase 1 deliberately left to them.
**Deciders:** Mitchell (product/eng); Claude (architect) — drafted
Related: **ADR-035** (a widget is a function of declared inputs — still true; this says what
the inputs *are*), **ADR-037** (a widget is a module, and rendering never produces markup —
still true; this reduces how many modules there are), ADR-038 (the document is a versioned
AST — which is what makes the migration below a migration rather than a break)
Spec: `docs/specs/2026-09-04-widget-primitives.md` — the primitives, the filters, the
preset/migration map and the slash grammar

## Context

Mitchell, on the preview (2026-09-04), pointing at `cost.day`'s day select:

> Whats simplify some of these tools, when posible where we have a tool that you can select a
> day, it can also select All at the top, and it gives you a sum, or whatever makes sense in
> that context. […] For Cost, it would show a single days cost, or if all would sum full trip.

And then, on the shape of the fix:

> lets build a repeatable system, thats easy to extend and has rules for what makes a widget,
> and everything follows the rules.

**The registry holds seventeen widgets, and four of them are the same widget written twice.**
That is not a code-review opinion; it is what the pairs say out loud:

| These two | Differ only by |
|---|---|
| `cost.day` / `cost.trip` | whether the day filter is set |
| `itinerary.day` / `itinerary.trip` | whether the day filter is set |
| `day.date` / `trip.dates` | whether the day filter is set |
| `stop.line` / `booking.line` | whether stops are filtered to `kind === "booked"` |

We did not design seventeen widgets. We enumerated a cross product by hand and wrote some
cells twice. The catalogue's own input column shows it from the other side: `w-total`,
`w-itin`, `w-costs` and `w-dayline` are all specified as taking `days`, and all four were
built narrower than specified.

The cost of that is not the duplication. It is that **the seventeenth widget is written by
hand too**, and that every cell of the product needs a person to notice it is missing.

### The bug this already caused

`itinerary.trip` rendered by stacking a whole `itinerary.day` card per day — a list of lists —
until it was rewritten on 2026-09-04 as the design's day table. That defect is this ADR's
thesis in miniature: nothing in the model said what a block widget does when its selection
holds *many* members, so a widget answered it locally, and wrongly.

## Decision

### 1. A widget is a selection over one entity, plus a shape that decides its arity

```
widget = entity + filters + shape
```

- **entity** — what the widget is about: `day`, `stop`, `city`, `trip`, `account`.
- **filters** — a set of `{dimension: value}` narrowing that entity's set. Dimensions:
  `day`, `city`, `tag`, `kind`, `person`, `dates`.
- **shape** — how the set is presented, and this is what decides arity:
  - `single` **collapses** the set to one value (a sum, a span, a count, a joined list);
  - `block` **details** it — one member renders one card, many members render one card per
    member under headers;
  - `repeat` **lists** it as rows.

Every widget in the registry is an instance of that sentence, and so is every widget anyone
adds later. `itinerary.trip`'s bug is a type error in this model: "block with a set of many"
has one defined answer, written once.

### 2. A filter left alone means *everything*, and "All" is a value, not a mode

Mitchell's "All at the top" is the absent value made visible. `tags` already worked this way —
ADR-037 decision 9, §18's *"every stop, or one"* — and this generalises it to every dimension.

**This retires `unbound` for filters.** A day widget with no day chosen is not waiting for a
choice; it is showing every day. `MacroResult`'s `unbound` survives only for `trip` (a
notebook with no trip is a real absence, not a wide selection).

**It amends ADR-037 decision 6** (*"never a default day"*), and the amendment is narrow: that
decision forbids **guessing** — defaulting to day 1 when the author meant day 4. "All" guesses
nothing. It is the widest true answer, and it is the one default that cannot be wrong about
what the author meant.

### 3. Legality is declared, never assumed

The cross product contains cells that mean nothing: the hours of a city, the names of every
stop on a trip as one sentence. So each primitive declares **which entity it reads and which
filter dimensions apply to it**, and:

- the picker offers only combinations that are legal;
- `insertWidget` refuses the rest, with the same typed refusal it uses for bad params today.

This is the wall that makes "everything follows the rules" a type error rather than a
convention, and it is the actual design work in this change.

### 4. A named widget is a preset — data, not inheritance

"A line for every booking" stays in the picker as `stop.rows` with `kind: "booked"`. A preset
is a `(primitive, params, title, keywords)` row. There is no inheritance chain, no defaults
that override other defaults, and **no preset is stored in a document** — the document stores
the primitive and its filters, which is what it stores today.

Two consequences worth having on purpose:

- Renaming, adding or retiring a preset **never migrates a document**. Only the primitive
  vocabulary can, and it changes far more rarely than the list of things worth naming.
- Rebinding a preset away from its params is not an error state. It is just the general
  widget, which is what it always was.

### 5. Several routes reach the same value, and that is correct

`cost` with an empty day filter and `cost` with an empty city filter are both the trip total.
One truth, several paths. The combination space is therefore not the browsable list; **the
preset list is**, and keeping it human-sized is a curation job, not a modelling one.

### 6. `attribute` is one primitive over an allow-listed field vocabulary

Mitchell, 2026-09-04:

> more attribute as a generic in the ast, but defined / allow listed / hard coded to common
> sense values for usability today in the ui

So `trip.name`, `budget.remaining`, `account.name` and `account.homeAirport` become one
`attribute` primitive whose `field` param is validated against a closed list, surfaced in the
UI as the four presets people actually want. The generic form is what the AST stores; the
allow-list is what stops it becoming a field browser over internal state, and what keeps a
renamed contract field from silently becoming a broken widget in a saved page.

### 7. `person` and `dates` are declared now; `person` cannot filter yet, and says so

Mitchell, 2026-09-04:

> Declare in vocabulary now, we can even just hook them up to list people invited to trip, but
> plan to add that as a real future feature, around filter on people (or current user so it
> changes whos logged in as its shared) in the future

Declared. What is honest about the state of the data, stated plainly so nobody builds on a
capability that is not there:

- **`dates` is real today.** Days carry dates, so a date-range filter over days and stops
  resolves against data that exists.
- **`person` has two gaps, not one.** `TripMember` is `{ userId, role }` with **no display
  name**, so an option list built from trip members today lists ids; and **no stop carries a
  person** — there is no assignee, payer or participant on `ActivityView` — so the filter has
  nothing to narrow by. The first gap is a contract change; the second arrives with M13's
  `add-stop-who` / M19 link 3.
- Therefore a widget declaring `person` renders ADR-037 decision 7's **"needs a field"** state
  rather than a control that resolves against nothing. The vocabulary exists so the shape is
  settled; the capability lights up when the field does.
- **`person: "me"` is the recorded intent** for the current-viewer case, and it carries a
  design question this ADR does not settle: a shared page whose widget says something
  different to each reader is a genuinely new thing for this product. Recorded, not decided.

### 8. Progressive resolution: the seam now, the ghost next milestone

Mitchell wants a widget to render *something* from the moment it is typed, refining as filters
arrive — `/cost` showing a ghosted `$xxx` before it shows a number. His call on timing:

> Ghost in next milestone as we make the widgets better and more useful, its polish, lets nail
> the syntax and usability first

So this change builds **the seam and not the paint**: `MacroResult` gains a fourth status,
`sample` — the same payload type as `ok`, flagged provisional. Renderers do not change; they
already turn a payload into segments and do not care where it came from.

Why now rather than with the polish: ADR-037 decision 5 already requires every widget to carry
a fixed sample (*"a preview is a fixed sample, never a computed value"*), so the samples exist
— they are strings in the catalogue instead of payloads. Making them payloads while the
resolvers are being rewritten is a field; making them payloads afterwards is a second pass
over every primitive.

### 9. One migration, once

Existing documents store the seventeen names. A `PageDoc` migration maps each to
`(primitive, params)` — `cost.trip` → `cost` with the day filter absent, `booking.line` →
`stop.rows` with `kind: "booked"`, and so on. ADR-038 made the document a versioned AST for
exactly this, and the map is the preset table in the spec, which means the migration and the
picker are generated from one list rather than two.

## Consequences

**Easier.** Adding a *capability* (a new measure, a new filter dimension) is a module and a
row in the legality matrix. Adding a *named widget* is a row of data with no code at all —
which is the case that actually happens weekly.

**Harder, and accepted.** The legality matrix is real work and it is the part that can be got
wrong quietly; it needs a registry-wide test in the shape of the ones that already guard the
input/params correspondence. And a person reading `packages/pages` will no longer find
"the cost of a day" as a file — they find `cost`, and the day is a filter. That is a genuine
loss of grep-ability, paid once, against a cross product that no longer has to be typed out.

**Unchanged.** ADR-037's module contract, the CSR protection (`Seg` is still a closed union of
data), the one insert command (decision 4), and the fact that colour is decided in `apps/web`
and never crosses the resolver seam (decision 1).

## Open questions

1. **`person: "me"` on a shared page** — decision 7's recorded intent. Does a widget that
   resolves per-reader belong in a document two people are reading together?
2. **Whether the picker shows the general primitives at all**, or only presets. Presets are
   what people search for; the general form is what the chrome row edits after insertion.
3. **Grouping in `cost.rows`** — by day is what `costs.table` does today; by city or by tag is
   free from existing projections and would be a second dimension on one primitive rather than
   two more widgets.
