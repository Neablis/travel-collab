# ADR-059: Redis is allowed, as an expendable cache and nothing else

**Status:** **Accepted — 2026-09-27.** Mitchell provisioned the store and set the terms. This
records them and the first use.
**Deciders:** Mitchell (product/eng); Claude — drafted
Amends: **ADR-052** (its Context says "There is no Redis, no KV", and decision 2 rejects Vercel
KV / Upstash for the outside-data cache).
Related: **ADR-007** (the port shape copied here), `server/quota.ts` (the rate limiter, which
stays in Postgres), spec `docs/specs/2026-09-27-link-previews-and-real-hero-design.md` §2.2.

## Context

The per-link preview cards (`/api/og/invite/:token`, `/api/og/referral/:code`, and their `meta`
siblings) each run a database lookup. The CDN fronts them with `s-maxage`, so a lookup happens
only on an edge miss. But each route is its own CDN entry, and edge caches are per region, so
the same token is still looked up several times.

Mitchell provisioned **Upstash Redis** through the Vercel Marketplace
(`upstash-kv-citrine-branch`). It is set on Preview **and** Production, on the **free tier**,
and it is **one database shared by every environment**. The integration sets `KV_REST_API_URL`,
`KV_REST_API_TOKEN`, `KV_REST_API_READ_ONLY_TOKEN`, `KV_URL` and `REDIS_URL`.

ADR-052 decided there was no Redis for a reason that still holds: a new vendor must earn its
place, and nothing that must be right may depend on it. That reasoning is kept here and given
a boundary, rather than reversed.

## Decision

1. **Redis is a best-effort, expendable cache. It is never a source of truth.** Anything read
   from it can be recomputed from Postgres. Deleting the whole database at any moment must cost
   speed and nothing else. It does not hold rate-limit counters, idempotency keys, sessions,
   locks or queues, or anything else whose loss changes an answer. **The rate limiter stays in
   Postgres** (`rate_limit_counters`), partly on principle and partly on budget: a limiter
   spends a command on every request, including the junk ones.
2. **One port, one module.** `apps/web/src/server/cache/redis.ts` exposes
   `CachePort { get, set(key, value, ttlSeconds), del }`, reached through `getCache()` (the
   ADR-007 shape). Callers never see the client. It uses the REST pair only
   (`KV_REST_API_URL`, `KV_REST_API_TOKEN`), both optional in `server/config.ts`. With either
   unset (local, CI, tests), the port is a no-op, so nothing needs Redis to run.
3. **It fails open, fast.** Every call is bounded at 300 ms. An error or a timeout is a miss for
   `get` and is ignored for `set` and `del`. The port never rejects and never returns a 500, and
   it logs at most once per instance. The Upstash client runs with `retry: false`, because a
   retry is a second command spent on a request that has already given up.
4. **Shared free tier: keys are prefixed by environment.** They take the form
   `${VERCEL_ENV ?? "dev"}:<use>:…`, and every key is built in one file,
   `server/cache/keys.ts`, which is therefore the whole key space. A preview cannot read,
   overwrite or delete a production entry.
5. **No negative caching.** A miss that found nothing (an unknown token, a revoked invite, an
   unknown referral code) writes nothing. Otherwise anyone could fill the free tier by asking
   for junk, and the rate limiter already bounds how often junk is asked for.
6. **Every new use needs its own budget line in this ADR** (below): what it stores, the TTL,
   and the commands per event. A use without one is not allowed on the shared instance.

## First use: link-preview card data

The cache holds the **data**, not the PNG, so an invite's image route and meta route share one
entry.

| Key | Holds | TTL | Written when | Deleted when |
|---|---|---|---|---|
| `<env>:og:invite:<token>` | `InviteCard` (first names and counts only) | 3600 s | the lookup returns a **personal** card | the invite is revoked or accepted (`access/invites.ts`, after the commit, best-effort) |
| `<env>:og:referral:<code>` | `{ firstName }` | 86400 s | the code names a referrer | never; it expires |

**Budget.** The CDN fronts every route, so Redis is touched only on an **edge miss**:

- **≤ 1 GET + ≤ 1 SET per miss**: a GET always, and a SET only when the GET missed and the
  answer was personal.
- **1 DEL per revoke or accept.**
- **Junk tokens cost 1 GET and no SET.** Their rate is bounded by the Postgres limiter at
  60 per minute per IP.

At the invite volumes this app has, that is a few hundred commands a day at most. That is
well inside Upstash's free-tier command allowance, though this ADR does not pin the figure:
Upstash has changed it before, so check it on the Upstash console. If a later use threatens
the allowance, the budget lines here are where to find out which use it is.

**Staleness.** A cached invite card can show a trip name or a crew list up to an hour old. The
revoke and accept deletes make sure a spent invite stops naming its sender at our origin at
once. The CDN's own hour is a separate trade-off, recorded in `server/og/card.tsx`.

## Consequences

- ADR-052's "no Redis" is now "no Redis as a source of truth". ADR-052 carries a pointer here.
- The Access module (`access/invites.ts`) now issues a best-effort cache DEL. It knows the key
  (through `cache/keys.ts`), and it does not know what a card contains.
- *Rejected: caching the rendered PNG.* It would double the entries (image plus meta) and store
  about 50 KB per entry against a free-tier size cap, for a render that takes milliseconds.
- *Rejected: moving the rate limiter to Redis.* That would spend a command on every request,
  and would make a correctness mechanism depend on an expendable store.
