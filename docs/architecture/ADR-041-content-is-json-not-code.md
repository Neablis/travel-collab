# ADR-041: Seed content is JSON in `content/`, not TypeScript in a package

**Status:** **Accepted — 2026-09-06.** Built in the same change: the format, the
converters, the importer, the dev-gated write route, `saved_days.author_kind`
and 88 playbook days across eleven bundles plus four demo trips.
**Deciders:** Mitchell (product/eng — asked for it); Claude (architect) — drafted
Related: **ADR-030** (the demo trip lives in `@tc/fixtures` — still true; this is
what to do with content that is not *the* demo trip), **ADR-029** (a saved day is
a value, not planning state), **ADR-020** (fixtures vs factories), **ADR-008**
(money is integer minor units)
Guide: `docs/guidelines/content-bundles.md`

## Context

Mitchell, 2026-09-06:

> I want you to create a standardized way to serialize notebooks, activities,
> and trips in a json form, so that they could be imported into the project as
> needed. […] Then I want you to generate a large amount of seed data to get the
> website started. […] the main goal is to generate a lot of believable
> playbooks.

Three surfaces already produced seed content and each did it differently:

- `apps/web/scripts/db-seed.ts` wrote the Rochester and Portland trips as
  TypeScript object literals;
- `packages/fixtures/src/japan/` holds *the* Japan trip as 72 typed rows with a
  verification harness around it (ADR-030);
- `packages/fixtures/src/library/starterDays.ts` holds six playbook days in a
  third shape, added because *"somebody signing up should find something worth
  taking"*.

Adding a Thailand beach day therefore meant writing code. That has two costs
that only show up at volume. A reviewer deciding whether a day is any *good* has
to read a diff of object literals; and the file's own header already records the
gap it could not close alone — six days cannot fill Discover's four season
buckets **and** its four budget bands, so three of the four bands had no occupant
anywhere in the seed, which is *"a control over data that does not exist is a
control that does nothing"* applied to a shipped filter.

At eighty-odd days, "content is code" stops being a mild inconvenience and
becomes the thing preventing the content from existing.

## Decision

### 1. One JSON format, `travel-collab/content-bundle/v1`, carrying all three

A bundle is one file with `trips`, `playbooks`, `notebooks` and loose
`activities`, an envelope
naming the file and **who wrote its content**, and nothing else. Schema and pure
converters live in `packages/fixtures/src/bundle/`; the files live in
`content/`.

**It is a fixture format, not a contract.** `seedSchema.ts` made the same call
for `trip-seed/v1` and the reasoning carries over: this describes a FILE, not a
request or response crossing a module boundary. Putting it in
`packages/contracts` would make every content edit a contracts change with a
changelog entry and all-consumers-in-one-PR (invariant 5), for a format with one
producer and one consumer.

### 2. The format composes the contracts' own schemas; it never restates them

A stop is `AddActivity` minus the three ids the importer mints, using
`TimeWindow`, `Location`, `Money`, `ActivityKind` and `ActivityTag` **imported
from `@tc/contracts`**. A notebook's body is `PageDoc`, the same schema the
editor's write path enforces (ADR-038 decision 4).

So a bundle cannot describe a stop the command API would refuse, and a fifth
`ActivityTag` reaches the format with no edit. The only shapes declared locally
are the ones that exist nowhere else: the envelope, and the day/trip grouping.

### 3. Ids are derived from human-readable keys, never authored

`bundleId(namespace, key)` hashes `(bundle.id, key)` to a v4-shaped uuid. A
content author writes `"key": "krabi-railay-sunset"` and never sees a uuid, and
re-importing the same file **updates the same rows** rather than building a
second library.

The hash is FNV-1a in TypeScript rather than `node:crypto`, because
`@tc/fixtures` may depend on `@tc/contracts` and zod and nothing else (ADR-030) —
a real bundled route imports it. Collisions are checked over the whole checked-in
set by `content.test.ts` rather than argued about.

Trips are the exception and cannot be: `CreateTrip` is a trip's genesis and the
server mints the id, so trip idempotency is "clear the trips with these names
first", not "write to a known id".

### 4. Importing goes through the real write paths, never a direct row write

- **Trips** → `POST /api/trips` then the batch command endpoint, one batch per
  day. Never a projection write (invariant 1), and per-day because one batch is
  one History entry.
- **Playbooks** → a dev-gated route that writes through `newSavedDayRow` and
  `recordAdd`, so `cities` is derived by `citiesOfStops` and `adds` is moved by
  the ledger — the same derivations a real save and a real add use. Nothing in a
  bundle can set either.
- **Notebooks** → validated always, created as pages only when `--trip` names
  one.
- **Activities** → loose stops with no day and no playbook, into `--trip`'s
  backlog in one batch. A section of its own rather than "a playbook with one
  stop": a playbook is a *day*, and a list of unrelated ideas is not one.

**That route takes a body, and its neighbour `POST /api/dev/saved-days` does
not.** The neighbour reads its fixture server-side, which is right for content
compiled into the app; this content is files the app does not bundle and a
serverless function cannot read. The trade is bounded three ways: the same
`isDevLoginEnabled()` gate that fails closed to a 404 in production, a
**server-side** `parseBundle` so the body is validated rather than trusted, and
derivations that still happen server-side regardless of what the body says.

### 5. `saved_days.author_kind` — the database says who wrote a day

`"human" | "ai"`, defaulting to `"human"`, because everything written before the
column existed was written by a person and so is everything
`POST /api/saved-days` writes now. Only the importer says otherwise, explicitly.

A column rather than a naming convention or a reserved owner id: the question is
asked by surfaces that have a row and nothing else, and "is the owner one of the
five `dev-*` accounts" stops being true the first time a real person signs up
with a seeded day in their name.

Not called `origin` — `events.origin` already means the provenance of a batch of
events (user/undo/redo/revert), and two columns called `origin` meaning two
unrelated things is ambiguity to pay down rather than add to.

**Only `"ai"` renders** (`AuthorKindBadge`, on the Discover card and the
shared-day screen). "human" is the absence of a claim, not a claim — which is
also what lets the read path fall back to it on an unparseable value and log,
rather than dropping the row the way an unreadable `stops` or `visibility` does.
Those decide what a reader may *see*; this decides a label.

### 6. Content is checked by a test, not by a script somebody remembers to run

`packages/fixtures/src/bundle/lint.ts` holds the rules a schema cannot state — a
`keptOn` in the future, an author in their own adds ledger, two adds naming one
trip, a stop with no city, a day written out of chronological order, a published
day with nothing priced. `content.test.ts` runs them over every file in
`content/` on every `pnpm test`, and also asserts the derived ids are stable and
collision-free and that the set fills every season and every budget band.

`pnpm content:verify` is the same code with the writes switched off
(`import-content.ts --dry-run`), not a second reader free to disagree with the
importer about what it accepts.

## Consequences

**Good.** Content is reviewable as content. 148 playbook days across twenty
regions now exist, authored by twelve people, spanning 327 cities — and
Discover's budget filter has occupants in all four bands for the first time
(`under200` 80, `200to500` 39, `500to1000` 12, `over1000` 17), closing the gap
`starterDays.ts` flagged and could not fix at its own size. Adding a region is
one JSON file and no code, which is the whole claim: the second wave of nine
bundles cost no source changes at all.

**The notebook library moved with it, and one line of it was got wrong first.**
`@tc/pages`' `templates.ts` now splits `DEFAULT_TEMPLATES` (seeded into every
trip — still two) from `TEMPLATE_LIBRARY` (what the gallery offers — seven), and
the gallery templates plant widgets again: the M8 note saying they must not was
written in the window between macro authoring leaving the editing surface and
M14 putting it back.

**The seeded pair deliberately stays prose**, and the rule is worth stating
because the first version of this change did not have it:

> A template planted before there is a plan prompts writing; a template you
> choose once you have one builds itself.

Widgets went onto Trip Overview first, and the e2e lane said no in three places
at once: `m14-notebook-widgets` and `m14-mobile-notebook` both open Trip
Overview when they need *a page with nothing on it*, and both started counting
the template's own widgets alongside the ones they had inserted. That is a fact
about what the page IS, not a test to work around — Trip Overview is the first
page of every trip and the product's blank sheet. The product argument points
the same way: a brand-new trip has no dates, no cities and no stops, so a
widget-bearing Trip Overview opens as five grey "no dates set" chips where the
prose version asks the question the person can actually answer. The widget-built
versions of both ideas are one click away in the gallery — "A day in detail" and
"Full trip breakdown" — and `templates.test.ts` asserts the split in both
directions.

`content/notebooks/built-in-notebooks.json` is a serialised copy of the library,
checked against the code by `templates.test.ts` — so "the format carries
notebooks" is demonstrated on the notebooks the product itself ships rather than
on a toy.

**`packages/contracts` now spells its own relative imports with `.ts`.** That
was not a preference; it is what makes the package loadable by a plain Node
process, which the importer is — `@tc/fixtures` already spelled its imports that
way for the same reason, and the Next build is unaffected (verified). It is a
33-line mechanical change with no semantic content.

**Imported content carries no coordinates, on purpose.** The generator was told
to omit `lat`/`lng` rather than invent them: a wrong pin is worse than no pin,
and this repo's geocoder (LocationIQ, ADR-007) needs a key and a rate-limited
offline pass, which is its own piece of work. The consequence is real and is
filed rather than hidden: the four demo trips render "N stops have no place yet"
on the Map lens. See `docs/known-issues/open/`.

**Not all of the content is equally researched, and the format had nowhere to
say so.** The first eleven bundles were built against live pages; the later ones
ran after the session's search budget was spent and outbound fetches were
blocked, so their venue names and prices are model knowledge. They are kept —
seed content's bar is "plausible, well-shaped and labelled as generated", and
`authorKind: "ai"` plus the badge already tell a reader that — but each affected
file now opens `bundle.sources` with a `PROVENANCE:` line, and
`KI-2026-09-06-d` owns the verification pass. **If provenance turns out to
matter more than once, it wants a field rather than a convention inside a free
string**; that is the obvious next version of this format and is deliberately
not being invented now on one example.

**A dev-gated route now accepts content in its body.** Bounded as described in
decision 4, and gated exactly as its neighbour is — but it is a wider door than
the one beside it and should not be widened further without a reason.

**Two seeding paths still exist and both are right.** `@tc/fixtures`' Japan trip
is *the* demo trip with a verification harness and an exit gate resting on its
counts (ADR-030); this is everything else. The rule for which to reach for is in
`docs/guidelines/fixtures-and-seed-data.md`.
