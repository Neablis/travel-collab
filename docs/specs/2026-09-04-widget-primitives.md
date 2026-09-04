# The widget primitives, their filters, and how you type one

**Status:** proposal, drafted 2026-09-04 alongside **ADR-039**, which carries the reasoning
and the decisions. This file is the vocabulary: what exists, what each thing takes, what a
preset is, and what you type.

Everything here follows one sentence from ADR-039 decision 1:

> A widget is a selection over one entity, plus a shape that decides its arity. Filters choose
> the set; `single` collapses it, `block` details it, `repeat` lists it.

## 1. The twelve primitives

`entity` is what the widget reads. `filters` are the dimensions that apply to it — each one
optional, and **absent means every member** (ADR-039 decision 2). "Wide" is what the widget
answers when nothing is filtered, which is what Mitchell's *"All at the top"* selects.

| Primitive | Shape | Entity | Filters | Wide (no filters) | Narrowed |
|---|---|---|---|---|---|
| `cost` | single | stop | day, city, tag, kind, person, dates | the trip's total, unscheduled included | the sum of the stops that match |
| `count` | single | stop / day / city | day, city, tag, kind, person, dates | how many there are | how many match |
| `dates` | single | day | day, city, dates | the trip's range, first dated to last dated | that day's date, or the range the filter leaves |
| `hours` | single | stop | day, city, tag, kind, dates | earliest start to latest end, trip-wide | the same over the stops that match |
| `city` | single | city | day, dates | every city the trip touches, in arrival order | the cities of the days that match |
| `day.detail` | block | day | day, city, tag, kind, dates | every day, one card each, under day headers | one day's card |
| `city.detail` | block | city | city, dates | every city, one card each, under headers | one city's card |
| `day.rows` | repeat | day | day, city, dates | one line per day | one line per matching day |
| `city.rows` | repeat | city | city, dates | one line per city | one line per matching city |
| `stop.rows` | repeat | stop | day, city, tag, kind, person, dates | every stop, grouped under day headers | the stops that match |
| `cost.rows` | repeat | stop | day, city, tag, kind, dates | a row per day, plus unscheduled, plus the total | the same over what matches |
| `attribute` | single | trip / account | — (takes `field`, see §3) | — | — |

Two rules that fall out of the table rather than being bolted onto it:

- **`block` with a wide selection is not a different widget.** `day.detail` unfiltered renders
  every day with a header per day — Mitchell's *"all would show you all days, with headers
  breaking up days"* — and filtered to one day renders one card. Same primitive, arity decided
  by the selection (ADR-039 decision 1).
- **`cost` wide equals `cost.trip` exactly**, because "every stop" includes the backlog, which
  is what `tripCostTotal` already counts. One number, one implementation, no second answer
  that can drift from the board's.

## 2. The filter dimensions

| Dimension | Values | Where the options come from | Today |
|---|---|---|---|
| `day` | All · Day 1 · Day 2 … | `TripDetail.days` | **works** |
| `city` | All · each city | `TripGlobals.cities` | **works** |
| `tag` | Every stop · meal · lodging · ticketed · outdoors | `ActivityTag` | **works** |
| `kind` | Anything · booked · hold · idea · transit · planned | `ActivityKind` | **works** — this is what absorbs `booking.line` |
| `dates` | All · a single date · a range | derived from day dates | **works** |
| `person` | All · each member · me | `TripDetail.members` | **declared only** — see below |

**`person` is vocabulary, not a capability, and the widget says so.** Two gaps, and they are
different gaps: `TripMember` is `{ userId, role }` with no display name, so an option list
built today would show ids; and no stop carries a person at all, so there is nothing for the
filter to narrow by. A primitive declaring `person` therefore renders ADR-037 decision 7's
*"needs a field"* state rather than offering a control that resolves against nothing. The
display name is a contract change; the stop's person arrives with M13 `add-stop-who` / M19
link 3. `person: "me"` — the filter that follows whoever is reading a shared page — is
recorded as intent in ADR-039 decision 7 and is an open question, not a plan.

## 3. `attribute`, and its allow-list

One primitive, one `field` param, validated against a closed list (ADR-039 decision 6). The
four that ship:

| `field` | Reads | Preset title |
|---|---|---|
| `trip.name` | `TripDetail.name` | The trip's name |
| `trip.budgetRemaining` | `TripDetail.budgetRemaining` | What's left of the budget |
| `account.name` | account preferences | Your name |
| `account.homeAirport` | account preferences | Your home airport |

The generic form is what the document stores; the allow-list is what keeps it from becoming a
field browser over internal state, and what makes a renamed contract field a failing test here
rather than a broken widget in someone's saved page.

## 4. Presets — and the same table is the migration

A preset is `(primitive, params, title, keywords)`. It is data, it is not stored in a
document, and retiring one migrates nothing (ADR-039 decision 4). Which is why this table
doubles as the map from the seventeen names documents carry today:

| Today's name | Becomes | Preset title |
|---|---|---|
| `trip.name` | `attribute{field: trip.name}` | The trip's name |
| `trip.dates` | `dates{}` | The trip's dates |
| `cost.trip` | `cost{}` | What the trip costs |
| `cost.day` | `cost{day: N}` | What a day costs |
| `budget.remaining` | `attribute{field: trip.budgetRemaining}` | What's left of the budget |
| `day.date` | `dates{day: N}` | A day's date |
| `day.city` | `city{day: N}` | A day's city |
| `day.window` | `hours{day: N}` | A day's first and last stop |
| `account.name` | `attribute{field: account.name}` | Your name |
| `account.homeAirport` | `attribute{field: account.homeAirport}` | Your home airport |
| `itinerary.day` | `day.detail{day: N}` | A day's stops |
| `itinerary.trip` | `day.detail{}` | Every day at a glance |
| `costs.table` | `cost.rows{}` | Costs, broken down |
| `day.line` | `day.rows{}` | A line for every day |
| `city.line` | `city.rows{}` | A line for every city |
| `booking.line` | `stop.rows{kind: booked}` | A line for every booking |
| `stop.line` | `stop.rows{}` | A line for every stop |

Presets worth adding that no widget covers today, all of them rows rather than code: *the
trip's total* (`cost{}`), *what today costs* per city (`cost{city}`), *how many stops are
booked* (`count{kind: booked}`), *everything on a day, booked only* (`day.detail{kind:
booked}`).

## 5. Typing one

`/` opens the picker at the caret; the first token is the widget query. **The first space
locks the highlighted row**, and every token after it is an argument.

```
/cost                → cost, nothing filtered (the trip's total)
/cost 3              → cost, day 3
/cost 3 meal         → cost, day 3, tag meal
/stops booked        → stop.rows, kind booked, every day
/itinerary "day 3"   → quotes accepted; same as /itinerary 3
/city tokyo          → city, filtered to Tokyo
```

Rules, and each exists because of a way this feature becomes something people switch off:

- **Arguments are matched, not positional.** Each token is offered to the primitive's filters
  in order and taken by the first that accepts it, so `/stops meal 3` and `/stops 3 meal` are
  the same insert. A bare number is a day; `all` is the explicit wide value.
- **An unparsable token closes the menu.** `/cost is what we tracked` stops being a widget at
  `is`. Without this the menu hangs open across a sentence.
- **The row shows what it will insert** (`Cost · Day 3`) and a hint line of what it accepts
  (`all · day N · meal|lodging|ticketed|outdoors`), so Enter is never a surprise.
- **The tokens become `params` and go through `insertWidget`.** A mistyped argument is the
  same typed refusal a bad param is today (ADR-037 decision 4) — there is still exactly one
  way a widget enters a document.

**Clicking still does everything typing does.** The chrome row is generated from the
primitive's declared filters — one control per dimension, including the ones you have not set
— so a widget already on the page shows every option it has. Both surfaces read one
declaration, so they cannot offer different things.

## 6. Findability

Search matches title, description and name today, as one substring. Three changes:

- **`keywords` on each preset** — `cost`: total, spend, price, sum, budget; `day.detail`:
  schedule, agenda, itinerary, plan; `stop.rows`: activities, things to do, hotel, flight.
- **Token matching** — every word in the query must match something, so "day cost" finds
  `cost`. Today it finds nothing.
- Filter values are searchable through their presets, which is how `/booking` still finds
  something after `booking.line` stops existing.

## 7. The ghost seam

`MacroResult` gains `sample` — the same payload as `ok`, flagged provisional (ADR-039
decision 8). A widget with nothing bound answers with its sample rather than `unbound`, and
the slash menu resolves pending params on each keystroke through the same resolver, so a
preview refines as it is typed.

**Rendering the ghost is next milestone's polish, deliberately.** What ships here is the
status, the samples as payloads, and the fact that nothing downstream has to change to paint
them: renderers take a payload and do not ask where it came from.

## 8. Order of work

1. ~~Primitives, filters and the legality matrix, with the registry-wide test that keeps
   declared filters and params in step.~~ **Built, 2026-09-04.** Eleven primitives (the
   twelve above minus `attribute`, which is step 2) are registered; the six dimensions and
   their value shapes are in `packages/contracts/src/pages.ts`; `LEGAL_FILTERS` in
   `packages/pages/src/filters.ts` is the matrix, and `packages/pages/src/select.ts` is the
   one implementation of the selection all eleven read. See below for what phase 1
   deliberately did **not** do.
2. `attribute` and its allow-list.
3. The migration from the seventeen names, and presets built from the §4 table.
4. The slash grammar and `keywords`.
5. `sample` as a status; ghost rendering next milestone.

### What phase 1 left for the phases after it, on purpose

- **The primitives are registered but not browsable.** `macroCatalog()` — which the slash
  menu and the insert popover read — still lists the seventeen named widgets. That is
  ADR-039 decision 5 rather than staging: *"the combination space is not the browsable
  list; the preset list is"*, and the presets arrive in step 3 with the migration that
  retires the seventeen. Until then the primitives are reachable through `insertWidget`,
  `resolveMacro` and `renderMacro`, and every registry-wide test sweeps them.
- **`city`, `kind` and `dates` have no control yet.** They are declared `WidgetInput`s, so
  §5's *"both surfaces read one declaration"* holds the moment a control exists;
  `bindableInputs` in `apps/web` renders `day` and `tags` and drops the rest, which is the
  picker work of steps 3 and 4.
- **The chrome row's day select still says "Not set up" for an unset day.** For a NAMED
  widget that is still true — `cost.day` with no day is unbound — and relabelling it "All
  days" before the migration would make the control contradict the resolver behind it.
- **`person` renders "needs a person field" and never filters** (decision 7). That is the
  finished behaviour for this phase and for every phase until the field exists.

### Two rules phase 1 had to settle that the table above does not state

- **A stop's city is its own, falling back to its day's.** By the stop's own `location.city`
  alone, an unlocated lunch on a Tokyo day vanishes from `cost{city: Tokyo}` and the widget
  under-reports money; by its day's cities alone, the Kyoto hotel booked on the Tokyo→Kyoto
  travel day counts as Tokyo. A located stop is where it says it is, and an unlocated one is
  where its day is — which is also how a person reads the board.
- **An absent day filter is every day; a day filter aimed at a deleted day is `unbound`.**
  Decision 2 retires `unbound` for a filter *left alone*. A stale ref is not left alone, and
  widening it would turn `cost{day: 100}` into the trip total the moment day 100 was
  removed.
