# Using the API

The public REST API is everything under `/api/v1/**`. This page is for two
audiences: somebody writing a program against it, and somebody in this repo
adding an endpoint to it.

The surface is M22's. The design and the reasoning behind each decision are in
`docs/specs/2026-09-16-public-rest-api-and-scoped-tokens-design.md`; the scope
and the exit gate are in `docs/milestones/M22-public-api-and-tokens.md`.

**One section is not M22's**: *Taking a trip out, and putting one back* is
**M25** (`docs/milestones/M25-a-trip-is-a-file.md`), and its two endpoints were
built to measure M22's own claim that adding endpoint N+1 costs a declaration
and nothing else.

## For a caller

### Get a token

Account → Profile → **API tokens** → *New token*. Pick what it may do, pick how
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

### Discovery

A caller who knows only the host can find the reference without guessing:

- **`GET /api/v1`** — a small JSON index: the API's name, where the OpenAPI
  document is (`/api/v1/openapi`), and how to authenticate. No token.
- **`GET /.well-known/api-catalog`** — the same pointer in the standard shape
  (RFC 9727): an `application/linkset+json` linkset whose `service-desc` is the
  OpenAPI document. No token.

There is no `/.well-known/agent.json` or similar; those two are the entry points.

**`/.well-known/api-catalog` is not reachable by bots until the Vercel firewall
exempts it.** The firewall challenges automated traffic on every path outside
`/api/*`, and that rule is dashboard configuration, not code in this repo.
Mitchell adds the exemption (Vercel → Firewall → a bypass rule for the path
`/.well-known/api-catalog`); until then a browser can read it and a crawler
gets a challenge page. `/api/v1` needs nothing, since it is under `/api/*`.

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
(`POST /v1/trips`, `GET /v1/account`, `GET /v1/library`, `POST /v1/playbooks`). Creating a new trip
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
| 409 | `conflict` | Somebody else changed this trip first. **Re-read and retry** — this is the one refusal worth sending again unchanged |
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

### Creating a trip

`POST /v1/trips` takes a `name` and, optionally, dates:

```json
{ "name": "Lisbon", "startDate": "2027-05-01", "endDate": "2027-05-03" }
```

- **`name` alone** creates an undated trip with no days, as it always has.
- **`startDate` alone** dates the trip and adds no days.
- **`startDate` and `endDate`** date the trip and give it one day per date —
  three days above. There is no `endDate` field on the trip you get back; the
  last day's `date` is the end.
- **`endDate` without `startDate`** is refused: `400`, *"An end date needs a
  start date."*

These mean exactly what they mean on `PATCH /v1/trips/{tripId}`, with the same
refusals (a date not on the calendar, an end before the start), and a refused
date creates **no trip at all**. Unlike `PATCH`, they cannot be `null` — a trip
being created has no dates to clear.

A trip with dates is created in two steps behind the one call. In the rare case
the second fails for a reason that is not your request (a server fault), you get
the error and the half-made trip is deleted, so it will not appear in your list
(`KI-2026-09-19-f`).

### Putting a stop on the map

A stop's `location` can carry coordinates, a postal address, or just a name.
The map draws coordinates only, so on `POST`/`PATCH …/activities` the server
fills them in when you leave them out, in this order:

1. **`lat` + `lng`** — used as sent. No lookup. Send both or neither.
2. **`address`** — geocoded as a structured address.
3. **`name`** — geocoded as free text, preferring places near the trip's other stops
   (and inside `countryCode`, if you set it).

If the lookup finds nothing, the stop is **still created**, without coordinates.
Every write whose body had a `location` answers with a `Geocode-Outcome` header:
`provided`, `address`, `name`, `no-match`, `quota-exhausted` or `unavailable`.
Lookups count against your account's daily geocoding allowance.

```json
{
  "title": "Dinner",
  "location": {
    "name": "Zum Roten Ochsen",
    "address": {
      "countryCode": "DE",
      "lines": ["Hauptstraße 217"],
      "locality": "Heidelberg",
      "postalCode": "69117"
    }
  }
}
```

**Addresses are structured, not one string.** `lines` is the street-level
part in the country's own order (`["221B Baker Street"]`, `["Hauptstraße 5"]`,
`["1-2-3 Nishi-Azabu"]`); `countryCode` (ISO alpha-2) is required; `locality`,
`dependentLocality`, `administrativeArea` and `postalCode` (a string) are
optional. The address is stored exactly as you send it — we never assemble one
from a geocoder's answer, because those come back as components with no
per-country ordering. Geocoding only ever *adds* coordinates to what you wrote.

If you send `countryCode` on the location as well, it must match the address's.
Two country fields that can disagree is a bug generator, so the write is
refused rather than one of them silently winning.

**To check a place before writing it**, `GET /v1/trips/{tripId}/geocode?q=…`
(optionally `&countryCode=JP`) returns up to five candidates. Each is a complete
`location`: send one back as-is and the write costs no second lookup. Needs
`trips:write` — a lookup spends the operator's geocoding allowance, so a
read-only token cannot make one. A spent allowance answers `429` with
`Retry-After`; a geocoder that is down answers `503`.

### Taking a trip out, and putting one back

Two endpoints, added by **M25**. Both speak `travel-collab/content-bundle/v1` —
the format `content/` is authored in — rather than a third vocabulary, so a file
you download is a file you can hand-edit and re-upload, and the schema behind it
already has a CI test over every checked-in example.

```bash
curl -H "Authorization: Bearer $TC_TOKEN" \
  https://…/api/v1/trips/$TRIP/export > kyoto.json

curl -X POST -H "Authorization: Bearer $TC_TOKEN" \
  -H "content-type: application/json" \
  --data-binary @kyoto.json https://…/api/v1/trips/import
```

| | Scope | Role | Notes |
|---|---|---|---|
| `GET /v1/trips/{tripId}/export` | `trips:read` | `viewer` | The response body **is** the file. A viewer may export, because a viewer may already clone (ADR-028 decision 3). |
| `POST /v1/trips/import` | `trips:write` | — | Creates a trip, so a **trip-scoped token is refused**, exactly as `POST /v1/trips` refuses one. Answers the created `TripDetail`. |

**Six things worth knowing before you write against them:**

1. **An export carries days and activities. Nothing else.** No budget, no
   currency, no members, invites or share links, no notebook pages, no lineage
   or trip status. A stop's own `cost` **is** carried — it is a field of an
   activity, and `Money` names its own currency. So is the backlog. This is a
   scope line taken deliberately (Mitchell, 2026-09-18), not a gap; one thing it
   buys is that **an export cannot carry a membership list out of the system**.
2. **An export is a snapshot, not a backup and not the event log.** A
   re-imported trip starts a fresh stream — no undo, no redo, no history.
3. **An import MINTS ids.** The same file uploaded twice gives you **two**
   trips. There is no upsert and no way to address an existing trip with a
   file, deliberately.
4. **Ownership comes from your credential, never from the file.** Anything a
   bundle says about who owns what is discarded.
5. **One trip per file.** Zero or two is a 400 saying which. `playbooks`,
   `notebooks` and the loose `activities` wishlist are read past rather than
   refused, so a file carrying them still imports its trip.
6. **Ceilings, refused and never truncated**: 2,000,000 bytes, 1,000 stops and
   366 days, each named in its own 400.

**Dates.** A dated trip exports its real `startDate` and re-imports onto it —
**including one in the past**, which is the intended answer rather than a
defect: this is a copy of *your* trip, not a re-usable shape, so a stale export
imports as a stale trip. A trip with no dates exports with **neither** anchor
and imports as dateless, its days addressed by position. Export never emits
`startsInDays`; that form is how authored library content keeps itself upcoming.

**Validation is the schema's, not the content linter's.** `lint.ts` states rules
for library content headed for Discover, and three of them are errors an
ordinary trip trips routinely — an empty trip, stops out of clock order after
you reorder a board, a backlog item carrying a time window. None of those stops
an upload. A file that does not parse imports **nothing**; there is no partial
import.

**Export is free; the API is not.** Downloading a trip from the app needs no
plan. Calling these endpoints needs a token, and a token needs `api.tokens`,
which is `premium@v2` — so `GET /v1/trips/{tripId}/export` answers 402 for an
account that cannot hold one. That is *the API* being gated, exactly as it is
for `GET /v1/trips`; the free path is the UI one.

### Playbooks: keeping days, and applying them to a trip

A Playbook is one or more days kept from a trip, in an order you choose. It is
the same thing as a saved day in your library — `/v1/playbooks` and
`/v1/library` list the **same items** — but `/v1/playbooks` speaks in several
days, where `/v1/library` keeps its published singular `dayId` (ADR-050).

| | Scope | Role | Notes |
|---|---|---|---|
| `GET /v1/playbooks` | `library:read` | — | Newest first, paged like every collection |
| `POST /v1/playbooks` | `library:write` | `viewer` on the source trip, checked by hand | `{ tripId, name, dayIds }`. Answers the `SavedDay`, 201 |
| `GET` / `PATCH` / `DELETE /v1/playbooks/{playbookId}` | `library:read` / `library:write` | — | Exactly `/v1/library/{savedDayId}`: `PATCH { visibility }` publishes; a published Playbook must be unpublished before it can be deleted (409) |
| `POST /v1/trips/{tripId}/playbook-applications` | `trips:write` | `editor` on the destination | `{ playbookId }`. Answers 201 |

**`dayIds` is an ordered set, not a range.** Keep days 5, 1 and 3 and you get a
three-day Playbook whose day 0 is your day 5. The same day twice is refused, and
so is a selection with no stops at all; an empty day among others is kept as a
rest day.

**A trip-confined token cannot keep a Playbook**, not even from a trip it
names. The source trip is in the body, and the collection is not about one trip,
so it is refused the way every tripless endpoint refuses one.

**Applying** appends every day of the Playbook to the end of the trip, empty
days included, with every stop on the day it belongs to:

```json
{ "tripId": "…", "playbookId": "…",
  "dayIds": ["…", "…"], "activityIds": ["…", "…", "…"], "historySeq": 42 }
```

- **Atomic.** All of it lands or none of it does.
- **Append-only.** Nothing already in the trip moves or changes.
- **One undo.** The whole application is one history entry, and `historySeq` is
  that entry's revision — while it is the trip's last change, one
  `POST …/history/undo` takes all of it back.
- **Fresh ids, every time.** `dayIds[i]` is the Playbook's day `i`, and
  `activityIds[i]` is its `stops[i]`. The same Playbook applied twice gives you
  two sets of days.
- **Nothing of the source trip comes across** — not its dates, not its ids. A
  stop carries its title, time window, place, notes, anchors, kind, tags and cost.
- **Somebody else's Playbook** applies if they published it, and is a 404 if
  they did not — the same answer as one that does not exist.

**Not yet (Phase 2):** applying some of a Playbook's days, composing a Playbook
inline in the request, editing a Playbook's content or versioning it, an
`Idempotency-Key`, and an `expectedTripSeq` precondition. Until those last two
exist, **a retried apply appends twice** — check the trip before resending one
whose answer you did not see.

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
    summary: "List the people on a trip and their roles",
    scope: "trips:read",
    trip: "path",
    role: "viewer",
    collection: { item: TripMember, cursorOf: (m) => m.userId },
    handle: ({ trip, page }) => trip!.members.slice(0, page.limit),
  },
});
```

That is the entire cost. **`summary` is required by the type**: one plain line
saying what the call does for the caller, published as the operation's title in
the reference. `openapi.test.ts` fails if the generator ever falls back to
restating the path. The wrapper does credential resolution, the scope check,
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
