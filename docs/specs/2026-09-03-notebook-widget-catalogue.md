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
| — | Your tier | single | — | ⚠️ | Not in the design's list; Mitchell named it 2026-09-03. Needs billing (M20/M21) |
| `w-trips` | A line for every trip you have | repeat | — | ⚠️ | Needs the trip *list*, plus `repeat` |

**The account-scope problem is one problem, not four — and it is now SETTLED.**
`resolve` is handed a `TripDetail` and nothing else, so every widget above needed a second
source. Mitchell, 2026-09-03: *"notebooks are always account scope […] the creation of a
notebook based on what trip initiated it locks the trip it operates on."*

So the context becomes **`{ user, trip? }`**: the user always, the trip when the notebook was
created from one, fixed at creation and not rebindable. All four widgets above are therefore
**buildable in this milestone**, and their ⚠️ is a signature change rather than missing data.
Root-account notebooks (no trip) are the stated direction but explicitly out of scope.

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

~~**Recommendation: cut both person widgets.**~~ **OVERRULED — Mitchell, 2026-09-03:**
*"that list is a starter, and we can just implement them in this milestone, I would want
person (and persons)."*

They are in. The reason for the recommendation does not go away by being overruled, so it is
now a **cost the milestone carries**: an attribution model — what a person is in for, what
they booked, what they owe — is a domain change with events behind it, not a resolver.
**Cost it as its own link**, ahead of the two widgets that depend on it, rather than
discovering it inside "build the widgets".

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

---

## Coverage audit — every design surface, mapped

**Why this exists.** ADR-035 defined the widget model correctly and *"build the widgets"* was
in none of M14's links. Nobody noticed until Mitchell asked. The model was right and the plan
was incomplete, and nothing in the process was looking for that.

So: every notebook surface the design describes, with where it is decided or why it is not.
**A row with no decision and no deferral is a bug in the plan.** Update this when a link
lands.

| # | Design surface | Source | Decided in | Status |
|---|---|---|---|---|
| 1 | A page has no scope | §18 | ADR-035 d1 | **Built** — M14 link 2 |
| 2 | A widget declares its inputs | §18 | ADR-035 d2 | **Built** — M14 link 3 |
| 3 | A binding lives on the instance | §18 | ADR-035 d3 | Built (params); UI is link 4 |
| 4 | Iteration items never stored | §18 | ADR-035 d4 | Not built — needs `repeat` |
| 5 | **The 21 widgets themselves** | canvas `WIDGETS` | **this file** | **Not built — the gap that prompted this audit.** 7 of 21 exist |
| 6 | Reading / Editing as one toggle | §7 (amended 2026-09-02) | — | ⚠️ **No ADR.** *Edit* → *Done editing*, `aria-pressed`. Specified in SPEC only |
| 7 | The chrome row | §18 | ADR-037 d4 | Name pill conditional on the widget having a name; itinerary under an authored heading shows only its range selects |
| 8 | Insert surface | §18 → **overridden** | ADR-037 d4 | Sidebar + drag + click-at-cursor + slash. **Supersedes §18's Sheet — DRIFT owes an entry** |
| 9 | `needs a field` badge | §7 (only surviving picker rule) | ADR-037 d7 | Mechanism kept; `Home airport` no longer an instance (M17 shipped the field) |
| 10 | Preview must not assert computed numbers | §18 | ADR-037 d5 | |
| 11 | Repeaters, row template, empty case | §7 + §18 | ADR-035 d4 | Empty renders `emptyText` in Reading, keeps rail + template in Editing |
| 12 | "Edit the wording" on the repeat rail | §7 | — | ⚠️ **Unowned.** How an author edits a row template is unspecified beyond "it is document content" |
| 13 | Templates instantiate widgets | §18 | M14 link 7 | What a seed contains is still open |
| 14 | Assistant insert tools | §18 | M14 link 8 | `insert_text` / `insert_widget`, derived from the registry |
| 15 | Notebook history | Mitchell | ADR-036 | **Blocked** — draft durability unresolved; also should follow ADR-038 |
| 16 | Document format + versioning | Mitchell | ADR-038 | Not built. **The most urgent item** |
| 17 | Widget module contract | Mitchell | ADR-037 | Not built |
| 18 | Account scope | Mitchell | ADR-037 oq2 | `{ user, trip? }`, trip fixed at creation |
| 19 | Trip-globals projection | Mitchell | ADR-037 oq4 | Not built. Prerequisite for 20 — cities are derived today |
| 20 | Attribute manifest from annotated Zod | Mitchell | ADR-037 oq4 | Opt-in, never opt-out |
| 21 | Attribution model (person ↔ activity) | Mitchell | — | ⚠️ **No ADR and no data.** Blocks 2 widgets. Proposed as its own milestone |
| 22 | Widget name stability / removal | — | ADR-037 d8 | Names are stored; renaming is a migration |
| 23 | Param shape per input type | — | ADR-037 d9 | `tags` has no unbound state |
| 24 | "Not set up" in every state | Mitchell | ADR-037 d6 | `resolve` total today; `render` totality and a non-day-shaped `unbound` still owed |
| 25 | **Mobile** | §13 | ADR-037 d10 | ⚠️ **Deferred, design's to close.** Notebook is a phone tab; a sidebar has no 402px form |
| 26 | Keyboard parity for insert | — | ADR-037 d11 | |
| 27 | Per-block re-resolution | §18 | ADR-037 d12 | |

### The four rows that still have no owner

Not blockers for starting, but they are what a second pass would otherwise miss again:

1. **Row 6 — Reading/Editing mode has no ADR.** It is the container every other decision
   assumes, specified only in SPEC prose. Cheapest to close.
2. **Row 12 — editing a repeater's wording.** ADR-035 says the row template *is* document
   content; it does not say how an author edits it without seeing macro syntax.
3. **Row 21 — attribution.** Needs its own ADR before its two widgets can resolve anything.
4. **Row 25 — mobile.** The design's, not the build's, and it should be asked for explicitly
   rather than waited on.
