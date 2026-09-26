# Widgets as the build has them — main @ 7892bed (2026-09-25)

Source: `packages/pages/src/{registry,presets,templates,repeat,filters,sentence}.ts`,
`apps/web/src/components/pages/blocks/*`. The design's insert rail now lists exactly these
presets, under the same ids.

## The model in four lines

1. **A widget is a primitive + filters + a shape** (ADR-039). ~20 primitives; a page stores
   `{ name: primitive, params }`.
2. **A preset is a named combination** (`count` + `{ kind: "booked" }` = "How many are
   booked"). Presets are what people browse; they are never stored, so renaming one migrates
   nothing.
3. **Filters narrow a selection**: `day`, `dates`, `city`, `tag`, `kind` (not `person`, removed
   for now). Legal per entity — stop: all; day: all but person; city: day/city/dates;
   trip/account: none. **Unbound means everything**, so every widget reads on insert and is
   narrowed afterwards in the settings panel.
4. **Three shapes**: `single` (inline, sits inside a sentence), `block` (a table/card/chart on
   its own line), `repeat` (a line per item). Every widget node is an inline atom, even blocks.

## The catalogue (31 presets)

| Preset | Primitive + params | Shape | Reads as |
|---|---|---|---|
| What it costs | `cost` | single | `$1,240.00` · *no costs yet* |
| How many stops | `count` | single | `47 stops` |
| How many are booked | `count {kind: booked}` | single | `12 booked` |
| How many days | `count {of: day}` | single | `14 days` |
| How many cities | `count {of: city}` | single | `5 cities` |
| The dates | `dates` | single | `Fri 25 Sep – Sun 4 Oct` · *no dates set* |
| How long until it starts | `attribute {trip.countdown}` | single | `in 34 days` / `day 6 of 14` / `ended 3 days ago` |
| Start and end times | `hours` | single | `9 am – 9:30 pm` |
| Which cities | `city` | single | `Tokyo – Kyoto` |
| A stop's detail | `field` (+ a manifest field) | single | any stop field; lands asking *choose a field* |
| The trip's name / What's left of the budget / Your name / Your home airport | `attribute {field}` | single | one fact |
| The days, in detail | `day.detail` | block | a card per day, every stop |
| The days, bookings only | `day.detail {kind: booked}` | block | booked stops per day, empty days skipped |
| The cities, in detail | `city.detail` | block | a tinted row per city: *Day 1, 2, 3* · *N stops* |
| A sentence for each… | repeat over `day.rows` / `stop.rows` / `city.rows` | repeat | an authored sentence with `{field}` tokens, once per item |
| A line for each… | `day.rows` (picker moves it to stop/city rows) | repeat | a table line per item; `stop.rows` takes extra **columns** |
| A line for every booking | `stop.rows {kind: booked}` | repeat | time + cost per booking |
| Still to book | `stop.rows {only: needsBooking}` | repeat | same rule as Calendar's *N to book* |
| Know before you go | `country.facts` | block | a card per country: plugs, driving side, calling code, emergency numbers, currency, tipping |
| Trip strip | `trip.strip` | block | one band, a cell per day in its city colour, city named over each stay |
| Spend by day | `cost.chart` | block | Recharts bars per day against the budget |
| Budget burn-down | `cost.chart {view: burndown}` | block | same chart as remaining-after-each-day |
| Spend by kind | `cost.byKind` | block | a donut per kind (Planned / Pending / Travel) and a key of amount + share + total; *no costs yet* |
| Sunrise and sunset | `day.sun` | repeat | per day: sunrise · sunset · golden hour |
| Time difference from home | `day.fromHome` | single | `Tokyo is 16h ahead of home` |
| Weather | `day.weather` | block | a fixed-height row per (day, city): mode in words, temps, rain; one credit + as-of footer; quiet when down |
| Costs, broken down | `cost.rows` | repeat | each day's spend, and the total; *nothing priced yet* |
| What needs you | `open` | repeat | overlaps, empty days, parked ideas; *nothing is waiting on you* |

## How they are used

- **Insert**: rail (drag or click), `/` slash menu, the phone sheet, and the assistant (which
  composes primitives directly). One-step: it lands, then binds in the settings panel.
- **Editing vs Reading**: ghosts (the shape of the value) in Editing only; Reading shows the
  short empty text (*no dates set*). Every widget shows in Editing exactly as it will read.
- **Empty trip rule** (templates.ts): a *seeded* page may only carry widgets that read well on
  an empty trip — which today is just `open`.
- **Save as a template** (link 10): a page snapshot, personal, re-pointed to whatever trip uses it.

## Templates the build ships today

| Template | Seeded? | What's in it |
|---|---|---|
| Overview | **every trip, undeletable** | name — countdown; dates · days · stops · cities; *What needs you*; *Where it goes* (city.detail); *day by day* (day.detail); *What's booked*; spent / budget left + cost.rows |
| Trip Overview | gallery | prose prompts only |
| Day overview | gallery | prose prompts only |
| A day in detail | gallery | hours + cost sentence, day.detail, booked rows, holds |
| Full trip breakdown | gallery | dates, counts, city.detail, day.detail, budget, cost.rows, spend by kind |
| Dinner tracker | gallery | `tag: meal` — counts, booked / hold / idea rows, cost |
| Bookings | gallery | booked count, booked rows, lodging, transit, holds, paid cost |
| Before you go | gallery | home airport + dates sentence, document & packing bullets, day-1 bookings, budget |

## Where the design and build still differ

- The build's templates don't use any M14 link-11 widget yet (weather, strip, sun, country
  facts, chart, still to book, countdown is used only in Overview).
- Several templates still filter `kind: hold` / `idea` — under SPEC §36.9's three kinds those
  are **Pending · to book** and **Pending · maybe**.
- The design had *Everyone on a trip*, *Your email* and *A line for every trip you have*; the
  build has none — removed from the design's rail.
