# Content bundles — authoring and importing content as JSON

> You have a trip itinerary, a set of good days, or a notebook layout, and you
> want it in the product without writing TypeScript.

`travel-collab/content-bundle/v1` is one JSON file that can carry **trips**,
**playbook days**, **notebook templates** and **loose activities**. `pnpm --filter web content:import`
reads a directory of them and writes them through the real command API and the
real CRUD paths — never a direct projection write.

- **Schema:** `packages/fixtures/src/bundle/schema.ts` (`parseBundle`)
- **Converters:** `toCommands.ts`, `toPlaybooks.ts`, `toNotebooks.ts` — pure
- **Importer:** `apps/web/scripts/import-content.ts`
- **Content:** `content/trips/`, `content/playbooks/`, `content/notebooks/`
- **Content rules:** `packages/fixtures/src/bundle/lint.ts`, enforced in CI by
  `content.test.ts` and printed by `pnpm content:verify`
- **Decision record:** ADR-041

## Why a format at all

Three surfaces already seed content and each did it differently: `db-seed.ts`
wrote trips as TypeScript literals, `@tc/fixtures` holds the Japan trip as typed
rows, and the starter library is a third file with a fourth shape. Adding a
Thailand beach day meant writing code, which means a reviewer reads a diff of
object literals to decide whether a day is any good. A bundle is content in a
form a person can read and a schema can refuse.

It also has to scale past what a hand-written file can carry. `starterDays.ts`'
own header records the ceiling it hit: six days cannot fill Discover's four
season buckets **and** its four budget bands, so three of the four bands had no
occupant anywhere in the seed — *"a control over data that does not exist is a
control that does nothing"*, on a shipped filter. Eighty-eight days can, and
`content.test.ts` asserts they still do.

## The envelope

```json
{
  "$schema": "travel-collab/content-bundle/v1",
  "bundle": {
    "id": "thailand-beaches",
    "name": "Thailand: island and beach days",
    "description": "Day-shaped playbooks from the Andaman and Gulf coasts.",
    "origin": "ai",
    "sources": ["https://…", "https://…"],
    "generatedAt": "2026-09-06"
  },
  "trips": [],
  "playbooks": [],
  "notebooks": [],
  "activities": []
}
```

`bundle.id` namespaces every id derived from the file, so two bundles can use
the same `key` without colliding. `bundle.origin` is `"human"` or `"ai"` and is
inherited by every playbook that does not override it — it becomes
`saved_days.author_kind`, which is how the database says whether a day was kept
by a person or generated, and what the "AI starter" mark on a Discover card
reads.

**Ids are derived from keys, never authored.** `bundleId(namespace, key)` hashes
the slug to a uuid, so re-importing the same file updates the same rows instead
of creating a second library. A content author writes `"key":
"krabi-railay-sunset"` and never sees a uuid.

## A stop

The one shape shared by trips and playbooks. It is `AddActivity` minus the ids
the importer mints, using the contract's own schemas — so a bundle cannot
describe a stop the command API would refuse.

```json
{
  "title": "Longtail to Railay from Ao Nang",
  "timeWindow": { "start": "08:30", "end": "09:05" },
  "location": { "name": "Ao Nang Beach pier", "city": "Krabi", "area": "Ao Nang" },
  "kind": "transit",
  "tags": [],
  "notes": "Boats leave when eight people show up, not on a timetable.",
  "cost": { "amountMinor": 350, "currency": "USD" }
}
```

| Field | Rules |
|---|---|
| `title` | required, ≤ 200 chars |
| `timeWindow` | `HH:MM` 24h, `end` strictly after `start`. Omit for a backlog item or an untimed stop |
| `location` | `name` required; `city` is what Discover matches on, so **give every stop a city**. `area` is the neighbourhood. `lat`/`lng` come as a pair or not at all — and if you are not certain of a coordinate, omit it: a wrong pin is worse than no pin, and the checked-in bundles carry none for exactly that reason |
| `kind` | `planned` (default), `booked`, `hold`, `idea`, `transit` |
| `tags` | any of `meal`, `lodging`, `ticketed`, `outdoors` |
| `notes` | ≤ 2000 chars |
| `cost` | `{ "amountMinor": 1250, "currency": "USD" }` — **minor units, integer** (ADR-008). $12.50 is `1250` |

## A trip

```json
{
  "key": "thailand-andaman",
  "name": "Thailand: Bangkok → Krabi → Koh Lanta",
  "summary": "Ten days, two coasts, one long boat.",
  "currency": "USD",
  "budget": { "amountMinor": 420000, "currency": "USD" },
  "startsInDays": 24,
  "days": [{ "label": "Arrival and Ari at night", "stops": [] }],
  "backlog": []
}
```

`startsInDays` is days from *today*, and it is the form to use: a demo trip with
a fixed start date is an expired trip three months later and the homepage hero
has nothing upcoming to show. `startDate` exists for content genuinely about a
fixed date; give exactly one of the two.

`days[].label` is for the human reading the file — Trip Planning has no day
title, so nothing stores it. It is still required in practice: a 14-day
itinerary written as an unlabelled array of arrays cannot be reviewed.

## A playbook day

A playbook is a **saved day**: a reusable fragment with no dates, which somebody
can take into their own trip.

```json
{
  "key": "railay-limestone-and-sunset",
  "name": "Railay: limestone, lagoon, and the sunset boat back",
  "ownerId": "dev-carlos",
  "visibility": "public",
  "origin": "ai",
  "keptOn": "2026-02-14T09:00:00.000Z",
  "sourceTrip": { "name": "Thailand, the long way round" },
  "addedBy": [{ "addedBy": "dev-priya" }],
  "stops": []
}
```

- **`ownerId`** is a `users.id`. Dev-login mints `dev-<username>`, so the seeded
  library's owners are `dev-alice`, `dev-carlos`, `dev-priya`, `dev-maeve`, …
  Do not make one person the author of everything: "Everyone" being a superset
  of "Yours" only means something when the two differ.
- **`visibility`** defaults to `private`, as it does everywhere else. A day only
  reaches Discover when it is `public`.
- **`keptOn`** becomes `created_at` / `published_at`. Discover's season filter
  buckets from exactly this timestamp, so **spread a set across all four
  seasons** or three quarters of that control returns nothing. It must be in the
  **past** — a future timestamp sorts a seeded day above every real one.
- **`sourceTrip`** is a snapshot of a name, never a row (ADR-028). The trip it
  names is deliberately not in the database.
- **`addedBy`** is the adds ledger. `adds` is this list's length and is never a
  separate number. A day's own owner must not appear here — copying your own day
  into your own trip does not count.
- **`cities` is derived, never authored.** `citiesOfStops` reads
  `stops[].location.city`, which is the reason every stop needs one.

### What makes a day worth cloning

The bar the starter library set, and the one to hold to:

- **Priced honestly.** `savedDayFacts` totals the priced stops and Discover
  filters on it: a day with nothing priced shows "—" and is invisible to that
  control. Bands are `<$200`, `$200–500`, `$500–1000`, `>$1000` — and a library
  where every day lands in the bottom band leaves three quarters of that filter
  with nothing to show, which is the same "a control over data that does not
  exist" problem. **So a set needs some genuinely expensive days**, priced at
  what they honestly cost, not padded to fill a band.
- **Placed.** Every stop carries a city.
- **Timed, and in order.** Chronological, with honest gaps.
- **Advice, not a list of names.** The Sintra day in the starter library is the
  most-added one because it says *"the 07:41 is the whole trick"*. A day that is
  five venue names in time order is a search result, not a playbook.
- **Mixed kinds.** Real days have a `booked` ticket, a `transit` hop and an
  `idea` somebody has not committed to.

## Loose activities

The smallest thing a bundle carries: stops belonging to no day and no playbook —
a wishlist.

```json
"activities": [
  { "title": "Asador Etxebarri in Axpe", "kind": "idea",
    "location": { "name": "Asador Etxebarri", "city": "Axpe", "area": "Atxondo" },
    "notes": "Books out months ahead. Worth planning a day around, not fitting in." }
]
```

A section of its own rather than "a playbook with one stop", because a playbook
is a **day** — with an order and a shape somebody chose — and calling a list of
unrelated ideas one would be lying about what it is. They land in a trip's
backlog, where an idea with no slot yet already lives, so they need `--trip`
before the importer writes them.

## A notebook template

```json
{
  "key": "dinner-tracker",
  "title": "Dinner tracker",
  "description": "Every meal on the trip, what it cost, and what still needs booking.",
  "seedIntoNewTrips": false,
  "content": { "v": 1, "type": "doc", "content": [] }
}
```

`content` is a `PageDoc` — the same AST the editor's write path enforces
(ADR-038). A widget is a `macro` node:

```json
{ "type": "macro", "attrs": { "name": "stop.rows", "params": { "tag": "meal" } } }
```

The twelve primitives and what they take are in
`packages/pages/src/registry.ts`; the named combinations people browse are
`presets.ts`. **An absent filter means "every one", not "unset"** — a
`day.detail` with no `day` shows every day, which is what makes a template
trip-agnostic.

`seedIntoNewTrips: true` plants it in every new trip. Default `false` puts it in
"Start from a template" only; a library that seeds itself into every trip stops
being a library at about four entries.

## Importing

```
pnpm --filter web dev                                  # in one terminal
pnpm --filter web content:import                       # in another — imports content/
pnpm content:verify                                    # parse + lint + report, no server
pnpm --filter web content:import -- --dir content/playbooks
pnpm --filter web content:import -- --trip <uuid>      # also create the notebooks in that trip
```

`pnpm --filter web db:reseed` runs `db:reset`, `db:seed` and `content:import` in
that order, which is the whole seeded database from nothing.

**Re-importing replaces; renaming leaves a stray.** A playbook's row id is
derived from its key, so changing a *key* orphans the old row and changing
anything else updates in place. A trip's id is minted by the server, so the
importer clears trips by the exact names it is about to create — rename a trip
in a bundle and the previously-imported one stays until the next `db:reset`.

The importer signs in through dev-login exactly as `db:seed` does, then:

- **trips** go through `POST /api/trips` and the batch command endpoint, one
  batch per day, so History reads a day at a time;
- **playbooks** go through `POST /api/dev/content/playbooks`, which validates the
  bundle **server-side** and writes through `newSavedDayRow` and `recordAdd` —
  the same derivation and the same ledger-plus-counter pair a real save and a
  real add use, so nothing in a file can set `cities` or `adds`;
- **notebooks** are validated always, and created as pages only when `--trip`
  names one. A template is trip-agnostic, and writing every template into every
  trip is the thing `seedIntoNewTrips` exists to avoid;
- **activities** land in `--trip`'s backlog, in one batch so a wishlist reads as
  one History entry.

`pnpm content:verify` is `import-content.ts --dry-run`: it parses, lints and
prints the summary without writing anything and without needing a server. It is
the same code path as the import with the writes switched off — deliberately,
because a separate verifier would be a second reader of the same files, free to
disagree with the importer about what it accepts.

**Everything under `content/` is imported.** There is no manifest to add a file
to; a bundle you do not want in a seeded database is a bundle that does not live
there. `--dir` narrows a run, and resolves against your current directory first
and the repo root second — so the paths above work whether you type them from
the repo root or from `apps/web`.

## Adding a bundle to the repo

1. Write the JSON under `content/playbooks/` (or `trips/`).
2. `pnpm content:verify` — schema, and the content rules a schema cannot state
   (a future `keptOn`, an owner in their own adds ledger, a day with no city).
3. `pnpm --filter web db:reseed` and look at it in Discover.

`pnpm --filter @tc/fixtures test` runs the same lint in CI
(`src/bundle/content.test.ts`), so a bundle added in a later PR is checked
whether or not anybody remembers step 2. That test also asserts the whole set
still fills every season and every budget band Discover filters on, and that no
two derived ids collide.
