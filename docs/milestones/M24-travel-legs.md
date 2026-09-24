# M24 — A leg knows where it goes and by what

**Status:** Scoped 2026-09-18. **The number M24 was assigned in this session**;
placement was **Mitchell's, 2026-09-18, in conversation**. It runs **after M12
and before M14**, and the activity-field descriptor refactor
(`KI-20260905-o`) lands **before M13** — M13 being the first of the three
milestones that each add a field to an activity (M13 `who`, this one `mode` and
`endLocation`, M19 the cost's kind). This milestone assumes that refactor has
landed; see **Prerequisites** for what it costs if it has not.

Until today the work had no milestone at all. `map-legend-modes` in
`apps/web/src/lib/preview-registry.ts:82` is tagged `"unplaced"`, and
`TODO.md`'s candidate entry *"Transport mode per leg"* (~line 893) says the idea
is *"not scoped, not placed, and deliberately not attached to a milestone until
someone wants it."* Someone does.

## Why this exists

**A stop knows that it is travel and nothing knows what kind of travel it is.**
`ActivityKind` (`packages/contracts/src/activity.ts:181`) carries
`"booked" | "hold" | "idea" | "transit" | "planned"`, and M18 added `transit`
exactly so a surface could tell that a stop *is* movement. No field records *by
what*. `apps/web/src/components/lenses/MapLegend.tsx:9` states the consequence
in the component that suffers from it: *"We model no transport mode (no field
distinguishes 'on foot' from 'by train or taxi' for a leg)"* — so the legend's
two mode keys sit behind a `<Preview id="map-legend-modes">` shell
(`MapLegend.tsx:22`), drawn but inert, a claim the app cannot make.

**And a stop knows one place, while a leg has two.** `Location`
(`activity.ts:80`, with `PostalAddress` at `:66`) is a single place per
activity. A "Shinkansen Odawara → Kyoto" stop stores Odawara or Kyoto, never
both. Everything downstream therefore guesses:

- `routeLegs()` (`apps/web/src/components/lenses/mapRailData.ts:153`) **infers**
  a travel leg from adjacency: it pairs consecutive located stops and sorts each
  pair into `travel` or `rest` by whether *either* end is `kind === "transit"`.
  The map draws a line between two other stops and calls it the journey; the
  journey itself is a point.
- `detectConflicts`'s `geographyRule`
  (`packages/domain/src/trip/conflicts.ts:165`) can only ask whether *some*
  travel is scheduled in the interval, not whether it goes to the right place —
  `transitExcusesDistance` (`:152`) checks a transit stop's start time falls at
  or between the pair's times and nothing more. KI-60's own text says why:
  *"It does not check that the transit stop goes to the right place: nothing
  models a from/to (KI-59), so 'some travel is scheduled in this interval' is
  the strongest available signal."*
- M18's Calendar split failed on the same absence. Every stop on a travel day
  carries the **destination** city (KI-59), so day 14's Osaka hotel breakfast is
  tagged Tokyo and the one day that split rendered `Tokyo → Tokyo`
  (`docs/milestones/M18-stop-kind.md:132-175`).

Two fields, and the map, the conflict engine and the Calendar all stop
inferring.

### Two knock-ons, recorded now so neither is discovered later

**1. This reopens the travel-day split M18 built, walked and removed.** M18
implemented SPEC §12's split at the last `transit` stop, walked it against the
Japan fixture, and withdrew it the same day
(`docs/milestones/M18-stop-kind.md:107-111,132-175`). What replaced it: the
Calendar groups a cell **by city alone**, every group an equal card, and the
transition moved to the *day label* — compare yesterday's last placed
activity's city with today's, show `A → B` if they differ. One of the two
reasons the split failed was that nothing could name where you left from. An
`endLocation` names it. **So this milestone makes that split representable
again — and whether to rebuild it is a question, not an assumption.** Mitchell's
stated reason for removing it was not only the data: *"I kinda always pictured
the calendar page a zoomed out trip, what cities are on what days of the
week."* That reason survives an `endLocation` untouched. Nothing in this
milestone's scope rebuilds the split; it only removes the excuse.

**2. Every surface that derives a city from one location now has two to choose
from.** `cityFor()` (`apps/web/src/components/trip/DayChips.tsx:107`) walks a
day's activities backwards and takes the first `location.city ?? location.area`.
`citiesOfStops` (`packages/domain/src/trip/cities.ts:63`) folds
`stops[].location.city` in time order into `saved_days.cities`
(`packages/contracts/src/saved.ts:107-121`). `shortPlace()`
(`apps/web/src/lib/place.ts:28`) renders one place as one string. Each of these
today reads *the* location. After this milestone each must decide, explicitly
and in writing, whether a transit stop contributes its origin, its destination,
or both. A reader that silently keeps taking `location` is choosing the origin
by default — which may well be right, but it must be a choice.

## Scope

**Three links, plus a fourth that falls out of them. They are separable and
could ship in three or four separate PRs** — link 1 is a self-contained enum,
link 2 is the wide one, links 3 and 4 are consumers. Smallest first.

1. **`mode` on a transit stop.** A closed enum on the activity — proposed
   vocabulary `walk | bus | train | flight | ferry | car | bike`, and **the
   vocabulary is the ADR's to confirm**, not this file's. Closed, never
   freeform, for the reason `ActivityTag` is closed (`activity.ts:184-195`):
   the design attaches behaviour to each value and a free string cannot carry
   one.

   This is a contract change, so it goes by **invariant 5's protocol**
   (`AGENTS.md:100-103`): a `docs/contracts/CHANGELOG.md` entry, and **all
   consumers updated in the same PR**.

2. **`endLocation`.** An optional second `Location`, legal only on a transit
   stop. This is the wide link. The surfaces it touches, verified against the
   tree rather than guessed:

   - **The hand-enumeration sites KI-20260905-o lists** —
     `packages/domain/src/trip/state.ts` (`ActivityState`), `equality.ts`
     (per-field compare), `hydrate.ts`, `detail.ts`, `evolve.ts`, `diff.ts`,
     `decide.ts`, and the command/event payloads in `activity.ts`. If the
     descriptor refactor has landed, a missed site is a compile error; if not,
     see Prerequisites.
   - **`SavedStop`** (`packages/contracts/src/saved.ts:23-33`) — the library's
     stop shape, field-for-field with an activity.
   - **The content-bundle schema** — `BundleStop`
     (`packages/fixtures/src/bundle/schema.ts:54`), whose own docstring says
     *"A field that appears on `AddActivity` and not here is a gap to close, not
     a design."*
   - **The `/api/v1` activity endpoints** —
     `apps/web/src/app/api/v1/trips/[tripId]/activities/route.ts` and
     `.../activities/[activityId]/route.ts`, plus the OpenAPI document under
     `apps/web/src/app/api/v1/openapi/`.
   - **Geocoding.** `enrichCommandLocations`
     (`apps/web/src/server/ai/geocodeEnrichment.ts`) resolves a command's
     locations before the domain sees them; a second location is a second thing
     to resolve. And the **`Geocode-Outcome` header** —
     `docs/guidelines/using-the-api.md:134-148`, "Putting a stop on the map" —
     answers *one* outcome (`provided | address | name | no-match |
     quota-exhausted | unavailable`) for a write whose body had a `location`.
     Two locations can have two different outcomes. **What that header says
     when they disagree is a decision this link must make**, not a detail to
     discover in review; it is a documented public-API response and changing
     its meaning is itself contract work.
   - **City derivation.** `citiesOfStops`
     (`packages/domain/src/trip/cities.ts:63`) → `saved_days.cities`
     (`saved.ts:107-121`, a stored snapshot per ADR-029), `cityFor()`
     (`DayChips.tsx:107`), and `shortPlace()` (`apps/web/src/lib/place.ts:28`).
     See knock-on 2 above.
   - **`detectConflicts`** (`packages/domain/src/trip/conflicts.ts:262`) — see
     link 4.

3. **The map draws a real leg, styled by mode.** `routeLegs()`
   (`mapRailData.ts:153`) stops inferring travel from adjacency and draws the
   transit stop's own `location → endLocation` as the leg it is. Two mechanics
   constrain this and both are already documented in the code:
   `MapLens.tsx:171-186` — `ROUTE_VARIANTS = ["rest", "travel"]` (`:176`) exists as two
   layers *because* MapLibre's `line-dasharray` is a plain paint property that
   *"takes no data-driven expression, so a dashed leg and a solid one cannot
   share a layer however the feature is tagged"*, with `TRAVEL_DASHARRAY =
   [2, 1.6]` (`:185`) the dash pattern in line-width multiples. **Styling per
   mode therefore costs a layer per distinct dash pattern**, not a data-driven
   property — the same constraint, now multiplied. If the design wants seven
   visually distinct modes, colour and width are data-driven and dashing is
   not, and this link is where that trade gets made. `markerGroups()`
   (`mapRailData.ts:199`) is adjacent and must not regress: a `city`-precision
   `endLocation` is a centroid like any other and groups on the same terms.

   **`map-legend-modes` is wired up or deleted.** The registry's rule
   (`preview-registry.ts:70-82`, and the note above the registry) is that a
   shell's milestone tag is *a claim that that milestone will wire the shell
   up*. Tagging it M24 makes that claim; this link is what honours it. The
   entry is currently `"unplaced"` and the retag belongs in this milestone's
   first PR.

4. **Conflicts get stricter — an upgrade, not a change.** `geographyRule`
   (`conflicts.ts:165`) skips a far-apart pair when `transitExcusesDistance`
   (`:152`) finds a transit stop whose start time lies at or between the pair's
   times — `>= lo && start <= hi`, deliberately inclusive so a transit stop that
   *is* one of the pair excuses itself, with untimed stops and untimed transit
   stops never excusing anything. That rule took the Japan fixture from 12
   conflicts to 2 and it is correct as far as it goes; KI-60's own text names
   the limit — it *"does not check that the transit stop goes to the right
   place."*

   With an `endLocation`, the engine can. The excuse becomes: a transit stop in
   the interval **whose destination is near the following stop**. This is
   strictly narrower than today's rule, so **every pair it excuses today it must
   still excuse when the destination agrees**, and the three conservative
   properties KI-60 chose on purpose (time order not stored order; an untimed
   stop is never excused; an untimed transit stop excuses nothing) are kept, not
   revisited. A transit stop with no `endLocation` falls back to today's
   behaviour exactly — most stops will have none, and a rule that got stricter
   for them would be a regression dressed as a fix.

   `@tc/fixtures`'s `expectations.ts` pins `conflictTotal` with a comment saying
   to suspect the rule before the content if it climbs; if this link moves that
   number, the milestone says which conflicts changed and why.

## Exit gate

- [ ] **A `mode` on a non-transit stop is refused by the schema**, enforced by a
      `superRefine` on the activity object (the pattern already at
      `activity.ts:25`) rather than by convention — with a test that asserts the
      rejection, and that is **seen to fail** against a schema without the
      refinement.
- [ ] **The transport-mode vocabulary is settled in an accepted ADR**, which
      names the values and what it rejected.
- [ ] `docs/contracts/CHANGELOG.md` carries an entry for `mode` and for
      `endLocation`, and **every consumer moved in the same PR** — invariant 5's
      protocol, not a follow-up.
- [ ] An `endLocation` on a **non-transit** stop is refused by the same
      mechanism, with its own test.
- [ ] **A two-location leg renders as a real line on the map, walked in a real
      browser.** Per **KI-49**, a screenshot of this lens may only claim what it
      actually shows: **a blank canvas is not a pass**, and the evidence must
      say which half was verified — tile *transport* (style, tilejson, sprites,
      glyphs, a 200 on the style fetch) or *pixels*. Neither a cloud session nor
      a laptop has yet produced a picture of a rendered basemap, so the gate box
      is closed by a stated, bounded claim, not by "looks fine".
- [ ] `map-legend-modes` is **wired up or deleted**, and no M24-tagged entry
      remains in `apps/web/src/lib/preview-registry.ts`.
- [ ] **Every city-deriving surface has made an explicit choice** about which of
      a transit stop's two locations it reads — `citiesOfStops`, `cityFor()`,
      `shortPlace()` — each recorded in a comment beside the code, with a test
      pinning the choice.
- [ ] **`geographyRule` excuses a distance only when the transit stop's
      destination agrees**, and a transit stop with no `endLocation` behaves
      exactly as it does today — both directions covered by tests, both **seen
      to fail** before the change.
- [ ] The Japan fixture's `conflictTotal` is either unchanged or changed with
      each moved conflict named in the PR body.
- [ ] `pnpm --filter web test:e2e:ci-like` green — **never plain `test:e2e`**,
      which serves `pnpm dev` and produces timeouts CI does not have.
- [ ] The full Definition of Done is green, and a retro is appended at gate
      close.

## Parked 2026-09-24

| KI | What it is |
|---|---|
| KI-2026-08-30-g | The UI barely reads `kind`, so a stop that IS travel looks like any other stop. This milestone's `mode` and two-location legs are the first surfaces that must read it; **carried, not gating** — a fixer here should take it while the leg rendering is open |

## Deliberately not here

- **Rebuilding the Calendar's travel-day split.** This milestone makes it
  *representable*; it does not decide to build it. M18 removed it on a product
  judgement about what the Calendar is for, and that judgement is Mitchell's to
  revisit, not a consequence of a new field.
- **Routing, durations, distances along a mode.** `mode` says *by what*; it does
  not say *how long* or *along which road*. A drawn leg stays a straight line
  between two points, as every leg is today. Anything that queries a routing
  service is a different milestone with a different cost model.
- **Closing KI-59.** KI-59 is that every stop on a travel day carries the
  destination city. An `endLocation` gives a *transit* stop a from and a to; it
  does not retag the hotel breakfast. KI-60 routed around KI-59 and so does
  this.
- **The cost of a leg.** M19 owns what a cost is for and what kind it is. A
  transit stop's `cost` field is untouched here.
- **Multi-modal legs.** One transit stop, one `mode`. A journey that is a bus
  then a train is two stops, which is what the day's ordered list is for.

## Prerequisites

**The activity-field descriptor refactor — `KI-20260905-o` — and it is a
prerequisite, not a deliverable inside this milestone.** It is shared with
**M13 link 5** (`who`) and **M19 link 1** (a cost's kind): all three add a field
to an activity, and the refactor is what makes a missed site a compile error
instead of a silent drop. It is scheduled to run **once, before M13**, the
first of the three. **This milestone assumes it has landed.**

If it has not, this milestone **pays a 21-site tax and gets 21 chances to miss a
site.** That number is measured, not estimated: KI-20260905-o records a file
scan finding **21 non-test files** hand-enumerating
`timeWindow/location/notes/anchors/kind/tags/cost`, and names the three times
the class has already bitten with the same shape — KI-1 (day order), KI-54
(`city`/`countryCode` invisible to equality, so city-only edits were rejected as
a no-op), and M18's editor sheet dropping `kind`/`tags`. This milestone adds
**two** fields, so it is that exposure twice.

**The refactor has been scheduled before and did not happen.** On **2026-08-29**
Mitchell placed M18b and M17 *"to be built as one overnight batch alongside the
activity-field descriptor refactor"* (`docs/milestones/README.md:648-650`).
M18b and M17 were built. The refactor was not, **and it was in neither the
known-issues register nor `TODO.md`**, so nothing carried it after the milestone
doc that scheduled it went quiet — which is why KI-20260905-o exists and why it
is **still open**. Scheduling it a second time is not sufficient on its own;
this file records the dependency so that opening M24 against an unlanded
refactor is a visible decision rather than an accident.

**A decided answer to "inherit, or carry its own" — and this milestone decides
it.** See the two decisions below.

---

## Two decisions, made 2026-09-18

### 1. Transport mode carries its own field; it does not inherit from `kind`

`kind: "transit"` says **that** a stop is travel. `mode` says **by what**. They
are different facts and neither derives from the other.

The obvious objection is `activity.ts:184-195`, which warns — about
`ActivityTag` — that *"Two fields that can disagree about one fact is a bug
generator"*, and gives the worked example: a stop tagged `considering` while its
kind says `booked` would render dashed under a "Booked" badge with its cost
outside the committed total, *"and no surface would own the contradiction."*
That warning is why `considering` and `travel` are absent from `ActivityTag` in
the first place.

**`mode` does not create that class, because it cannot disagree.** A `mode` is
legal **only** when `kind === "transit"`, **enforced by a `superRefine` on the
schema rather than by convention** — the mechanism already used at
`activity.ts:25`. There is no state in which `kind` and `mode` assert competing
answers to one question: `mode`'s presence is a *function* of `kind`, checked at
the boundary, and its value answers a question `kind` does not ask. The
`ActivityTag` case is different in exactly this respect — `considering` and
`booked` are two answers to *where is this in the workflow*, and nothing
prevented both being set.

**This answers the open question in `TODO.md`'s "Transport mode per leg" entry**
(~line 893), which states it precisely: *"`activity.ts` warns explicitly against
a second field that could disagree with `kind`, so this is the same design
question M19's link 1 has to answer about costs: inherit, or carry its own.
Worth deciding once for both."* It is now decided once, here, for modes. **M19
link 1 is free to answer differently for costs — but only with a stated
reason**, and M19's own file already contains the argument for the other side:
*"a stop with two costs of different kinds is the argument against"* inheriting
(`docs/milestones/M19-cost-model.md:96-102`). A cost is not one-per-stop the way
a mode is, which is a real difference and a legitimate reason to diverge. What
must not happen is diverging silently.

### 2. `location` keeps meaning exactly what it means today — the origin — and an optional `endLocation` is added

`location` on a transit stop already means *where the journey starts*, and every
existing reader of `location` keeps reading the same thing it reads now.
`endLocation` is new, optional, and legal only when `kind === "transit"` — the
same `superRefine`, the same reason.

**The property this is chosen for is minimal blast radius.** No existing reader
of `location` changes meaning: not `cityFor()`, not `citiesOfStops`, not
`shortPlace()`, not `markerGroups()`, not the geocoder, not the API. Each of
them acquires a *new question* (should I also read `endLocation`?) but none of
them acquires a *wrong answer* by doing nothing. A migration that redefined
`location` as "the destination", by contrast, would silently change what every
one of those surfaces already stores and renders.

**The rejected alternative: modelling travel as an EDGE between two stops rather
than as a stop.** It is the cleaner data model in the abstract — a journey
genuinely is a relation between two places, and an edge carries a from, a to and
a mode without any refinement policing which fields are legal together.

**It is rejected because the entire app is "a day is an ordered list of
activities", and an edge is not in that list.** `day.activityIds` is an ordered
array of activity ids; `routeLegs()` and `legKms()` pair *consecutive stops*;
`transitExcusesDistance` reads transit stops' start times out of the day's
activities; `citiesOfStops` folds a list of stops; the Calendar groups stops;
`SavedStop` and `BundleStop` are lists of stops; the API's activity endpoints
create and patch stops. An edge would need its own identity, its own events, its
own place in undo/redo and the diff, its own row in every projection, and its
own answer to "what happens when the stop at one end is deleted" — and it would
still have to be rendered somewhere in an ordered list that has no slot for it.
M18 already decided that a journey is a stop, by giving `ActivityKind` a
`transit` value and building `N to book`, the Calendar and KI-60's conflict rule
on it. This milestone gives that stop its second place; it does not reopen what
a journey is.
