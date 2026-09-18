# M25 — A trip is a file you can take with you — Implementation Plan

**Goal:** A person can download their trip as a JSON file and upload it back —
into their own account or somebody else's — and get an equivalent trip. An API
caller with a token can do the same through `v1`.

**Milestone:** `docs/milestones/M25-a-trip-is-a-file.md` — scope, the three
decided questions, and the 14-box exit gate. **This plan does not restate them.**
It records the decisions the *build* had to take that the milestone file leaves
open, and the task order.

**Spec:** There is no separate spec file. The milestone file is the spec; the
design conversation behind it happened 2026-09-18 and its decisions are recorded
there.

**Tech stack:** zod schemas in `packages/fixtures/src/bundle/`, the `route()`
wrapper (`apps/web/src/server/public-api/route.ts`), vitest (unit + `int`
against Postgres), Playwright for the walk.

---

## What this plan found before writing a line, and why each one changes the build

Four facts, each checked against the code rather than assumed. Three of them
make the milestone *smaller* than its file supposes; the fourth makes one link
bigger.

### 1. A session cookie satisfies every scope on a `v1` route

`public-api/actor.ts` says it outright: *"A session actor satisfies every scope
check. The frontend acts as the user with the user's full authority."*

**So link 2's UI download is the same endpoint link 1 builds, called from the
browser with the cookie it already has.** There is no second route, no BFF
mirror and no `apiClient` helper. The milestone's own table — *download the file
from the trip page: yes for `free`* — is satisfied by construction: `api.tokens`
gates **minting and verifying a token** (`verifyToken`), not a session, so a
`free` account never meets an entitlement anywhere on that path. The gate box
*"a test fails if an export path ever calls `accountCan`"* is then a real
assertion about real code, not a formality.

**It also means link 2 costs no MSW handler**, which matters because M22's *"the
cost this milestone does not eliminate"* names exactly that as the exception —
an endpoint the frontend adopts. A plain `<a href download>` is not `apiClient`
and never reaches MSW.

### 2. A `v1` **resource** response is returned raw; only a **collection** is enveloped

`route.ts:525` — `Response.json(shape === undefined ? payload : shape.data, …)`,
and `shape` is `undefined` only for a collection. A `ResourceDef` returns its
validated payload directly.

**So the export endpoint's response body *is* the bundle**, and the file a
person downloads is the file `parseBundle` reads back. Had it been enveloped,
every gate box in this milestone would still have passed while the actual
downloaded file was un-importable — the round trip would have been proven
against a payload no user ever holds. Worth stating because it is the kind of
thing that is only ever checked once.

The export declaration therefore takes `response: ContentBundleV1` and the
wrapper validates the bundle against its own schema on the way out, for free.

### 3. `SetTripDates` with both dates null adds **no days**

`decide.ts:177` — `if (startDate !== null && endDate !== null)` guards the whole
day-count reconcile. A dateless `SetTripDates` emits at most a
`TripStartDateSet` and nothing else.

**So M25's question-2 note is right that the dateless half is "not a one-line
change", and understates it.** The note asks for two things — relax the
`.refine`, and stop `tripStartDate` defaulting. Both are necessary and they are
not sufficient: with no anchor there is no `SetTripDates` that can build the
days at all, so `bundleTripCommandGroups` needs a **second shape** — `AddDay`
per day — for the dateless case. See Task 3.

### 4. Nothing about this milestone needs a migration, a contract change or an entitlement

Checked: export reads `TripDetail`, which is a projection that already exists;
import writes through `runCommand`/`runBatch`, which is the real write path;
`packages/contracts/src/entitlement.ts` is untouched. The only schema that moves
is `packages/fixtures/src/bundle/schema.ts`, which is a **fixture** format and
deliberately not a contract (its own header says why), so no
`docs/contracts/CHANGELOG.md` entry is owed.

---

## Decisions this build takes, that the milestone file leaves open

Numbered so a review can disagree with one by number. Each names the
alternative.

1. **The export route is `GET /api/v1/trips/{tripId}/export`; the import route
   is `POST /api/v1/trips/import`.** The export shape is the milestone's own
   (link 1). Import is a sibling of `POST /v1/trips` because it *is* a trip
   creation, and a static segment under `trips/` is unambiguous — no trip id is
   ever the literal string `import`.
   *Rejected: `POST /v1/imports`.* It names a resource that does not exist and
   that nothing can subsequently `GET`.

2. **Import takes a bundle carrying exactly one trip.** Zero trips is a 400
   naming it; two or more is a 400 naming the count and saying import takes one
   at a time. The response is the created `TripDetail`, symmetric with
   `POST /v1/trips`.
   *Why:* a `ResourceDef` validates against exactly one response schema (the
   same constraint that made the milestone reject `?format=bundle`), so
   "import N trips" would need a collection response and a partial-failure
   story — and the milestone has already decided import is all-or-nothing.
   *The cost, stated:* the four authored bundles under `content/` are not
   user-importable. They are dev content with their own door
   (`api/dev/content/playbooks`, 404 in production), and widening that door is
   named out of scope by ADR-041 and by this milestone.

3. **`playbooks`, `notebooks` and the loose `activities` section of an uploaded
   bundle are ignored, not rejected.** A file that carries them still imports
   its trip.
   *Why ignored rather than rejected:* a bundle exported from a future version
   of this product, or hand-authored from `content/`, will legitimately carry
   sections this endpoint does not write. Refusing it would make the format's
   own versioning story a lie.
   *What it buys the gate for free:* **ownership cannot come from the file**,
   because the only `ownerId` the format has is `BundlePlaybook.ownerId` and no
   playbook is ever written. The gate box is proven by construction and then
   asserted by a test, rather than by a scrub step that could be forgotten.

4. **An export's `bundle.id` and `trips[0].key` are the trip's name, slugified,
   falling back to the trip's uuid.** Both fields are `^[a-z0-9-]+$`, and a
   uuid matches that regex, so the fallback is always valid — which matters
   because a trip named `京都` slugifies to nothing.
   *Why it does not matter which:* the key's job in the format is to **derive**
   ids so a re-import updates rows. An upload mints fresh ids instead
   (decision 5), so the key is documentation, and readable-when-possible is
   strictly better than uuid-always.

5. **An upload mints fresh ids by passing an explicit `tripId` to
   `bundleTripCommandGroups`.** The function already takes `options.tripId`, and
   already defaults `mintId` to `crypto.randomUUID()` for days and activities.
   So "never overwrite an existing trip" costs one `randomUUID()` and the
   *absence* of a call to `tripIdFor`.
   *This is the single most important line in the milestone* and it is one
   line, which is worth saying because the milestone file budgets link 3 as its
   larger half largely on account of it.

6. **Two ceilings, both named in their 400.** A **byte** ceiling on the request
   body, and a **stop-count** ceiling on the parsed bundle. Bytes are the DoS
   answer; stops are the real cost driver, because one stop is one command is
   one event, and a 200 KB file can carry ten thousand of them.
   The byte ceiling is declared on the route (`maxBodyBytes`, added to the
   wrapper — see decision 7); the stop ceiling is the handler's own business
   logic, since no other endpoint has one.

7. **`maxBodyBytes` is added to the `route()` wrapper, not hand-rolled in the
   handler.** The wrapper owns body reading; a handler cannot see the request.
   Hand-rolling it would mean a second body read and a second error shape.
   *This is a change to M22's wrapper, and it is deliberately not counted
   against M25's "endpoint N+1" gate box* — that box is measured on the
   **export** endpoint, which adds nothing to the wrapper at all. The box is
   worded to measure the honest version of the claim, and quietly measuring it
   on the easier of two endpoints would not be honest.

8. **The import UI lives on Home, beside *New trip*; the export UI lives on the
   trip page.** Import creates a trip and Home is where trips are created.

---

## Global constraints

- **CLAUDE.md rule 3 — every new test is seen to fail for its reason** before it
  counts. The dateless test (Task 3) has this written into the gate box itself:
  it *must* be seen red against the current `tripStartDate`, because the defect
  it catches is silent and a test that passes beforehand proves nothing.
- **CLAUDE.md rule 4 — verification scales to the change.** Per task, run the
  `minimal-check-subset` skill's output. The full suite, including
  `pnpm --filter web test:e2e:ci-like`, is a final-review cost paid once.
- **CLAUDE.md rule 1** — an e2e result is only reported from
  `test:e2e:ci-like`.
- **No third format** (milestone decision 1). If a serialisation shape appears
  that is neither `content-bundle/v1` nor an existing contract, the decision was
  reversed by accident.
- **No new entitlement, no plan version, no migration, no contract change.**
- The bundle package is **pure** (invariant 4): `today` is passed in, never read
  off the clock, and nothing there touches a database.

---

## Tasks

### Task 1 — `tripToBundle`, the pure converter *(link 1, half)*

**Files:** create `packages/fixtures/src/bundle/fromTrip.ts` and
`fromTrip.test.ts`; export from `packages/fixtures/src/index.ts`.

`tripToBundle(trip: TripDetail, options): ContentBundleV1`. Days in order, each
day's stops in `activityIds` order, backlog in `backlog` order. `ActivityView`'s
`null`s become `BundleStop`'s omissions. A dated trip emits `startDate`; a
dateless one emits neither anchor. No budget, no currency, no members, no
notebooks, no lineage — question 1's scope line.

**Where the milestone's claim gets tested:** `BundleStop` is asserted to match
`ActivityView` field for field, so a later milestone adding a field to an
activity and not to the export fails here as well as in the round trip.

### Task 2 — `GET /v1/trips/{tripId}/export` *(link 1, half)*

**Files:** create `apps/web/src/app/api/v1/trips/[tripId]/export/route.ts`;
regenerate `openapi.json`.

`scope: "trips:read"`, `trip: "path"`, `role: "viewer"` (ADR-028 decision 3 — a
viewer may already clone). `response: ContentBundleV1`. `Content-Disposition`
via `responseHeaders`. The handler is the converter call and nothing else.

**Report the diff** — the gate box asks for one route file plus one pure
converter, and any third thing is the finding.

### Task 3 — A dateless bundle is importable *(question 2's build half)*

**Files:** `packages/fixtures/src/bundle/schema.ts` (the `.refine`),
`toCommands.ts` (`tripStartDate`, `bundleTripCommandGroups`), tests.

1. `.refine` relaxes from *exactly one* to *at most one* anchor. Purely
   widening — all four bundles under `content/` give `startsInDays`.
2. `tripStartDate` stops defaulting: no anchor returns no date.
3. `bundleTripCommandGroups` grows the second shape finding 3 requires —
   `AddDay` per day when there is no anchor, `SetTripDates` when there is.

**Seen red first, and the test says why.**

### Task 4 — `POST /v1/trips/import` *(link 3)*

**Files:** `apps/web/src/server/public-api/route.ts` (`maxBodyBytes`);
create `apps/web/src/app/api/v1/trips/import/route.ts`; tests.

`scope: "trips:write"`, no trip dimension — so the wrapper refuses a
trip-confined token for free, which is the constraint link 3 carries from M22.
`CreateTrip` with a minted id, then the command groups as batches.

### Task 5 — Download and upload in the browser *(link 2)*

**Files:** the trip page's action surface; Home's new-trip surface; tests.

### Task 6 — The round trip *(link 4)*

**Files:** an `int` test against real Postgres.

Build a trip through the real write paths, export it, import it, compare
structurally with the id remap applied. Dated, dateless, and a trip the
**content rules** would reject (empty; stops out of clock order; a backlog item
carrying a time window) — that last one is the box that fails if somebody later
wires `lint.ts` into the upload path.

### Task 7 — Definition of Done

Full suite, `test:e2e:ci-like`, an e2e script for the new flow, the gate boxes
ticked with evidence, and the retro.

---

## Not in this plan

- **M22's open gate box.** It needs a preview deployment with
  `API_TOKEN_PEPPER`, not code (`KI-20260916-d`), and nothing here touches a
  token path.
- **`docs/STATUS.md` is 486 lines**, well past the ~300 its own header calls the
  signal to cut. Noted rather than done: cutting it is its own piece of work
  with its own rule (a phase's narrative moves to its milestone file or a retro,
  verbatim, in the same commit), and doing it inside a kickoff commit would bury
  it.
