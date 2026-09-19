# M25 — A trip is a file you can take with you

**Status:** **Scoped 2026-09-18. Numbered M25 and placed by Mitchell in
conversation the same day, running immediately after M22.** M22 is the current
milestone (`docs/milestones/README.md:201`); this one runs on what M22 built and
is placed before M12, M13 and M14 rather than after them.

**There is one genuine argument against placing it this early, and it is worth
stating rather than winning quietly.** Every milestone still ahead of it adds to
what a trip *contains* — M13's collaboration state, M14's notebook widgets, and
the multi-day playbooks and travel legs beyond them — so a format frozen now is
a format that grows. **The answer is that growth is the normal case and is
already provided for.** The bundle is versioned behind its `$schema` string
(`packages/fixtures/src/bundle/schema.ts:208`), which is what makes an additive
field additive and a breaking change a `v2`; ADR-041 decision 2 means a fifth
`ActivityTag` reaches the format with no edit at all. What keeps each addition
honest is the round-trip test this milestone's gate is built around: a field
added to a trip and not to the export makes that test fail, in the diff that
added it. Deferring the format does not stop the trip growing — it only removes
the thing that notices.

**No export path exists today. Not a partial one, not a script.** Verified by
grep over `apps/web/src` and `packages/**` on 2026-09-18: no
`Content-Disposition` header anywhere in the repo, no route that serialises a
trip, no `toBundle` beside `toCommands.ts`. The bundle format has one producer
(a person with a text editor) and one consumer (`parseBundle`), and the arrow
has only ever pointed one way.

## Why this exists

**A trip lives in one database and can leave it by no door.** The product can
already read a trip from a file — `pnpm --filter web content:import` has written
four demo trips and 148 playbook days that way since ADR-041 — and cannot write
one back. That asymmetry is the whole milestone.

Three things follow from it, and each is live today:

1. **A user's plan is not portable.** A person who wants their itinerary
   somewhere else — a backup, a different account, a spreadsheet, a print shop —
   has one option, which is to retype it. Clone (ADR-028) copies a trip *within*
   this system; a share link (ADR-027) hands somebody a view of one. Neither
   produces a file.
2. **The import machinery already exists and is dev-only.** `parseBundle` is
   called server-side by exactly one route,
   `apps/web/src/app/api/dev/content/playbooks/route.ts:62`, which is behind
   `isDevLoginEnabled()` and **fails closed to a 404 in production** (`:48-50`).
   The rest of the path — the schema, the pure converters, the linter, the
   importer — is built, tested and unreachable by any user.
3. **The format is the one part of this that was already paid for.**
   `travel-collab/content-bundle/v1` has a schema composed from the contracts'
   own types, a linter for the rules a schema cannot state
   (`packages/fixtures/src/bundle/lint.ts`), a CI test over every checked-in
   file, and a real importer. What it has never had is a writer.

## Three decisions, taken before the scope

### 1. Export emits `travel-collab/content-bundle/v1`. A third format is not created.

Four reasons, in order of weight:

- **The format exists and is enforced.** A schema
  (`packages/fixtures/src/bundle/schema.ts`), a content linter
  (`lint.ts:209`), pure converters (`toCommands.ts`, `toPlaybooks.ts`,
  `toNotebooks.ts`) and an importer that goes through the real write paths
  (ADR-041 decision 4). None of that has to be written twice.
- **Round-trip becomes a gate box a test can hold.** `export → import →
  compare` is only expressible because the two ends speak one language. Against
  a bespoke export format the honest gate box would be "a human read the JSON
  and it looked right".
- **It is the format a person can hand-author**, which is what *"similar to the
  API"* is actually asking for: readability, not literally the REST resource
  shape. A content author writes `"key": "krabi-railay-sunset"` and never sees a
  uuid (ADR-041 decision 3); the API's `GET /v1/trips/{tripId}` answers with
  `TripDetail`, a board read model carrying `conflicts`,
  `dismissedConflictIds`, `costSubtotal` and `budgetRemaining`
  (`packages/contracts/src/detail.ts:38-73`) — all derived, none of it
  authorable, and nothing a person would type.
- **The stop shapes are already the same object.** `BundleStop`
  (`schema.ts:54`) is `AddActivity` minus the three ids the importer mints, and
  it matches `ActivityView` (`detail.ts:7-33`) field for field: `title`,
  `timeWindow`, `location`, `notes`, `anchors`, `kind`, `tags`, `cost`. A stop
  round-trips losslessly on day one, because the two shapes were derived from
  one contract rather than reconciled.

**The rejected alternative, plainly: a dedicated export format.** It would be a
third vocabulary over the same data — after the contracts and the bundle — and
the first one with no CI test behind it. That is the second-copy drift
`AGENTS.md` invariant 5 exists to stop (`AGENTS.md:100-103`), applied the way
M22 already applied it when it refused a registry file for routes.

### 2. A trip export is a SNAPSHOT, not the event log.

The export carries the trip's *state*. It does not carry its history.

**Because the log is `tripId`-bound and re-importing it would violate ADR-028's
id-remap rule.** ADR-028 decision 2 is explicit: ids are **not** preserved
across a copy, and its argument is KI-1's own post-mortem — preserving day ids
is "the obvious implementation" and is exactly what would have made a latent
`diffTripStates` ordering bug active. An exported event stream is a sequence of
events naming one trip's days and activities by id; importing it either replays
those ids into a new stream, which is the hazard `cloneTrip` exists to handle,
or remaps every id inside every payload, which is a second implementation of
`remapIds` operating on serialised events rather than on state.

**What that costs, said out loud: an exported trip loses its history.** Undo,
redo, revert, "what did this look like on Tuesday" and the History popover all
describe a stream, and a re-imported trip starts a fresh one. The importer
already behaves this way for the four demo trips — `bundleTripCommandGroups`
groups commands one batch per day precisely so the *new* stream reads sensibly
(`packages/fixtures/src/bundle/toCommands.ts:79-81`) — and this makes that a
stated property rather than an artefact.

### 3. Export is FREE — not gated on `premium`.

**Mitchell's decision, 2026-09-18.**

Two reasons on the record. *"Free keeps trip planning entire"* is M20's line
(`docs/milestones/README.md:76`; the milestone file spells it **"`free`
entitles trip planning in full"**, `M20-account-tiers-and-entitlements.md:258`)
— and a trip you cannot take out is not an entire one. And data portability is
a **trust** property rather than a paid feature: charging for the exit is the
one paywall that makes the rest of the product harder to believe.

**The consequence, checked rather than assumed.** Because export is free it
needs **no new entitlement** — no addition to `Entitlement`
(`packages/contracts/src/entitlement.ts`) — which under ADR-045 rule 1 means
**no new plan version**, since publishing a version is what a change to what a
plan *is* requires. So this milestone does not walk into the `premium@v1`
pinning problem M22 raised: no `premium@v3`, no second cohort of subscribers
pinned to a version that predates the feature, nothing owed to the founder
grants that migration 0019 hardcoded at `'premium', 1`
(`M22-public-api-and-tokens.md:502-523`). Verified against ADR-045 rules 1, 2
and 6 and against M22's own account of the problem before being written here.

**The asymmetry is real and a reader needs it.** Exporting *through the API*
still requires a token, and a token still requires `api.tokens`, which is
`premium@v2` only — `accountCan(owner, "api.tokens")` is checked on **both**
mint and verify (`M22-public-api-and-tokens.md:127-136`;
`docs/guidelines/using-the-api.md`, *"API tokens are on the Premium plan"*). So:

| | `free` / `plus` | `premium@v2` |
|---|---|---|
| Download the file from the trip page | **yes** | yes |
| `GET /api/v1/trips/{tripId}/export` with a token | **no — 402, no token to hold** | yes |

That is not export being gated. It is *the API* being gated, exactly as it
already is for `GET /v1/trips`, and the free path is the UI one. It is written
down here because "export is free" and "a free account cannot call the export
endpoint" are both true, and discovering that pairing during a support
conversation is worse than reading it in a table.

## Scope

Four links, smallest first. Link 3 is the larger half of the milestone and links
1, 2 and 4 together are smaller than it.

1. **Export as a v1 endpoint.** `GET /api/v1/trips/{tripId}/export`, answering a
   one-trip `content-bundle/v1` document.

   **The route shape, justified against M22's conventions rather than picked.**
   A sub-path under `trips/[tripId]/` is the shape `restore/`, `history/undo/`
   and `geocode/` already use, so the wrapper's `trip: "path"` resolves the trip
   and the role gate applies with no hand-written check
   (`docs/guidelines/using-the-api.md`, *For somebody adding an endpoint*).
   `scope: "trips:read"`, `role: "viewer"` — **a viewer, matching ADR-028
   decision 3**: a viewer may already clone a trip, so refusing them a copy in a
   file protects nothing and only makes the product feel arbitrary. No
   `collection` and no pagination: a bundle is one document, not a page of
   items.

   **Rejected: `GET /v1/trips/{tripId}?format=bundle`.** One declaration would
   then have two response schemas, and the wrapper validates the response
   out-bound against exactly one — which is also what generates the endpoint's
   OpenAPI entry. A query parameter that changes the response shape is an
   endpoint the reference cannot describe.

   **This is the first real test of M22's own headline claim** that endpoint N+1
   costs a declaration and nothing else. M22 measured it on
   `GET /v1/trips/{tripId}/members` — 18 lines, one file
   (`apps/web/src/app/api/v1/trips/[tripId]/members/route.ts:5`) — an endpoint
   that slices an array already on the context. This one has a body to build,
   and so measures the claim where it might not hold: the declaration should
   still be a declaration, with the trip → bundle conversion living in a pure
   converter beside `toCommands.ts` rather than in the route. **If the route
   file grows a second responsibility, that is the finding**, and the gate box
   says so.

2. **A UI download on the trip page, free to every plan.** One action, one file,
   no entitlement check anywhere on the path. Filename derived from the trip's
   name; `Content-Disposition` is currently used nowhere in this repo, so this
   is the first of them.

3. **Import: `parseBundle` as a user surface rather than a script.** The larger
   half, and the reason is that it has to decide four things the script never
   had to.

   - **Ids.** The script derives them: `bundleId(namespace, key)` hashes
     `(bundle.id, key)` to a stable uuid (`ids.ts:39`), so a re-import
     **updates** the same rows — playbook days are deleted and rewritten by
     derived id, and the production importer creates trips at
     `tripIdFor(bundle.id, key)`, create-if-absent
     (`apps/web/scripts/import-content-production.ts:226`). **That is exactly
     wrong for a user upload.** A person uploading a file must get **fresh,
     minted ids**, so an upload can never land on top of an existing trip —
     theirs or anybody else's. Uploading the same file twice must produce two
     trips, not one trip written twice.
   - **Ownership.** A bundle names owners: `BundlePlaybook.ownerId` is a
     `users.id` and the seeded library's days belong to `dev-carlos` and friends
     (`schema.ts:132`). Nothing in an uploaded file may decide who owns what.
     The importing session does, and the file's own claim is discarded rather
     than honoured.
   - **Size.** `content/` holds bundles of 148 days; the script reads them off
     disk with no limit, because the person running it wrote them. An upload
     needs a ceiling, refused as a **400 with the limit named** rather than
     clamped or truncated — M22's precedent for `?limit=`, which refuses an
     out-of-range value rather than quietly changing it.
   - **A partially-invalid bundle — settled 2026-09-18, and it is the script's
     own rule.** All-or-nothing: a file that does not parse imports **nothing**,
     which is what the script already does in one line — `errors.length > 0` →
     *"n error(s) — nothing imported."* and exit 1
     (`apps/web/scripts/import-content.ts:267-271`). The half this link was
     going to have to decide — what an upload does with the linter's
     **warnings** — **is gone**, because the content rules do not run on uploads
     (open question 3). With no warnings there is no partial state to design.

   **The endpoint shape carries one constraint from M22.** Importing creates a
   trip, so a **trip-confined token must be refused**, for the same reason
   `POST /v1/trips` refuses one: creating a new trip from a credential
   restricted to named trips is a widening
   (`docs/guidelines/using-the-api.md`, *Trip-scoped tokens*).

4. **Round-trip proof.** The test that makes the format decision hold: a trip
   built through the real write paths, exported, imported, and the two compared
   **structurally**. Not a snapshot of bytes — ids are minted fresh by design
   (link 3), so the comparison is over everything else, with the id remap
   applied. This is the box that fails when a later milestone adds a field to a
   trip and not to the export.

## Questions this milestone had — all three are answered

**Three were flagged when this file was written, and Mitchell answered all of
them on 2026-09-18.** They are kept here rather than deleted, with the decision
marked in each, because the reasoning is what a later session needs in order not
to reopen them.

**Nothing on this milestone is waiting on a decision.**

### 1. What a trip export carries — *DECIDED 2026-09-18*

**Days and activities. Nothing else.** Mitchell, 2026-09-18: *"just the days and
activities, nothing else, no budget, invites or notebooks."*

So this stopped being a question about what the format is missing and became a
**scope line**: the parts listed below as absent are absent **by decision**, and
a later session finding them missing has found the decision rather than a gap.

| Part of a trip | Exported? |
|---|---|
| Days, in order, with their stops | **yes** — `BundleDay` (`schema.ts:72`) |
| Stops — title, time window, location, notes, anchors, kind, tags | **yes**, field for field (`BundleStop`, `schema.ts:54`) |
| A stop's `cost` | **yes** — see the reading below |
| Backlog | **yes** — see the reading below |
| Trip name | **yes**; it is required by `BundleTrip` and an export has to name something |
| **Trip budget** | **no** — named out |
| **Trip currency** | **no** — trip-level money, following the budget |
| **Members, invites, share links** | **no** — named out |
| **Notebook pages** | **no** — named out (and the bundle's `notebooks` section is templates only, so it never covered them) |
| **Lineage** (`forkedFrom`), trip status, dismissed conflicts | **no** — not days and not activities |
| Derived totals (`tripCostTotal`, `budgetRemaining`) | **no**, and never could be: they are computed from what is carried |

**Two readings of "days and activities" that the sentence did not settle. Both
were put to Mitchell and CONFIRMED on 2026-09-18:**

- **A stop's `cost` stays**, because it is a field *of an activity* and
  activities are in, while `budget` is a field of the *trip* and was named out.
  `Money` carries its own currency (`{ amountMinor, currency }`), so a stop's
  cost is self-describing and survives the trip-level `currency` going with the
  budget. One consequence to accept rather than discover: an imported trip has
  no currency of its own and falls to the domain's default, USD
  (`schema.ts:93`), even where its stop costs are all in JPY.
- **The backlog stays.** `BundleTrip.backlog` is *"parked ideas — no day, no
  clock, no price"* (`schema.ts:101`) — activities that have no day yet, not a
  separate kind of thing. Dropping them would silently lose real work on export.

**A property this narrowing buys, worth naming because it was a live concern.**
With members, invites and share links out, **an export cannot carry a copy of a
membership list out of the system**, and an exported file says nothing about who
else is on the trip. That concern is now closed by scope rather than managed.

**What it costs, stated plainly.** An export is not a backup. Re-importing your
own trip loses its budget, its collaborators, its notebooks and its history (the
last already decided, being a snapshot rather than the log). It is a copy of the
plan, which is the thing this milestone says it is.

### 2. Whether an exported trip's dates survive — *DECIDED 2026-09-18*

**A bundle trip takes exactly one of `startsInDays` or `startDate` — enforced,
not conventional**: `.refine((t) => (t.startsInDays === undefined) !==
(t.startDate === undefined), "give exactly one of startsInDays or startDate")`
(`schema.ts:103-105`).

Both answers were defensible and they are different products. `startDate` says
*this is my trip to Kyoto in March*, and re-importing it a year later imports an
expired trip. `startsInDays` says *this is a ten-day shape*, and is the form the
whole seeded library uses for the reason the schema header gives: a fixed start
date is an expired trip three months later and the homepage hero has nothing
upcoming to show (`schema.ts:34-38`). A backup wants the first; a template a
person re-uses wants the second.

**Decided: a dated trip exports its real `startDate`.** Mitchell, 2026-09-18.
The export is a copy of **your** trip, not a shape to re-use, so it says when the
trip is — and **re-importing it a year later producing an expired trip is the
correct answer**, not a defect to design around. A test asserting an import
lands in the future would be asserting the losing side of this decision.

**So an export emits `startDate`, or it emits neither anchor. It never emits
`startsInDays`.** That form stays exactly what it is today — the way *authored
library content* keeps itself upcoming — and nothing this milestone writes
produces one. The two shapes an export can take are therefore:

| The trip | What the bundle carries |
|---|---|
| Has a start date | `startDate`, its real one |
| Has none (`TripDetail.startDate` is `null`) | **neither** anchor — days by position |

**Nothing in the import path has to change for the dated half**, which is worth
saying because the dateless half below is not free: `tripStartDate`
(`toCommands.ts:68`) already reads `trip.startDate` first, so a dated bundle
imports correctly today.

**And there was a third case with no representation at all, decided the same
day.** `TripDetail.startDate` is `z.string().nullable()`
(`detail.ts:42`) — a trip with no dates set is an ordinary, shipped state — and
the `.refine` above meant such a trip **could not be expressed as a bundle trip**.

**Decided: a bundle trip may carry NEITHER anchor, and neither means dateless.**
Mitchell: *"The collection of days bundle can exist, we just have offsets, day 1,
not January 15th."* The days are then addressed by **position** — day 1, day 2 —
rather than by calendar date.

**The format is already shaped for this, which is why it is the cheap answer.**
`BundleDay` carries **no date field of any kind** (`schema.ts:72-83`): a day's
only identity in a bundle is its index in `days[]`. The anchor is the sole
date-bearing thing in a trip, so removing it leaves a structure that is already
complete — it is what a playbook has been since ADR-041. The `.refine` relaxes
from *exactly one* to **at most one** of `startsInDays` / `startDate`, which is
purely widening: **all four bundles under `content/` give `startsInDays`**
(checked), so nothing that exists becomes invalid, and `lint.ts` states no rule
about either field, so no content rule conflicts with it.

**It is NOT a one-line change, and the reason is a silent default.**
`tripStartDate` (`toCommands.ts:68`) reads:

```ts
return trip.startDate ?? addDays(today, trip.startsInDays ?? 0);
```

That `?? 0` already tolerates a missing `startsInDays`, so relaxing the refine
**alone** would make a dateless bundle import as *a trip starting today* —
dated, silently, and wrong. A trip that quietly acquires a start date it never
had is the same class as `budgetPerPerson` asserting a per-person meaning it did
not have. So the change is two things, and the second is the one that matters:

1. `.refine` relaxed to *at most one*.
2. **`tripStartDate` stops defaulting.** Absent both anchors it returns no date,
   and the day-creation path (`toCommands.ts:99-107`, which also derives
   `endDate` from `startDate` plus `days.length - 1`) builds days with no date
   rather than dates counted from today.

**Still open, and untouched by this**: which anchor a *dated* trip's export
emits. `startDate` says *my trip to Kyoto in March* and re-imports a year later
as an expired trip; `startsInDays` says *a ten-day shape* and is what the seeded
library uses, for the reason the schema header gives. A backup wants the first,
a re-usable template the second. That choice is still for the design pass.

### 3. Whose rules the linter states — *DECIDED 2026-09-18*

**An upload is validated by the schema and not by the content rules.** Mitchell,
2026-09-18: *"For linting, keep it simple, and wait for a real issue to emerge."*

**The reading, stated because the sentence admits two.** "Keep it simple" could
mean *run the existing linter on uploads and change nothing* — but that is not
waiting for an issue, because we already know which issues it produces. Three of
`lint.ts`'s rules are **errors** a legitimate user trip trips routinely:

- `"trip has no days"` — an error (`lint.ts:175`), and an empty trip is a real
  state the product creates on purpose.
- A day whose stops are not in clock order — an error (`lint.ts:97`), which a
  person reordering stops on their own board produces by ordinary use.
- `backlog item carries a time window` — an error (`lint.ts:191`).

Shipping that would reject real trips on day one. So the simple thing is the
**smaller** thing: `parseBundle` — the Zod parse, which is the actual
correctness boundary and the thing that makes a malformed file a 400 — runs on
uploads, and the content rules do not.

**The content rules keep their one job and their one audience.** They exist for
**authored library content** headed for Discover, checked in `content/` by
`content:verify` and `packages/fixtures/src/bundle/content.test.ts`. Nothing
about this decision touches them, and the file a person uploads to their own
account was never their audience.

**No subset, no second rule set, no per-audience flag** — which is the part that
would have been the machinery. If unlinted uploads turn out to cause a real
problem, that is the point to revisit, and this paragraph is the note saying it
was a decision rather than an oversight.

**One consequence for link 3.** Its *"a partially-invalid bundle"* bullet asks
what an upload does with the linter's **warnings**. With no linter on the path
there are none, so what is left is the schema's own all-or-nothing answer: a file
that does not parse imports nothing, and there is no partial state to design.

## Exit gate

- [x] **A trip exported and re-imported produces an equivalent trip**, proven by
      a test that **compares** the two structurally with the id remap applied —
      not by a person reading the JSON and not by a screenshot. Days in order,
      stops in order, and every `BundleStop` field (`title`, `timeWindow`,
      `location`, `notes`, `anchors`, `kind`, `tags`, `cost`) equal on both
      sides. **Equivalent over what is exported, which is days and activities
      and nothing else** (question 1) — a re-imported trip legitimately has no
      budget, no members and no notebook pages, and a test asserting otherwise
      is testing a scope this milestone does not have. This is the milestone's
      thesis and the box every later field addition has to keep green.

      **Green.** `packages/fixtures/src/bundle/fromTrip.test.ts` — the trip is
      built through the real command path (`decideTripCommand` + `evolveTrip` +
      `tripDetailFromState`), exported, imported and exported again. The
      assertion is a **fixed point**: what a person downloads, re-uploads and
      downloads again is the file they started with. Two normalisations are
      asserted rather than hidden — an omitted `kind` comes back as the
      explicit `"planned"` the format says it means, and a hand-authored
      `BundleDay.label` does not survive, because Trip Planning has nowhere to
      keep one. Seen red by deleting `notes` from the converter.
- [x] **A DATED trip round-trips with its real date**, and the bundle carries
      `startDate` rather than `startsInDays` — a trip starting on a fixed day
      exports that day, re-imports onto it, and **an export that has been
      sitting around imports as a past trip rather than being shifted forward**.
      A test that asserts an imported trip starts in the future is asserting the
      losing side of this decision and is the finding, not the fix. *(Decided
      2026-09-18; see question 2.)*

      **Green.** Same file. A 2019 start date imports onto 2019 and its day 1
      carries that date; the export emits `startDate` and never `startsInDays`.
- [x] **A DATELESS trip round-trips as dateless, and does not quietly acquire
      today's date.** A trip whose `startDate` is `null` exports a bundle with
      **neither** `startsInDays` nor `startDate`; re-imported, it is still
      dateless, and its days are still in order. A test that pins this **must be
      seen to fail first against the current `tripStartDate`**
      (`toCommands.ts:68`), whose `?? 0` resolves a missing anchor to *starting
      today* — the defect this box exists to catch is silent, so a test that
      passes before the change proves nothing. *(Decided 2026-09-18; see open
      question 2.)*

      **Green, and seen red first exactly as this box requires.** The failure
      text was `startDate: "2026-09-06"` — the `TODAY` the test passes in, i.e.
      the defect this box describes, reproduced. `packages/fixtures/src/bundle/schema.test.ts`
      → *a trip with NEITHER anchor*.

      **The fix was larger than this box's own note budgets, and the extra part
      is worth knowing.** Relaxing the `.refine` and un-defaulting
      `tripStartDate` are both necessary and together still not sufficient:
      `SetTripDates` with both dates null emits **no `DayAdded` at all**
      (`decide.ts` guards the whole day-count reconcile on both being
      non-null), so a dateless trip's days would simply not have existed.
      `bundleTripCommandGroups` grows a second shape for it — `AddDay` per day,
      which is what the board itself does on an undated trip.
- [x] **An upload MINTS fresh ids and can never overwrite an existing trip.**
      The same file uploaded twice produces **two** trips. A file whose content
      would derive onto an existing row through `bundleId`
      (`packages/fixtures/src/bundle/ids.ts:39`) still produces a new trip.
      Demonstrated by uploading a file exported from another account and
      watching the original trip go untouched.

      **Green.** `apps/web/src/server/public-api/export.int.test.ts`, against
      real Postgres: the same file uploaded twice produces two trips with
      different trip, day and activity ids, and the trip it was exported from
      is untouched. Seen red by making the ids derived the way the content
      script does — two imports then shared a day id.
- [x] **A malformed bundle is refused at upload with a readable error**, as a
      400 naming what is wrong, with **nothing written** — the schema's
      all-or-nothing answer, not a partial import. *(`parseBundle` only: the
      content lint rules do not run on uploads — decided 2026-09-18, open
      question 3.)*

      **Green.** Same file. A stop whose time window ends before it starts is a
      400 whose `details` carry zod's own issue list naming `timeWindow`, and
      the refusal happens in the wrapper before the first command — so there is
      no partial state to design. No error handling is written by hand.
- [x] **A real trip that the CONTENT rules would reject still round-trips** —
      an empty trip, a day whose stops are out of clock order, and a backlog
      item carrying a time window each export and re-import cleanly. This is the
      box that fails if somebody later wires `lint.ts` into the upload path.

      **Green.** `fromTrip.test.ts` round-trips an empty trip, a day whose
      stops are out of clock order, and a backlog item carrying a time window —
      all three `lint.ts` errors, all three things ordinary use produces.
- [x] **The OpenAPI document at `GET /api/v1/openapi` describes the export
      endpoint with no hand-editing** — its scope, its role, its response — and
      `pnpm --filter web openapi:generate` is the only thing that touched the
      file. M22's generated-from-declarations property, re-measured on an
      endpoint it did not design.

      **Green, and measured.** `pnpm --filter web openapi:generate` is the only
      thing that touched the file, and `openapi.test.ts` regenerates and
      compares, so a schema changed without regenerating fails CI in the same
      diff. Checked structurally rather than by eye: the document gained
      **exactly two paths** (`/v1/trips/{tripId}/export`, `/v1/trips/import`)
      and **no existing path changed** — the large line count in the diff is
      key-ordering churn from inserting two sorted keys into one JSON file.

      **One thing this box produced that it did not ask for.** Declared with
      the full `ContentBundleV1` as its response, the export endpoint's
      generated entry was **2,267 lines**, almost all of it the recursive
      `PageDoc` AST under `notebooks` — a section an export never writes. An
      integrator reading it would have concluded that an export can return
      notebook documents. The response is `TripExportBundle` now (that same
      schema with three sections pinned empty — not a third format: same
      `$schema`, same `BundleTrip`, read back by `parseBundle` unchanged), and
      the entry is 792. The import body is `TripImportBundle` for the same
      reason, 26 KB → 9 KB. **The published reference has to be true, and
      "verbose" was the wrong word for what it was.** It also turned this
      milestone's *"no export of anything but a trip"* into a runtime
      assertion, since `route()` validates every response against its
      declaration.
- [x] **A `free`-plan account exports a trip and re-imports it, walked** — no
      entitlement anywhere on that path, and no upgrade prompt on any screen it
      touches.

      **Green, with one caveat named.** `apps/web/e2e/m25-trip-as-a-file.spec.ts`
      — a freshly signed-up (therefore `free`) account downloads by clicking,
      the spec reads the bytes that actually land on disk, uploads those same
      bytes through a real file chooser, and lands on a **different** trip from
      the one it came from. Reading the downloaded stream rather than the
      response body is the point: a `Content-Disposition` mistake or a
      client-side re-wrap would pass every other layer and hand somebody a file
      the importer refuses.

      **The caveat, stated rather than quietly dropped: *"no upgrade prompt on
      any screen it touches"* cannot be asserted as written.** The trip
      settings sheet, where the download lives, also hosts *Invite someone* —
      which M20 gates on `trip.collaborators` and M21 renders as a disabled
      form under a CTA to `plans`. That prompt predates M25, is about a
      different feature, and is correct. A blanket `toHaveCount(0)` failed on
      the first run, and making it pass would have meant moving the download to
      another screen to satisfy a test. The spec asserts the specific and
      stronger thing instead: the **only** upgrade prompt on that screen is the
      collaborators gate, it names inviting rather than exporting, and the
      download beside it is live.
- [x] **No new entitlement and no new plan version exist.**
      `packages/contracts/src/entitlement.ts` is unchanged, no plan version is
      published, and `premium@v1` and `premium@v2` are both byte-identical after
      this milestone. A test fails if an export path ever calls `accountCan`.

      **Green.** `packages/contracts` is **untouched on this branch** — the
      diff against the base is empty — so `Entitlement` is unchanged, no plan
      version is published, and `premium@v1`/`premium@v2` are byte-identical.
      `apps/web/src/server/public-api/export.free.test.ts` is the standing
      guard: it sweeps the four files a trip travels through for `accountCan`,
      `resolveEntitlements`, `not-entitled` and `api.tokens`, and pins
      `ENTITLEMENTS`' membership. Seen red by putting an `accountCan` call in
      the export route.

      **This box guards an ABSENCE, which is why it needed a test of its own.**
      Nothing on the export path checks an entitlement, so nothing on that path
      would go red when somebody adds one: a diff gating export behind
      `premium` would otherwise pass every test in this repo.
- [x] **Endpoint N+1 still costs a declaration**, measured on the export
      endpoint and reported as a diff: one route file under `v1/`, plus one pure
      converter in `packages/fixtures/src/bundle/`. **No auth, no scope
      plumbing, no error handling, no OpenAPI entry written by hand**, and no
      new scope added to `API_SCOPES` — `trips:read` already says this. Any
      exception beyond the two M22 named in advance is the finding, and this box
      does not tick.

      **Green, and this is M22's claim under its second and harder test.** M22
      measured it on `GET /v1/trips/{tripId}/members` — 18 lines slicing an
      array already on the context. This endpoint has a body to **build**,
      which is where the claim might not hold.

      The diff, reported rather than asserted:

      | What | Lines |
      |---|---|
      | `apps/web/src/app/api/v1/trips/[tripId]/export/route.ts` | 61, of which **21 are code** — the declaration, plus one `Content-Disposition` header |
      | `packages/fixtures/src/bundle/fromTrip.ts` | the pure converter, beside `toCommands.ts`, exactly as this milestone said it should be |
      | `apps/web/src/app/api/v1/openapi.json` | regenerated by `openapi:generate`; two paths added, none changed |

      **No auth, no scope plumbing, no validation, no error handling, no
      pagination, no rate limiting, no OpenAPI entry, no client and no MSW
      handler were written by hand, and no scope was added to `API_SCOPES`** —
      `trips:read` already said this, and `packages/contracts` has an empty
      diff on this branch. The route file did not grow a second
      responsibility, which is what this box exists to catch.

      **One thing did cost more, and it belongs to the IMPORT endpoint rather
      than to this box.** `maxBodyBytes` was added to the `route()` wrapper,
      because the wrapper owns body reading and a handler never sees the
      `Request`. Measuring the N+1 claim on the easier of the two endpoints and
      not saying so would not have been honest, so: the export endpoint added
      nothing to the wrapper; the import endpoint added one declaration field
      to it.
- [x] **Ownership comes from the session, never from the file.** A bundle whose
      `ownerId` names another account imports as the uploader's, and a test
      fails if any uploaded field reaches an owner column.

      **Green.** `export.int.test.ts` uploads a file naming another account in
      **both** places the format could — `bundle.ownerId` and a playbook's
      `ownerId` — and the uploader owns the result; the named author cannot
      reach it. It is a property of the shape rather than a scrub step: the
      only `ownerId` the format has belongs to a playbook, and this endpoint
      writes no playbook at all.
- [x] **An oversized upload is refused with the limit named**, as a 400 and not
      a truncation, a timeout or a 500.

      **Green, three ways.** Too many stops (1,000), too many days (366) and
      past the byte ceiling (2,000,000) each answer 400 with the limit in the
      message. The byte ceiling is **measured, not claimed** — `Content-Length`
      is a client's assertion and can be absent on a chunked upload — and
      measured in bytes rather than characters, because `"京".length` is 1 and
      costs 3 on the wire.

      **The counts matter more than the bytes**, which is why there are two:
      one stop is one `AddActivity` is one event, and 2 MB of `{"stops":[]}`
      would be 140,000 empty days. Both numbers are measured against real
      content rather than guessed — the largest authored trip under `content/`
      is 10 days and 66 stops in 55 KB.

      **400 rather than 413, deliberately**, because this box says 400 and a
      gate definition changes only by Mitchell's decision. `413 Payload Too
      Large` is the more precise status; the reason for not using it is
      recorded where the message is built, so the next reader finds the
      argument rather than the discrepancy.
- [ ] **The full Definition of Done is green, including
      `pnpm --filter web test:e2e:ci-like`** — not `test:e2e` (CLAUDE.md rule 1).
- [ ] Retro appended at gate close.

## Deliberately not here

- **No third format.** Decision 1 above. If this milestone's diff introduces a
  serialisation shape that is neither `content-bundle/v1` nor an existing
  contract, the decision was reversed by accident rather than by argument.
- **No event-log export and no history import.** Decision 2. An exported trip is
  a snapshot; re-importing starts a fresh stream. Naming it here stops it being
  assumed from the word "export".
- **No `v2` of the bundle format.** Whatever the open questions decide, anything
  this milestone adds is **additive** behind the existing `$schema` string. A
  breaking change to a format with 148 checked-in files is its own piece of
  work.
- **No export of anything but a trip.** Not the saved-days library, not a
  profile, not an account's whole data. The format carries `playbooks` and
  `notebooks` sections that this milestone writes nothing into; a library export
  is a plausible next milestone and is not this one.
- **No import UI for playbooks or notebook templates.** `POST /api/dev/content/
  playbooks` stays dev-gated and 404s in production (ADR-041 decision 4). This
  milestone adds a **user** surface for trips; it does not widen the existing
  dev door, which ADR-041 already says "should not be widened further without a
  reason".
- **No scheduled backups, no cloud sync, no third-party destinations.** A file
  the person downloads, and a file they upload.

## Prerequisites

**M22, and it must be closed** — or at least Phases 2 and 4, which are landed
(`M22-public-api-and-tokens.md:569`, `:685`). Link 1 is a `route()` declaration,
and it is a declaration only because the wrapper, `resolveActor`, the
conformance test and the OpenAPI generator already exist. Built before them,
this milestone would have paid for all four.

**Everything else already exists.** The format, `parseBundle`, the linter, the
pure converters and an importer that goes through the real write paths — all of
it ADR-041, landed 2026-09-06. `tripAccessFor` and the actor-accepting trip gate
are M22 Phase 2. Nothing new is needed underneath, and **no migration is
needed**: export reads existing projections and import writes through the
existing command API.

**Not blocked on M12, M13, M14, M19 or M21.** It reads no review, no realtime
transport, no widget and no subscription. It is placed ahead of them because
every one of them makes a trip carry more, and a round-trip test is cheaper to
write before that than after.

**Three things had to be decided before link 1 was built, and Mitchell decided
all three on 2026-09-18** — what the export carries (question 1: days
and activities, nothing else), what a dateless trip becomes (question 2: neither
anchor, days as offsets), and whose rules the linter states at upload (question
3: the schema's, and no content rules on the path).

**The last of them closed the same day**: a dated trip's export emits its real
`startDate`, and an export never emits `startsInDays`. **So nothing about this
milestone is waiting on a decision** — it is buildable from its file.
