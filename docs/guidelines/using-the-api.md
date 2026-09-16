# Using the API

The public REST API is everything under `/api/v1/**`. This page is for two
audiences: somebody writing a program against it, and somebody in this repo
adding an endpoint to it.

Everything here is M22. The design and the reasoning behind each decision are in
`docs/specs/2026-09-16-public-rest-api-and-scoped-tokens-design.md`; the scope
and the exit gate are in `docs/milestones/M22-public-api-and-tokens.md`.

## For a caller

### Get a token

Account settings → **API tokens** → *New token*. Pick what it may do, pick how
long it lives, copy the secret.

**The secret is shown once.** Nothing stores it — the database keeps a keyed
digest, not the value — so there is no screen anywhere that can show it to you
again. If you lose it, revoke it and mint another.

**API tokens are on the Premium plan.** A `free` or `plus` account sees the
section with an upgrade prompt rather than a hidden one.

### Call something

```
curl https://<host>/api/v1/trips \
  -H "Authorization: Bearer tc_..."
```

```json
{ "items": [ { "tripId": "...", "name": "Kyoto", "status": "active", ... } ],
  "nextCursor": "2026-09-16T10:00:00.000Z|3f1a5b6c-..." }
```

### The reference

`GET /api/v1/openapi` serves an OpenAPI 3.0 document describing every endpoint,
its scope, its required role, its request body and its response shape. It needs
no token.

**It is generated from the route declarations themselves**, so it cannot
describe an endpoint that does not exist or miss one that does.

### Scopes

A token holds a set of scopes and nothing is implied by anything else —
**`trips:write` does not include `trips:read`**. Ask for both if you need both.

| Scope | What a token holding it may do |
|---|---|
| `trips:read` | See your trips, their days and stops, costs, history, and existing share links |
| `trips:write` | Create, change and delete trips, days and stops; undo, redo and revert |
| `notebook:read` / `notebook:write` | Read / write the Notebook pages on a trip |
| `library:read` / `library:write` | Read / write your saved-days library, including publishing to Discover |
| `sharing:write` | Invite people to a trip, revoke invites, remove members, create and revoke share links |
| `account:read` | Who you are and what plan you hold |

**Inviting someone is `sharing:write`, not `trips:write`**, even though an invite
is a write against a trip. Letting another person into your trip is a materially
different power from adding a day, and a token minted to sync an itinerary
should not be able to hand a stranger editor rights.

### Trip-scoped tokens

A token is either account-wide or confined to named trips.

- **Account-wide** follows your membership live: trips you create later are
  included, and trips you leave are not.
- **Confined** reaches exactly the trips it names — and only while you still
  hold the role the endpoint needs. Remove yourself from a trip and every token
  you hold loses it on the next request.

**A confined token is refused on any endpoint that is not about one trip**
(`POST /v1/trips`, `GET /v1/account`, `GET /v1/library`). Creating a new trip
from a credential restricted to two existing ones is a widening.

### Two gates, always in this order

1. Does this **token** permit this operation? (scope, and the trip set)
2. Do **you** have the role this endpoint needs on this trip?

So **a token can never do more than you can**. There is no token state to
reconcile when a membership changes, because the second gate is the same query
the app has always run.

### Errors

One envelope, always:

```json
{ "error": { "code": "insufficient-scope", "message": "...", "details": { "required": "trips:read" } } }
```

| Status | Codes | What to do |
|---|---|---|
| 400 | `invalid-request` | Your request. `details` names the field |
| 401 | `unauthenticated`, `token-expired`, `token-revoked` | **Read the code.** Expired means mint a new one; revoked means somebody cut this token off |
| 402 | `not-entitled` | The account's plan does not include API access |
| 403 | `insufficient-scope`, `trip-out-of-scope`, `forbidden` | The first two are the token's limits; the last is yours |
| 404 | `not-found` | No such thing, or not yours |
| 429 | `rate-limited` | Honour `Retry-After` |
| 5xx | `server-error`, `service-unavailable` | Ours. Retry `service-unavailable` |

401s carry `WWW-Authenticate: Bearer`. 429s carry `Retry-After`.

### Expiry

**Every token expires — 365 days at most, 90 days by default. There is no
"never".** A request for a longer lifetime is refused rather than quietly
shortened.

The token list shows time remaining, and an expired token answers differently
from a revoked one so your logs can tell a schedule from a decision.

**To rotate a token: create its replacement, then revoke the old one.** There is
no rotate-in-place call. Both halves are single actions, so rotation is two
clicks or two calls.

**A lapsed plan disables tokens rather than revoking them.** Re-subscribe and
every token you hold works again, untouched.

### Pagination

Every collection takes `?limit=` (1 to 200, default 50) and `?cursor=`. A
response carries `items` and `nextCursor`; `nextCursor: null` is the end.

**The cursor is opaque — do not parse it.** A limit outside the range is refused
rather than clamped, so you cannot silently page forever against a number the
server quietly changed.

### What is not here, and will not be

- **The assistant.** A token cannot spend model budget.
- **Admin.** That surface is not in `v1` and no scope names it.
- **Billing.** Checkout and the portal move money and are session-only forever.
- **Managing tokens.** Minting and revoking are session-only — a token that
  could mint tokens could widen itself and outlive its own revocation.
- **`/api/*` without `v1`.** Those routes serve this app's own frontend. They
  are cookie-only, they are not versioned, and they change shape without notice.

## For somebody adding an endpoint

### The whole of it

A route is public **if and only if its file is under
`apps/web/src/app/api/v1/**`**. There is no registry file and there must never
be one — the Next.js file router already decides the URL and cannot drift from
itself.

```ts
// apps/web/src/app/api/v1/trips/[tripId]/members/route.ts
export const { GET } = route({
  GET: {
    scope: "trips:read",
    trip: "path",
    role: "viewer",
    collection: { item: TripMember, cursorOf: (m) => m.userId },
    handle: ({ trip, page }) => trip!.members.slice(0, page.limit),
  },
});
```

That is the entire cost. The wrapper does credential resolution, the scope check,
the trip confinement, the role gate, request parsing, response validation, the
error envelope, status codes, `WWW-Authenticate`, rate limiting, `last_used_at`
and pagination — once, for every endpoint that will ever exist.

**`conformance.test.ts` fails CI on a raw `export async function GET` under
`v1/`**, and on a declaration that names a trip without a role. That is what
makes "the directory is the registry" true rather than intended.

### What a new endpoint still costs

Three things, stated so nobody is surprised:

1. **A write costs one command mapping.** `POST /v1/trips/:id/days` has to
   *become* an `AddDay`. That translation is semantic and no wrapper can derive
   it. `server/public-api/commands.ts` removes everything around it —
   `runCommand`, `runBatch`, and the refusal mapping — so what is left is the
   sentence that says which command this endpoint is.
2. **An endpoint the frontend itself adopts costs an MSW handler.**
   `src/mocks/handlers.ts` is hand-written per route. Endpoints only external
   callers use cost nothing there.
3. **Regenerate the reference**: `pnpm --filter web openapi:generate`. Forgetting
   fails `openapi.test.ts`, which is the same walk, so it cannot go stale
   silently.

### Rules that are not negotiable

- **Never put a scope on an admin or AI surface.** The exclusions are Mitchell's,
  fixed at placement.
- **Never cache an entitlement on a token row.** Entitlements resolve per request
  from the database — a downgrade must bite before a token refreshes, and a
  token lives for months.
- **Never sweep `api_tokens`.** Expiry and revocation resolve on read. An expired
  token is refused, not deleted, because the row is how its owner learns what
  happened. `apiTokens.retention.test.ts` fails if a deletion appears.
- **A confined token must be refused on tripless endpoints.** The wrapper does
  this; an endpoint that reaches a trip from its *body* rather than its path has
  to check it by hand — `POST /v1/library` is the worked example.

### Deployment

**`API_TOKEN_PEPPER` must be set wherever the app runs.** Tokens are stored as
`HMAC-SHA256(pepper, secret)`, so a stolen database cannot verify one. Unset,
minting and verifying both throw rather than falling back — an empty pepper
would still produce a stable digest, and tokens would keep working while the
property the key exists for silently did not hold.

Generate with `openssl rand -base64 32`. **Rotating it invalidates every token**,
with no migration path. That is the right blast radius for a key compromise, and
it is why it is not `AUTH_SECRET`: rotating sessions and rotating API credentials
are different emergencies.
