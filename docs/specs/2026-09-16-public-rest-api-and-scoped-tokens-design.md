# A public REST API, scoped tokens, and a route layer that does not grow linearly

**Status: PROPOSED — 2026-09-16.** Nothing is built. This document exists to be
argued with; five questions at the bottom are Mitchell's and one of them
(placement) blocks the first line of code, because M21 is the current milestone
and AGENTS.md forbids building ahead of it.

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

There is a zero-maintenance alternative for writes and it should be named
because Mitchell may want it: expose `POST /v1/trips/:id/commands` as a
passthrough. Every planning mutation that exists or will ever exist becomes
available the day its command is added, with no endpoint work at all, because
`MINIMUM_ROLE` already decides who may run it. **It is not REST**, which is why
it is not the recommendation — but it is the only genuinely
zero-per-endpoint option, and a hybrid (REST resources for the common cases, the
command endpoint for the long tail) is defensible. Question 4 below.

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
| **0 — contracts** | `ApiScope`, `ApiToken` DTO, the error envelope, changelog entry. Own PR, per the contracts protocol. | The vocabulary, before anything depends on it |
| **1 — storage + module** | Migration `api_tokens`; `src/server/api-tokens/` — mint, list, revoke, verify. Integration tests against real Postgres. No routes. | Hashing, revocation races, resolve-on-read |
| **2 — the seam** | `Actor`, `resolveActor`, `route()`, the conformance test, and **two pilot endpoints** (`GET /v1/trips`, `GET /v1/trips/:id`) | The whole design, at the smallest size that can fail |
| **3 — token UI** | A Tokens section in `AccountSettingsSheet` (the `PlanSection` precedent — a section, not a route): create with one-time reveal, list, revoke. E2E. | A person can actually do this by clicking |
| **4 — surface + docs** | The rest of the v1 REST surface, `openapi.json`, `docs/guidelines/using-the-api.md` | That endpoint N+1 is cheap, measured rather than claimed |

Phase 3 satisfies the Definition of Done's reachability rule — *"on the preview,
what does a person click to see this?"* Phases 0–2 are explicitly **not**
clickable, and that is the answer their PR bodies must carry.

Phase 1 adds a migration, so its PR body says so and it needs an explicit
`migrate-production` dispatch.

## Questions for Mitchell — the first one blocks everything

1. **Placement.** M21 is the current milestone and AGENTS.md forbids building
   ahead of it. Does this become **M22** after M21's gate, or does it get placed
   out of order the way ADR-021 and the 2026-09-13 reorder did? No code should
   be written until this is answered.
2. **Is API access entitled?** A new `Entitlement` member (`api.tokens`) gating
   token creation on `plus`/`premium` is a one-line contracts change and one
   entry per plan version — the `studio` fourth-plan proof shows it costs no
   gate, resolver or authorization change. Or API access is free to every
   account. **This is a pricing decision, not an engineering one**, and it is
   the only part of this design that touches M20/M21 vocabulary.
3. **Do the BFF routes and `v1` coexist permanently?** My recommendation is yes,
   permanently, for the reason in *What happens to the existing 46 routes*. The
   alternative — v1 eventually becomes the only API and the frontend consumes
   its own public surface — is cleaner in the abstract and costs the freedom to
   shape a response for one screen.
4. **REST-only, or REST plus the command passthrough?** See *the cost this
   design does NOT eliminate*. REST-only was what was asked for; the passthrough
   is the only true zero-per-endpoint option and a hybrid is defensible.
5. **Two smaller ones.** Is seven the right number of scopes? And should tokens
   have a **mandatory** maximum lifetime (90 days, industry-typical) or an
   optional one that defaults to never expiring?

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
