# A public REST API, scoped tokens, and a route layer that does not grow linearly

**Status: PARTLY DECIDED — 2026-09-16.** Nothing is built. Of the five
questions this document opened with, **Mitchell answered three the same day**:
placement (**M22, after M21** — see *Placement*), entitlement (**`premium` only,
both minting and using** — Decision 12), and that the REST-vs-commands choice
could not be answered without knowing what the routes do (the *Endpoint
inventory* now below exists for that, and **that question stays open**).
**One new question was surfaced by the entitlement answer** and is Mitchell's:
what happens to anyone holding `premium@v1`. See *Questions still open*.

**Opened by:** Mitchell, 2026-09-16 — *"Make a plan to design a api, and the
ability for accounts to generate scopes api tokens for account, or trip, etc.
Most importantly I want the api to not require infinite maintenance as we add
new endpoints, it should have a logical separation of routes to either support
frontend or api and register the routes we expose, but to not require separate
specific functionality."*

Scope fixed by the same message: **user accounts only — no admin surface, no AI
surface, pure REST.** Those three exclusions are treated as boundaries
throughout, not as a first cut.

## The requirement, decomposed

Four things were asked for, and they pull against each other in one specific
place:

1. Accounts mint and revoke tokens, scoped to the account or to a trip.
2. Routes are separated into "serves our frontend" and "is the public API".
3. What we expose is **registered**.
4. Adding an endpoint must not cost per-endpoint plumbing.

(3) and (4) are the tension. A registry is a list, a list is a second place the
truth lives, and a second place is exactly the drift AGENTS.md invariant 5 and
ADR-037 exist to forbid — *"a hand-maintained duplicate of the registry: exactly
the shape Invariant 5 exists to stop."* So the design below registers routes
**without a registry file**. That is the central claim and the thing most worth
attacking.

## What exists today, measured

Established by survey of the current tree, not from memory:

- **46 route handlers** under `apps/web/src/app/api/**`, and **nine distinct
  auth patterns** across them — bare `auth()`, `requireTripAccess`,
  `requireSavedDayRead`, `requireAdminApi`, dev env gates, Stripe HMAC, three
  deliberately public routes, the Auth.js handlers, and the AI admission
  pipeline. Every one is hand-written per route.
- **No inbound token auth of any kind.** No route reads `Authorization`;
  `apps/web/src/server/billing/stripeApi.ts:155`'s `Bearer` is outbound to
  Stripe. This is greenfield.
- **`apps/web/src/proxy.ts` does not match `/api/*`** — deliberately, via an
  explicit allowlist (`proxy.ts:116-131`). There is no edge seam to hang token
  auth on, and there should not be: JWT sessions with no adapter mean the Edge
  runtime has no database.
- **Revocation machinery already exists three times** — `trip_invites.revoked_at`,
  `trip_shares.revoked_at`, `entitlement_grants.revoked_at` — with a hard rule
  that expiry and revocation are **resolved on read, never swept**
  (`schema.ts:155-157`, guarded by `grants.retention.test.ts`).
- **Rate limiting already exists** — `rate_limit_counters` keyed
  `"<policy>:user:<id>"`, `consumeQuota(policies, userId)`, Postgres-backed and
  serverless-safe (`apps/web/src/server/quota.ts:16-24`). Enforced on exactly two
  routes today.
- **No OpenAPI or JSON-schema generation anywhere**, and zod is **v3**
  (3.25.76). Any doc generation must be v3-compatible.
- **`apiClient.ts` is hand-written**, ~36 helpers, all `ApiResult<T>`, all
  parsing responses through contract schemas. And `src/mocks/handlers.ts` is
  hand-written per route with no generator — *"adding a route means adding a
  handler"* (`docs/guidelines/connecting-the-parts.md`). **That is already a
  per-route maintenance cost**, and it is the honest baseline this design is
  measured against.

## The design

### Decision 1 — the public API is a directory, and the directory is the registry

`apps/web/src/app/api/v1/**` is the public API. Everything else under
`apps/web/src/app/api/**` is the frontend's BFF: session-cookie only, never
token-reachable, free to change shape without notice.

There is no list. **A route is public if and only if its file is under `v1/`.**
Next.js's file router is already a registry that nobody has to maintain, it is
already the thing that decides the URL, and it cannot drift from itself.

The default direction matters more than the mechanism. A new route written
anywhere else is private, versionless and token-inaccessible **without anyone
having to remember to make it so**. That is the same argument `allowDemo` was
made opt-in for (KI-2026-09-05-d): *"a route that forgets is refused, which is
the safe direction to forget in."*

This is a reinterpretation of "register the routes we expose" and is flagged as
such — the registration is a file location rather than an entry in a manifest.
If a manifest is wanted for its own sake, say so; it is buildable, and it will
drift.

### Decision 2 — one `route()` wrapper, and a route declares itself

Modelled directly on ADR-037's `WidgetDef`: one module carries everything about
itself, nothing about it lives anywhere else.

```ts
// apps/web/src/app/api/v1/trips/[tripId]/days/route.ts
export const { GET, POST } = route({
  GET: {
    scope: "trips:read",
    trip: "path",                 // a trip-scoped token is checked against [tripId]
    role: "viewer",               // minimum TripRole, handed to the existing seam
    query: ListDaysQuery,
    response: DayList,
    handle: async ({ actor, trip, query }) => ({ days: daysOf(trip, query) }),
  },
  POST: {
    scope: "trips:write",
    trip: "path",
    role: "editor",
    body: AddDayBody,
    response: Day,
    handle: async ({ actor, trip, body }) => { /* one AddDay command */ },
  },
});
```

The wrapper performs, once, for every route that will ever exist:

| Concern | Done once, in `route()` | Cost per new endpoint |
|---|---|---|
| Cookie **or** bearer credential resolution | yes | none |
| Token scope check | yes | one `scope:` string |
| Trip-scope check (token restricted to trip ids) | yes | one `trip:` field |
| Member role check (via `requireTripAccess`) | yes | one `role:` field |
| Request body / query parse + 400 shape | yes | the schema you needed anyway |
| Response validation against its schema | yes | the schema you needed anyway |
| Error envelope, status codes, `WWW-Authenticate` | yes | none |
| Rate limiting | yes | none |
| `last_used_at` touch | yes | none |
| Cursor pagination | yes | none |
| OpenAPI entry (Decision 9) | yes | none |

**This is the answer to "no separate specific functionality."** The handler body
contains the thing the endpoint actually does and nothing else. What remains per
endpoint is a declaration of intent — which is irreducible, and which the repo
already treats as a feature rather than a cost: `MINIMUM_ROLE` in
`accessPolicy.ts` is *"an exhaustive Record so a new TripCommand fails to
compile until someone decides who may run it."*

### Decision 3 — two credentials, one principal

```ts
type Actor =
  | { userId: string; via: "session" }
  | { userId: string; via: "token"; tokenId: string;
      scopes: ReadonlySet<ApiScope>; tripIds: ReadonlySet<string> | null };
```

A **session** actor satisfies every scope check — the frontend acts as the user
with the user's full authority, which is exactly what it does today. A **token**
actor satisfies only its granted scopes. Both then flow into the *existing*
authorization seam unchanged.

**Two gates, in order, never one replacing the other:**

1. Does this token permit this operation? (scope, and trip-set if applicable)
2. Does this *user* have this role on this trip? (`requireTripAccess`, untouched)

So **a token can never grant more than its owner holds**, and it degrades
automatically: revoke someone's membership and every token they hold loses that
trip in the same instant, because gate 2 is the same query it always was. No
token state has to be reconciled when a membership changes — an important
property to have for free rather than to maintain.

One refactor is required and it is small: `requireTripAccess` calls `auth()`
itself (`trip-access.ts:126`). It gains an actor-accepting sibling; all 46
current call sites keep working against the old signature.

### Decision 4 — a small scope vocabulary, exhaustively described

Following `Entitlement`'s stated rule — *"a capability that exists is a
capability someone will eventually check"* — and its refusal of any ordering.

```ts
export const ApiScope = z.enum([
  "trips:read",    "trips:write",
  "notebook:read", "notebook:write",
  "library:read",  "library:write",   // saved days
  "account:read",
]);
```

Seven, deliberately not per-endpoint and deliberately not per-table. **No
ordering export, no `atLeast`** — same reasoning as ADR-045 rule 4: a comparison
operator anywhere near this forces every later scope to be a superset of an
earlier one, permanently and quietly. `trips:write` does not imply `trips:read`;
a token asks for both.

Absent by Mitchell's own constraint, and each absence is load-bearing rather
than a TODO: **nothing for AI** (`/ask`, `/ask/apply` are not in `v1` and no
scope names them), **nothing for admin** (`/api/admin/**` stays where it is,
still 404-on-failure), **nothing for billing writes** (checkout and the portal
move money and are session-only forever).

The token-creation UI reads an exhaustive `Record<ApiScope, {title, description}>`
— so a new scope **fails to compile** until somebody writes the sentence a user
will read when deciding whether to grant it. The catalogue is derived from the
enum, not kept beside it.

### Decision 5 — token targets: account-wide, or a set of trips

- `tripIds: null` — every trip the owner can reach, including ones created
  later. Follows membership live.
- `tripIds: [...]` — exactly those, and only while the owner still has the role
  gate 2 demands.

A route declaring `trip: "path"` or `trip: "body"` is checked against the set. A
route with **no trip dimension** (`POST /v1/trips`, `GET /v1/account`) is
**refused to a trip-scoped token** — creating a new trip from a token restricted
to two existing ones is a widening, and the safe answer is the boring one.

### Decision 6 — tokens are hashed at rest, breaking with the invite/share precedent

Invite and share tokens are stored **plaintext**, and the schema says exactly
why (`schema.ts:292-295`): *"because the owner's invite list has to be able to
re-show a link they already handed out."*

**That justification does not transfer.** An API token is shown once at creation
and never again — the industry-standard behaviour, and the one a user will
expect. Nothing needs to re-show it, so nothing needs to store it.

- Format `tc_<base64url(32 random bytes)>`. The `tc_` prefix is what makes it
  greppable by GitHub secret scanning and by a human reading a log.
- Stored: `sha256(secret)` with a unique index, plus a `prefix` of the first 8
  characters for the list UI (`tc_7Fq2xR9a…`). Lookup stays one indexed equality
  select — same cost as the invite lookup today.
- **SHA-256, not bcrypt/argon2, and that is deliberate.** The secret is 256 bits
  of CSPRNG output; there is no low-entropy space to brute-force, so a
  deliberately slow KDF buys nothing and costs real latency on *every* API
  request. `node:crypto` `timingSafeEqual` is already established in
  `server/admission.ts:107-117` and `server/billing/signature.ts:124` for the
  comparison.

Table `api_tokens`, shaped on `trip_shares` (the closest structural precedent):

| Column | Type | Note |
|---|---|---|
| `id` | uuid PK | app-minted `randomUUID()`, per convention |
| `owner_id` | text, **no FK** | the standing convention (ADR-025); do not introduce the repo's first FK |
| `name` | text | what the user called it |
| `token_hash` | text, unique index | the lookup key |
| `prefix` | text | display only |
| `scopes` | text[] | parsed through `ApiScope` on read — a `text` column is not a guarantee |
| `trip_ids` | text[] nullable | null = account-wide |
| `created_at` / `last_used_at` / `expires_at` / `revoked_at` | timestamptz `mode: "date"` | the newer-table convention (KI-53) |

**Expiry and revocation are resolved on read and never swept** — the
`entitlement_grants` rule, and `grants.retention.test.ts` is the precedent for a
test that fails if someone later adds a cleanup job.

Revocation copies the one hard-won pattern from `revokeInvite`: the guarded
`UPDATE … WHERE id = ? AND revoked_at IS NULL RETURNING`, **never** a read
followed by a write. That comment records a real READ-COMMITTED bug (PR #71 §1);
it costs nothing to not repeat it. Already-revoked returns ok, not 404, matching
`revokeShare`. A non-uuid id returns 404 rather than a Postgres `22P02` 500
(KI-2026-09-05-x).

### Decision 7 — `last_used_at` is a write on a read path, and is coarsened

Every authenticated API request would otherwise write a row. The value is worth
having (it is how a user decides a token is dead) but not at that price:
**update only when the stored value is older than five minutes**, as a single
guarded `UPDATE`, fire-and-forget, never blocking the response. Precision is
"was this used today", which is the only question anyone asks of it.

### Decision 8 — rate limiting reuses `consumeQuota`, with no new infrastructure

Bucket `"api:token:<tokenId>"`, plus a global `"api:global"`. The policy shape,
the Postgres counter table, the 429 with `Retry-After`, and the fail-closed-to-503
behaviour when the counter store itself fails all already exist in
`server/quota.ts`. Session traffic is unaffected — it keys on `tokenId`, which a
session actor does not have.

### Decision 9 — the reference docs are derived, never written

`zod-to-json-schema` (zod **v3**-compatible, which matters here) walks each
route's declared `query`/`body`/`response` at build time and emits
`openapi.json`, served from `/api/v1/openapi.json`.

Because the declaration is the only source, **the documentation cannot drift
from the implementation** — it is the same "derived, never hand-written twice"
as Invariant 5 and ADR-015's tool schemas. This is the single largest answer to
"not infinite maintenance": the usual second and third copies of an API's truth
(the docs, and the client) stop existing as separate artifacts.

### Decision 10 — REST shape, decided once

- **Errors**: one envelope, `{ error: { code, message, details? } }`. Today's
  routes return `{ error: "unauthenticated" }` as a bare string, inconsistently.
  The v1 wrapper owns the envelope; the frontend routes keep what they have.
- **401** carries `WWW-Authenticate: Bearer`. **403** for a scope failure names
  the missing scope — it leaks nothing a caller does not already know about its
  own token, and it saves a support round trip.
- **Pagination**: cursor-based, `?limit=&cursor=`, on every collection, decided
  in the wrapper rather than per route.

### Decision 11 — the conformance test is what makes "registered" true

One test walks `src/app/api/v1/**/route.ts`, imports each module, and asserts
every exported HTTP method came from `route()` and carries a declared scope and
response schema. A raw `export async function GET` under `v1/` **fails CI**.

That is how the filesystem-as-registry is enforced rather than merely intended,
and it is the mechanism that makes the no-manifest claim survive contact with a
hurried future session. It follows the repo's own precedent of proving a claim
rather than asserting it (`planVersions.fourthPlan.test.ts`,
`moduleBoundary.test.ts`, `check-lint-wall.mjs`).

No lint-wall change is needed: `src/app/api/**` and `src/server/**` are already
the exempt shell, and everything here lives in one or the other.

### Decision 12 — API access is a `premium` entitlement, checked at mint time AND on every request

**Mitchell, 2026-09-16: *"Lets lock creating and using API keys behind top tier
for now."*** Recorded here as a named plan rather than a height, because this
codebase has no heights.

**"Top tier" has no meaning inside the Entitlements module and must not acquire
one.** ADR-045 rule 4 and M20's single most load-bearing rule refuse any plan
ordering — Mitchell's own words at the time were that tiers are *"not
necessarily subsets — each have their own access and functionality"*, and
`studio` exists as the standing proof that no rank can express the set
(it grants `trip.collaborators` **without** `ai.command`). `planVersions.noExtension.test.ts`
walks this file's AST and fails on a spread, an `extends`, a base-plan constant
or a rank comparison.

So the decision is recorded as: **`premium` grants `api.tokens`. `free`, `plus`
and `studio` do not.** That is a membership fact about one plan, expressible
with no ordering, and it is exactly the shape the module wants.

**The change is three lines and one new version:**

1. `Entitlement` in `packages/contracts/src/entitlement.ts` gains `"api.tokens"`
   — a fourth member of a vocabulary whose stated rule is that *"a capability
   that exists is a capability someone will eventually check."* This one is
   checked in two places, below. Contracts change, so: changelog entry, all
   consumers in the same PR.
2. **`premium@v2` is published** carrying `["ai.ask", "ai.command",
   "trip.collaborators", "api.tokens"]`, enumerated in full and never as
   `[...PREMIUM_V1, "api.tokens"]`.
3. The account sheet's plan surface learns the word.

**Adding it to `premium@v1` in place is not an option, and the repo already
stops you.** `planVersions.ts` is immutable and append-only; `noExtension.test.ts`
pins every published v1 entry field by field, so a diff that edits one fails a
test in the same diff. That is the mechanism working, not an obstacle.

**Both halves of "creating and using" are enforced, in different places:**

- **Minting** — `accountCan(userId, "api.tokens")` before a token is created.
  A `free` or `plus` account gets **402**, matching the existing
  `AI_NOT_ENTITLED_STATUS = 402` precedent rather than inventing a second shape.
- **Using** — every token-authenticated request resolves **the token owner's**
  entitlements and refuses with 402 if the answer is no. Resolved per request
  from the database, **never cached on the `api_tokens` row and never read from
  a JWT** — M20's third rule, whose stated reason is that *"a downgrade must
  bite before a token refreshes."* A cached entitlement on a token row would be
  that exact defect with a longer fuse, since a token lives for months.

**A lapse disables tokens; it does not revoke them.** `revoked_at` stays null,
the token simply stops being accepted, and re-subscribing restores every one of
them **with zero writes**. This is deliberately the same shape as M20's
decision that granted memberships cap at `viewer` **on read** rather than being
written down — same reasoning, same recovery property, and it means a billing
lapse can never destroy a customer's integration.

**The honest cost:** `entitlementsFor` is three queries (`heldPlanFor`,
`activeGrantsFor`, `standingFor`, run in parallel). Every API request now pays
them. The wrapper resolves **once per request and passes the result down** —
which is not an optimisation but the resolver's own documented contract
(*"Resolve once per request and pass down; never re-query per check"*). If it
ever matters, `heldPlanFor` and `standingFor` are collapsible into one join;
it is not worth doing speculatively.

### Placement — M22, after M21

**Mitchell, 2026-09-16: *"Im fine making it after M21."*** So this is **M22**,
running after M21's gate closes and before M12. Recorded in `TODO.md` and
`docs/milestones/README.md` as a **placement**, the same shape as ADR-018,
ADR-021, ADR-022 and the 2026-09-13 reorder.

**Placed, not scoped.** Per `TODO.md`'s standing tasks the milestone file
(scope + exit gate) is written *"before its first commit"*, and one open
question (REST vs command passthrough) still moves the scope materially. M19 is
the standing precedent for a milestone that is *"deliberately placed but not
scoped"*.

## Endpoint inventory — what the routes actually do

Written 2026-09-16 because the REST-vs-commands question was unanswerable
without it: *"dont think i know what any of the routes do, so i cant just say go
ahead and approve commands but not days."* Product language, not code.

### Every trip edit is one endpoint today, and it is 18 commands wide

`POST /api/trips/:id/commands` is **every single edit anyone makes to a plan**.
There is no `/days` endpoint to compare it against — that is why the question as
posed had no answer. The 18 commands, and what a person did to cause each:

| Command | What the user did | In a batch? |
|---|---|---|
| `CreateTrip` | Clicked "New trip" | no — it is a trip's first moment |
| `AddDay` / `RemoveDay` | "+ Day", or deleted a day | yes |
| `AddActivity` | Added a stop | yes |
| `UpdateActivity` | Edited a stop — title, time, place, notes, cost, tags, booked/idea | yes |
| `MoveActivity` | Dragged a stop to another day, position, or the backlog | yes |
| `RemoveActivity` | Deleted a stop | yes |
| `SetTripName` | Renamed the trip | yes |
| `SetTripStartDate` / `SetTripDates` | Picked dates (the second also adds/drops days to match) | yes |
| `SetTripCurrency` / `SetTripBudget` | Money settings | yes |
| `DismissConflict` | Dismissed an overlap warning | yes |
| `UndoLastChange` / `RedoChange` | Undo / Redo | no — decided against the log, not folded state |
| `RevertToState` | "Revert to here" in History | no |
| `DeleteTrip` / `RestoreTrip` | Deleted or restored the whole trip | no — stream-level |

### As REST, those 18 commands are 13 endpoints

They collapse, because several commands are the same HTTP shape:

| Endpoint | Commands it covers |
|---|---|
| `POST /v1/trips` | `CreateTrip` |
| `PATCH /v1/trips/:id` | **five** — name, start date, dates, currency, budget |
| `DELETE /v1/trips/:id` · `POST /v1/trips/:id/restore` | `DeleteTrip` · `RestoreTrip` |
| `POST /v1/trips/:id/days` · `DELETE …/days/:dayId` | `AddDay` · `RemoveDay` |
| `POST /v1/trips/:id/activities` | `AddActivity` |
| `PATCH …/activities/:id` | **two** — `UpdateActivity` and `MoveActivity` (a move is a patch of day + position) |
| `DELETE …/activities/:id` | `RemoveActivity` |
| `DELETE …/conflicts/:id` | `DismissConflict` |
| `POST …/history/undo` · `/redo` · `/revert` | `UndoLastChange` · `RedoChange` · `RevertToState` |

**Thirteen endpoints, of which ten are ordinary REST and three (undo, redo,
revert) are actions REST has no noun for.** That is the whole planning write
surface — not the open-ended list the question implied.

The one debatable row is `PATCH …/activities/:id` covering both edit and move:
one endpoint dispatching to two commands depending on which fields are present.
Splitting it costs one more endpoint and buys clarity; either is defensible.

### The finding that changes the recommendation

**The command endpoints are BFF-shaped.** They return the whole refreshed trip
**and** its history after every edit, because the board re-renders from the
mutation response. `/commands/batch` additionally wraps its input in an envelope
shaped for the browser's command queue.

So exposing them publicly is **not** the free option the first draft of this
document called it. It would freeze two things as public contract:

1. **`TripCommand` itself** — an internal discriminated union in
   `packages/contracts` that the domain adds to freely as the product grows.
   Made public, every new command becomes a compatibility question.
2. **A response shaped for our React re-render** — a full `TripDetail` plus
   history on every write, which is a large payload a third party did not ask
   for and cannot opt out of.

The apparent zero-per-endpoint saving is borrowed against a contract we would
rather keep free to change. **Recommendation: REST resources, thirteen
endpoints, and the command envelope stays internal.**

### What belongs in v1, and what does not

| In `v1` | Why |
|---|---|
| Trip detail, history, history-at-revision, globals | Already clean general-purpose resources; six screens read the first one |
| The thirteen planning writes above | The table above |
| Notebook pages — list, get, create, patch, delete | Textbook single-resource CRUD already |
| Saved days — list, get, create, delete, publish/unpublish | A clean collection and a clean two-state sub-resource |
| Share links — list, create, revoke | Clean; the public share read is already the most API-like thing in the app |
| Invites — create, revoke | Creates an invite and returns it; already general |
| Cities search | `?q=` in, list out |
| `GET /v1/account` | A "who am I" resource — **not** today's preferences blob, which has `isAdmin` bolted on for a menu item |
| A **reshaped** `GET /v1/trips` | Today's version overlays member lists purely so the Home avatar stack renders; v1 gets the plain collection |

| **Not** in `v1` | Why |
|---|---|
| `ask`, `ask/apply` | **Excluded by Mitchell.** A token may not spend model budget |
| `admin/*` | **Excluded by Mitchell.** Keeps its 404-on-failure posture |
| `billing/*`, the Stripe webhook | Moves money; session-only forever |
| `/access`, Discover, the leaderboard, profiles, `account/plan`, `account/preferences` | Composed screen payloads — each exists to fill one panel and would have to be redesigned to be worth handing out |
| `geocode` | Spends a metered third-party vendor allowance per call |
| `dev/*`, `sentry-example-api`, `health/ai-mode`, the auth handlers | Tooling and plumbing, not product |

Roughly **35 endpoints** in v1 at full build, of which 13 are the planning
writes and most of the rest already exist in a clean shape. Phase 2's two pilots
prove the wrapper; Phase 4 is then repetition, not design.

## The cost this design does NOT eliminate, stated plainly

**REST over an event-sourced planning domain requires a translation per write
endpoint, and no wrapper can derive it.**

Planning is command-based: `POST /api/trips/:id/commands` takes a `TripCommand`
from a discriminated union with an exhaustive `MINIMUM_ROLE` table. A REST
surface means `POST /v1/trips/:id/days` must *become* an `AddDay`. That mapping
is semantic and is real per-endpoint work.

So the honest claim is narrower than "endpoints are free":

- **Reads are close to free** — they are projection queries, and the projection
  DTOs are already contracts (`TripDetail`, `TripGlobals`, `SavedDay`, `Page`).
- **Writes cost one mapping each** — small, but not nothing.
- **Everything cross-cutting is free forever** — auth, scopes, validation,
  errors, docs, pagination, rate limits, the client, the mocks.

The zero-maintenance alternative — exposing `POST /v1/trips/:id/commands` as a
passthrough — **was examined and is now argued against**, on evidence the
inventory produced: those endpoints are BFF-shaped, so publishing them would
freeze both the internal `TripCommand` union and a React-re-render-shaped
response as public contract. See *The finding that changes the recommendation*.

So the recommendation is **thirteen REST endpoints for the planning writes**,
and the total is bounded and known rather than open-ended. Question 4 below is
what remains for Mitchell.

## What happens to the existing 46 routes

**Nothing. They are not migrated.** `v1/` starts empty and is populated
deliberately. The frontend keeps calling `/api/*`.

When an endpoint genuinely belongs to both audiences, it gets built in `v1/` and
the corresponding `apiClient.ts` helper switches its path — one line, opt-in,
reversible, never a big bang. Endpoints that stay outside `v1` are the
BFF-shaped ones (`GET /api/trips` with its member-avatar overlay is the clearest
example) and they keep their freedom to change.

This is what makes the separation cost nothing: it is *where the file lives*,
and the shared behaviour is *the wrapper*. Neither is a duplicated handler.

## Phasing

Each phase is independently reviewable, and **Phase 2 is the one that decides
everything** — if the wrapper is wrong, it is wrong 200 endpoints later.

| Phase | What lands | Proves |
|---|---|---|
| **0 — contracts + the entitlement** | `ApiScope`, `ApiToken` DTO, the error envelope, **`Entitlement` gains `api.tokens`**, **`premium@v2` published**, changelog entry. Own PR, per the contracts protocol. | The vocabulary, before anything depends on it |
| **1 — storage + module** | Migration `api_tokens`; `src/server/api-tokens/` — mint, list, revoke, verify, **and the `accountCan(owner, "api.tokens")` check on both mint and verify**. Integration tests against real Postgres. No routes. | Hashing, revocation races, resolve-on-read, and that a lapse disables without revoking |
| **2 — the seam** | `Actor`, `resolveActor`, `route()`, the conformance test, and **two pilot endpoints** (`GET /v1/trips`, `GET /v1/trips/:id`) | The whole design, at the smallest size that can fail |
| **3 — token UI** | A Tokens section in `AccountSettingsSheet` (the `PlanSection` precedent — a section, not a route): create with one-time reveal, list, revoke — **and what a `free`/`plus` account sees instead**, which is an upgrade prompt, not a hidden section. E2E. | A person can actually do this by clicking |
| **4 — surface + docs** | The rest of the v1 REST surface, `openapi.json`, `docs/guidelines/using-the-api.md` | That endpoint N+1 is cheap, measured rather than claimed |

Phase 3 satisfies the Definition of Done's reachability rule — *"on the preview,
what does a person click to see this?"* Phases 0–2 are explicitly **not**
clickable, and that is the answer their PR bodies must carry.

Phase 1 adds a migration, so its PR body says so and it needs an explicit
`migrate-production` dispatch.

## Questions — three answered 2026-09-16, two open

### Answered

1. **Placement — ANSWERED.** *"Im fine making it after M21."* → **M22**, after
   M21's gate, before M12. See *Placement* above. Read as "next after M21"
   rather than "somewhere after M21"; it is one line to move if that is wrong.
2. **Entitlement — ANSWERED.** *"Lets lock creating and using API keys behind
   top tier for now."* → **`premium` grants `api.tokens`**, checked at mint time
   and on every request. See Decision 12, including why it is recorded as a
   named plan rather than a tier height.
3. **Coexistence of the BFF routes and `v1` — NOT RAISED, so the recommendation
   stands**: they coexist permanently. Flagged here so it is visibly a default
   taken rather than a decision made.

### Open

4. **The planning-write surface — now a much smaller question than it was.**
   Mitchell, 2026-09-16: *"dont think i know what any of the routes do, so i
   cant just say go ahead and approve commands but not days."* Correct, and the
   question was unanswerable as posed: **there is no `/days` endpoint today.**
   Every trip edit goes through one endpoint that is 18 commands wide.

   The *Endpoint inventory* above now lays out all 18 in product language.
   Two things came out of writing it, and both narrow the decision:

   - **As REST, 18 commands are 13 endpoints**, ten of them ordinary and three
     (undo, redo, revert) actions REST has no noun for. The surface is bounded
     and listable, not open-ended.
   - **The command endpoints are BFF-shaped** — they return the whole refreshed
     trip plus history on every write. So the passthrough this document
     originally floated as "the only true zero-cost option" would publish both
     our internal command vocabulary and a response shaped for our own
     re-render. That is no longer a recommendation.

   **So the recommendation is the thirteen REST endpoints, and the command
   envelope stays internal.** What is left for Mitchell is to accept or reject
   that, plus one genuinely optional sub-question: whether `PATCH
   …/activities/:id` covers both editing and moving a stop (one endpoint, two
   commands) or they split (one more endpoint, less magic).

5. **NEW, surfaced by the entitlement answer: what happens to anyone holding
   `premium@v1`?** Adding `api.tokens` publishes `premium@v2` (Decision 12).
   A subscription pins `planId@vN` and reads its terms from that entry forever,
   and **there is deliberately no mechanism to move an existing subscriber** —
   M21 link 2's *what you bought is what you get*, and M20 amended
   version-migration out of scope explicitly. So **a `premium@v1` subscriber
   never gets API tokens** unless something is done.

   Three options, in increasing cost:

   a. **Accept it.** If M22 follows M21 closely, the `premium@v1` population is
      small or empty — M21 has not shipped, has 9 of 17 gate boxes, and has
      never charged a card. This is free if the gap is short.
   b. **Grant them `premium@v2`** — *recommended, and it needs no new
      machinery.* `resolveEntitlements` is the union of the conferred plan
      version and every active grant's pinned version, so an admin grant of
      `premium@v2` hands an existing v1 subscriber `api.tokens` **without
      touching their subscription**. The admin grant UI already exists (M20),
      and this is precisely the "comping, extending, fixing a billing dispute"
      use for which the hand-grant path was called *permanent infrastructure
      rather than scaffolding*.
   c. **Build version migration.** Real scope, explicitly amended out of M20,
      and not worth opening for this.

   **Measured 2026-09-16, and it makes (a) free today.** M21's exit gate
   records that the live purchase resolved `plus@v1` against real Stripe and
   charged $9, and states plainly that **`premium@v1` has never been purchased**
   — its Stripe Price has never even been resolved
   (`M21-subscriptions-and-billing.md`, link-2 gate box). **So the affected
   cohort is currently empty**, and option (a) costs nothing as things stand.

   That is a fact with a shelf life, and two things end it. M21 intends to
   **buy and refund one Premium subscription** to close that same gate box,
   which mints the first `premium@v1` row. And every real Premium sale after
   that adds one. **The cheapest moment to decide is now, while the answer is
   "nobody"** — after which it becomes (b), one admin grant per affected
   account.

6. **Two small ones, still unanswered and both cheap to defer.** Is seven the
   right number of scopes? And should tokens have a **mandatory** maximum
   lifetime (90 days, industry-typical) or an optional one defaulting to never
   expiring?

## What this design deliberately does not do

- **No admin surface.** `/api/admin/**` is untouched and keeps its
  404-on-failure posture; no scope names it and none ever should.
- **No AI surface.** `/ask` and `/ask/apply` are not in `v1`. A token cannot
  spend model budget, which also means the AI quota and entitlement paths need
  no changes at all.
- **No OAuth, no third-party app authorization, no webhooks out.** Personal
  tokens for the account holder, which is what was asked for. Each of those is a
  separate product with its own consent surface.
- **No edge-level token check.** JWT sessions have no adapter and the Edge
  runtime has no database (`proxy.ts:63-66`); a token must be verified against
  Postgres, so it is verified in the route, which is where every other check in
  this app already happens.
