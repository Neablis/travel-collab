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
   - **A partially-invalid bundle.** The script's answer is all-or-nothing and
     stated in one line: `errors.length > 0` → *"n error(s) — nothing
     imported."* and exit 1 (`apps/web/scripts/import-content.ts:267-271`).
     Warnings do not block. Whether an upload keeps that rule — and what it does
     with the warnings, which the script prints to a terminal nobody is looking
     at here — is this link's to decide.

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

## Open questions — flagged, not answered

**These are for Mitchell, or for the design pass.** *(Question 2's third case
was decided 2026-09-18 and is marked in place; everything else below is open.)*

### 1. What a trip export must carry that the bundle does not model today

Checked against `packages/fixtures/src/bundle/schema.ts` and
`packages/contracts/src/detail.ts` rather than guessed:

| Part of a trip | In `BundleTrip`? |
|---|---|
| Stops — title, time window, location, notes, anchors, kind, tags, cost | **yes**, field for field (`BundleStop`, `schema.ts:54`) |
| Days, in order, with their stops | **yes** (`BundleDay`, `schema.ts:72`) — but see the label note below |
| Backlog | **yes** (`schema.ts:101`) |
| Trip name, currency, budget | **yes** (`schema.ts:90-96`) |
| Per-stop costs and the trip total | costs **yes**; totals are derived (`TripDetail.tripCostTotal`, `budgetRemaining`) and correctly absent |
| **Members** | **no.** `TripDetail.members` is `z.array(TripMember).min(1)` (`detail.ts:45`); `BundleTrip` has no member field of any kind |
| **Share links** | **no** |
| **Invites** | **no** |
| **Notebook pages authored on this trip** | **no — and this is the one most likely to be assumed.** The bundle *has* a `notebooks` section, and it carries **templates only**: `BundleNotebook` is `{ key, title, description, seedIntoNewTrips, content }` (`schema.ts:158-198`), trip-agnostic by construction. A real page is `Page` — `{ id, tripId, title, content, context, createdAt, updatedAt, actorId }` (`packages/contracts/src/pages.ts:281-289`) — with a `PageContext` bound to a `tripId` (`pages.ts:228-229`). The importer only writes notebooks at all when `--trip` names one, and it writes them as new pages. **The section exists; it does not cover this.** |
| **Lineage** (`forkedFrom`) | **no** (`detail.ts:55`) |
| **Trip status** (`active` / soft-deleted, ADR-016) | **no** |
| **Dismissed conflicts** (`dismissedConflictIds`, content-derived ids) | **no** |

Members, shares and invites are Access & Membership rather than planning state,
and whether a file should carry them at all is a real question rather than a
gap: an export naming collaborators is a copy of a membership list leaving the
system. Notebook pages are the largest missing piece by volume and would need a
section the format does not have.

### 2. Whether an exported trip's dates survive — *half of this is DECIDED, 2026-09-18*

**A bundle trip takes exactly one of `startsInDays` or `startDate` — enforced,
not conventional**: `.refine((t) => (t.startsInDays === undefined) !==
(t.startDate === undefined), "give exactly one of startsInDays or startDate")`
(`schema.ts:103-105`).

Both answers are defensible and they are different products. `startDate` says
*this is my trip to Kyoto in March*, and re-importing it a year later imports an
expired trip. `startsInDays` says *this is a ten-day shape*, and is the form the
whole seeded library uses for the reason the schema header gives: a fixed start
date is an expired trip three months later and the homepage hero has nothing
upcoming to show (`schema.ts:34-38`). A backup wants the first; a template a
person re-uses wants the second.

**There was a third case with no representation at all, and Mitchell decided it
on 2026-09-18.** `TripDetail.startDate` is `z.string().nullable()`
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

### 3. Whose rules the linter states

Found while reading `lint.ts` and recorded here because it decides what the
"refused at upload" gate box can assert. The content rules were written for
**authored library content**, and some of them are errors a **real user's trip**
can legitimately trip over:

- `"trip has no days"` — an **error** (`lint.ts:175`). A trip with no days is a
  real state.
- A day whose stops are not in clock order — an **error** (`lint.ts:97`),
  because for authored content written order *is* the order a person sees. A
  user who reordered stops on their own board produces exactly this.
- `backlog item carries a time window` — an **error** (`lint.ts:191`).
- A stop with no `location.city` — a **warning** (`lint.ts:113`), aimed at
  Discover matching, which a private trip does not care about.

So "export a real trip, import it, and it passes the linter" is **not
automatically true**, and the choice — run the content rules on uploads, run a
subset, or run none — is a decision, not a detail.

## Exit gate

- [ ] **A trip exported and re-imported produces an equivalent trip**, proven by
      a test that **compares** the two structurally with the id remap applied —
      not by a person reading the JSON and not by a screenshot. Days in order,
      stops in order, and every `BundleStop` field (`title`, `timeWindow`,
      `location`, `notes`, `anchors`, `kind`, `tags`, `cost`) equal on both
      sides. This is the milestone's thesis and the box every later field
      addition has to keep green.
- [ ] **A DATELESS trip round-trips as dateless, and does not quietly acquire
      today's date.** A trip whose `startDate` is `null` exports a bundle with
      **neither** `startsInDays` nor `startDate`; re-imported, it is still
      dateless, and its days are still in order. A test that pins this **must be
      seen to fail first against the current `tripStartDate`**
      (`toCommands.ts:68`), whose `?? 0` resolves a missing anchor to *starting
      today* — the defect this box exists to catch is silent, so a test that
      passes before the change proves nothing. *(Decided 2026-09-18; see open
      question 2.)*
- [ ] **An upload MINTS fresh ids and can never overwrite an existing trip.**
      The same file uploaded twice produces **two** trips. A file whose content
      would derive onto an existing row through `bundleId`
      (`packages/fixtures/src/bundle/ids.ts:39`) still produces a new trip.
      Demonstrated by uploading a file exported from another account and
      watching the original trip go untouched.
- [ ] **A bundle that fails the linter is refused at upload with a readable
      error** naming the file's own problem — the importer's `where` and
      `message` (`lint.ts:17-22`), not a generic 400. Nothing is written: a
      bundle with one bad day imports **zero** days, matching
      `import-content.ts:267-271`'s *"nothing imported"*.
- [ ] **The OpenAPI document at `GET /api/v1/openapi` describes the export
      endpoint with no hand-editing** — its scope, its role, its response — and
      `pnpm --filter web openapi:generate` is the only thing that touched the
      file. M22's generated-from-declarations property, re-measured on an
      endpoint it did not design.
- [ ] **A `free`-plan account exports a trip and re-imports it, walked** — no
      entitlement anywhere on that path, and no upgrade prompt on any screen it
      touches.
- [ ] **No new entitlement and no new plan version exist.**
      `packages/contracts/src/entitlement.ts` is unchanged, no plan version is
      published, and `premium@v1` and `premium@v2` are both byte-identical after
      this milestone. A test fails if an export path ever calls `accountCan`.
- [ ] **Endpoint N+1 still costs a declaration**, measured on the export
      endpoint and reported as a diff: one route file under `v1/`, plus one pure
      converter in `packages/fixtures/src/bundle/`. **No auth, no scope
      plumbing, no error handling, no OpenAPI entry written by hand**, and no
      new scope added to `API_SCOPES` — `trips:read` already says this. Any
      exception beyond the two M22 named in advance is the finding, and this box
      does not tick.
- [ ] **Ownership comes from the session, never from the file.** A bundle whose
      `ownerId` names another account imports as the uploader's, and a test
      fails if any uploaded field reaches an owner column.
- [ ] **An oversized upload is refused with the limit named**, as a 400 and not
      a truncation, a timeout or a 500.
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

**Two things must be decided before link 1 is built, not during it**: which date
form an export emits and what a dateless trip becomes (open question 2), and
whose rules the linter states at upload (open question 3). Both are small; both
change the shape of the first endpoint.
