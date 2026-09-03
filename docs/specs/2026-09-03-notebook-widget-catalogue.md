# The notebook widget catalogue — what the design shows, and what it would really cost

**Written 2026-09-03**, from the design rather than from memory. Source of record for
*what widgets exist as a design intent*; `packages/pages/src/registry.ts` is the source of
record for what exists in code. Companion to **ADR-037** (how a widget is built) and
**ADR-038** (how a page is stored).

## Where these came from

Not SPEC prose. The authoritative list is a **structured array in the design canvas** —
`.design-sync/handoff/design/Trip Planner Redesign.dc.html`, the `WIDGETS = [...]` block
(around line 4932) — where each entry already carries an id, a shape, a title, a body, a
resolved preview and **its declared inputs**. SPEC §18 describes the model; the canvas
holds the data. Anyone extending this should edit from the canvas, not from §18.

**21 widgets are listed.** A 22nd is *shown in the document mock but absent from the list* —
see "The unlisted twenty-second" below, which is a real discrepancy and not a transcription
slip.

## The shapes

The canvas uses three, and they map onto `MacroKind` plus the one ADR-035 adds:

| Canvas `kind` | Reads as | Code |
|---|---|---|
| `single` | "one value" | `kind: "inline"` |
| `block` | "a block" | `kind: "block"` |
| `repeat` | "repeats" | `kind: "repeat"` — **does not exist yet** (ADR-035 decision 4) |

## The five input types

`day` · `days` (a stretch) · `person` · `tags` · `trip`. Landed as declarations in
`WidgetInput` (M14 link 3). **Nothing reads them yet** — links 4 and 5 do.

## The catalogue

Verdicts: **✅ buildable now** · **⚠️ needs a contract change** (data exists, the read
model does not carry it) · **❌ needs a domain concept** (the data does not exist anywhere).

### Account scope — reads the signed-in user, not a trip

| id | Title | Shape | Inputs | Verdict | What it reads |
|---|---|---|---|---|---|
| `w-you` | Your name | single | — | ⚠️ | `users.name` / `users.displayName` both exist. Not in `TripDetail` — account scope needs a source the resolver does not currently get |
| `w-email` | Your email | single | — | ⚠️ | `users.email` exists, same problem |
| `w-air` | Home airport | single | — | ✅ | **The design's `needs a field` flag is STALE.** `users.home_airport` shipped in M17 |
| `w-trips` | A line for every trip you have | repeat | — | ⚠️ | Needs the trip *list*, plus `repeat` |

**The account-scope problem is one problem, not four.** `resolve(detail, ctx, params)` is
handed a `TripDetail` and nothing else. Every widget above needs a second source. That is a
contract-and-signature decision — see ADR-037's open question 2.

### Trip scope

| id | Title | Shape | Inputs | Verdict | Notes |
|---|---|---|---|---|---|
| `w-name` | Trip name | single | `trip` | ✅ | Exists as `trip.name`. Note the design gives it a **`trip` input**; the built one takes none, because a page is already trip-bound |
| `w-dates` | Trip dates | single | `trip` | ✅ | Exists as `trip.dates`; same input discrepancy |
| `w-left` | Budget left | single | `trip` | ✅ | `TripDetail.budget` + `budgetRemaining` |
| `w-people` | Everyone on a trip | block | `trip` | ⚠️ | `members` is `{ userId, role }` — **no display name**. Needs `TripMember` to carry one |
| `w-cityline` | A line for every city | repeat | `trip` | ✅ | City is derivable — `Location.city`, and `cityFor()` already exists in `DayChips.tsx`. Needs `repeat` |

### Day scope

| id | Title | Shape | Inputs | Verdict | Notes |
|---|---|---|---|---|---|
| `w-daydate` | A day's date | single | `day` | ✅ | |
| `w-daycity` | A day's city | single | `day` | ✅ | Derived via `cityFor()`; optional — a day with un-geocoded stops has no city, so it needs an empty case |
| `w-dayends` | First and last stop | single | `day` | ✅ | `timeWindow` |
| `w-daystops` | A day's stops | block | `day` | ✅ | Exists as `itinerary.day` |
| `w-stopline` | A line for every stop | repeat | `day` + `tags` | ✅ | Tags are real (`ActivityTag`). **The only two-input widget**, so it is the one that proves the model |
| `w-bookline` | A line for every booking | repeat | `day` | ✅ | "Booking" = `ActivityKind === "booked"`; that enum already has it |

### Stretch scope (`days`)

| id | Title | Shape | Inputs | Verdict | Notes |
|---|---|---|---|---|---|
| `w-total` | Cost of a stretch | single | `days` | ✅ | Generalises `cost.day` |
| `w-itin` | Days at a glance | block | `days` | ✅ | `itinerary.trip` narrowed to a range |
| `w-costs` | Cost breakdown | block | `days` | ✅ | `costs.table` narrowed to a range |
| `w-dayline` | A line for every day | repeat | `days` | ✅ | Needs `repeat` |

### Person scope — **the one real hole**

| id | Title | Shape | Inputs | Verdict | Notes |
|---|---|---|---|---|---|
| `w-person` | What one person is in for | single | `person` | ❌ | |
| `w-personline` | A line for everything one person booked | repeat | `person` + `days` | ❌ | |

**Nothing links an activity to a person.** Checked: no `assignee`, `paidBy`, `participant`
or `share` on `ActivityView` or the payload fields. So "their stops, and their share so
far" is not a widget that needs writing — it is a **domain concept that does not exist**.

The person hole has two halves and they cost very differently:

1. **Naming people** — `users.name` / `displayName` exist; `TripMember` does not carry them.
   A contract change plus a join. Cheap, and it unblocks `w-people` too.
2. **Attributing stops and money to people** — new fields, new events, new conflict
   surface, a split/settle model. **This is a milestone, not a widget.** It is also what
   `w-person`'s preview quietly admits: *"Whoever you point it at — their stops, and their
   share so far"* is phrased generically, per §18's rule that a preview must not assert
   numbers the live widget computes.

**Recommendation: cut both person widgets from the widget work and scope the attribution
model separately.** Building 19 of 21 is a feature; blocking 21 on a settle-up model is not.

## Tally

| | Count |
|---|---|
| ✅ buildable now | **13** |
| ⚠️ needs a contract change (data exists) | **6** |
| ❌ needs a domain concept | **2** |
| Already in the registry | **7** — and two of those (`trip.name`, `trip.dates`) differ from the design on inputs |
| Need `kind: "repeat"` first | **6** |

## The unlisted twenty-second

The document mock renders a paragraph named **"The day in a sentence"** —
`wname: 'The day in a sentence'`, one day binding, three chips (`day.date`, `day.city`,
`cost.day`) interleaved with prose. It is **not in `WIDGETS`**, so it cannot be inserted.

Two readings, and they imply different document formats:

- **It is a composite widget** the list forgot. Then a widget can own a whole sentence and
  emit several chips from one binding.
- **It is an authored paragraph** containing three separately-inserted single-value widgets,
  and `wname` labels the group. Then the chrome row aggregates the binds of the widgets
  inside a block, and "changing one re-renders that block" means rewriting three instances'
  params at once.

`personBlock` in the same file settles it for at least one case: it renders `w-person` — a
**listed** widget — as three chips plus prose from a single binding. So a widget does emit a
segment list, not one value.

**Consequence, and it is concrete: `InlinePayload = string` cannot express this.** A
display-ready string cannot carry "text, chip, text, chip, text". That is ADR-037's
decision 3.

Which reading applies to *"The day in a sentence"* specifically is still Mitchell's call —
ADR-037 open question 1.

## Two places the design and the build already disagree

1. **`trip` as an input.** The canvas gives `w-name`, `w-dates`, `w-left`, `w-people` and
   `w-cityline` a `trip` input. In the build a page is already trip-bound (`PageContext`
   kept `tripId` when it lost `dayRef`), so those widgets take nothing. The `trip` input
   only earns its place once a page can read a trip it is not filed under — which is
   `w-trips` ("every trip you have"), i.e. account scope. **Do not build a `trip` control
   for the five trip-scoped widgets; it would be a select with one option.**
2. **`Home airport` is marked `needs a field` and no longer needs one.** M17 shipped
   `users.home_airport`. The `needs a field` *mechanism* is still required — it is the one
   rule §7's picker subsection survived by — but this widget is no longer an instance of it.
   Worth telling the design, since it is the design's own example of the pattern.
