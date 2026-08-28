# ADR-031 — The demo trip is the fixture, folded in memory, not a row in a table

**Status:** Accepted (2026-08-28). Supersedes ADR-027's *"The landing page's
'Look around a real trip'"* section and retires `DEMO_SHARE_TOKEN`.

**Depends on:** ADR-027 (a share is pinned to a seq, and the read replays),
ADR-030 (the Japan demo trip is one canonical fixture, in its own package).

**Closes:** KI-61.

## Context

ADR-027 made `/s/featured` a **reserved token** the API resolved through
`DEMO_SHARE_TOKEN` — one env var naming one already-published share row. It
wrote down its own weak point in the same breath: unset, the landing page's
most prominent secondary CTA lands on an empty state, "and it depends on a
deploy step no test can enforce."

Unset was not the edge case. It was every environment. `DEMO_SHARE_TOKEN` was
never in `.env.example`; neither seeder ever created a share, so there was no
token to set even for someone who wanted to; and `createShare` mints a random
one, so any token obtained by hand died at the next `db:reseed`. CI's own e2e
spec asserted the empty state, which made the suite green *because* nothing was
configured (KI-61).

Two separate objections, and the fix has to answer both:

1. **A preview branch cannot validate itself.** Every preview deploy would need
   a human to publish a trip and paste a token before the front door worked.
2. **The homepage's second CTA is a database dependency.** `/s/featured` is
   reachable by anyone, unauthenticated, as often as they like, and each view
   cost a share lookup, a projection read, a members read, and a **full replay
   of a 74-event stream**. That is a load profile set by strangers, on the one
   path with no session to rate-limit against.

The recorded fix path — commit a fixed token and have the seeders publish under
it — answers neither. It still needs a seeded database on every environment,
and it needs a token-override path punched through `createShare`, which is the
single place share secrecy is decided.

## Decision

**The demo trip is not a trip. It is the fixture, folded through the domain in
memory, on the way out of the API.**

`apps/web/src/server/demoTrip.ts` runs `@tc/fixtures`' `japanTripCommands`
through `decideTripCommand` → `evolveTrip` → `tripDetailFromState` — the same
functions the command pipeline runs, in the same order — and hands the result
to the same `toSharedView` a real share read uses. `GET /api/shares/featured`
serves that. `/s/featured` is still the same page component, fetching the same
`SharedTripView` from the same client function.

So the mechanisms are all the real ones. What is gone is the storage.

- **No env var.** Nothing to configure, on any environment, ever.
- **No database.** Not "a cheaper query" — none. `pg.Pool` is not in the
  route's import graph, and a unit test mocks `pg` to throw on construction so
  it stays that way. (`toSharedView` moved into its own pure module for exactly
  this: `access/shares.ts` imports the client.)
- **No trust surface.** There is no world-readable token, so nothing had to be
  added to `createShare`, and a real user's share is exactly as secret as it was.
- **CI proves the CTA works** instead of proving it dead-ends.

### The pieces that had to be decided

**Ids are deterministic and synthetic.** `deterministicMintId` (moved from the
verifier into `@tc/fixtures`' public surface) derives counter ids from an
all-zeros prefix, so the demo renders the same day and activity ids on every
instance and every request, and holds ids `randomUUID` cannot produce. The trip
itself is `DEMO_TRIP_ID` = `…-00000000d000`.

**It is dated relative to today** (ADR-030's rule), memoised per instance on
that date, so it re-folds on the first request of a new day and is always
upcoming. The route is `force-static` with `revalidate = 3600` on top — the
response depends on nothing but the calendar.

**`stale` is false and `sharedAt` is the fold's own timestamp.** A fixture has
no live trip behind it that can move on. `SharedTripScreen` says the other true
thing for the demo — "an example trip, to look around" — instead of "shared on
<date>, this is the plan as it was then", which would be a sentence about
nobody.

**`travellerCount` comes from the fixture** (`JAPAN_TRIP_TRAVELLERS = 4`), not
from the folded state. Members are Access & Membership's data (module map); a
folded trip has exactly one, the actor that "issued" the commands. "1 traveller"
on the one page arguing for planning *together* undersells the product, and the
number is part of the fixture's fiction exactly like its 72 stops.

**"Make this my trip" still works,** through its own static route
(`/api/shares/featured/clone`) into the same `cloneFrom` every other copy uses.
This is the conversion the demo exists for and the only write anywhere near it:
a signed-in person deliberately asking for a trip of their own. Signed out, the
401 becomes `/signin?callbackUrl=/s/featured` and they land back on the page
they were reading.

The cost of that is a **lineage pointer to a trip that does not exist**. The
copy records `forkedFrom: { tripId: DEMO_TRIP_ID, … }`, and `SettingsSheet`
renders it as text ("Copied from …, as it was at change N"). Nothing follows it
as a link today; a future feature that does has to special-case that id. The
alternative, `forkedFrom: null`, tells someone who just cloned the demo that
their trip came from nowhere, which is worse and also false.

## What this is not

**Not a bespoke public-read path** — the thing M15's gate forbade and ADR-027
built the general mechanism to avoid. The route, the contract, the page and the
clone all stayed; only the *source of the bytes* changed.

**Not a fallback to "the newest share on the instance."** ADR-027 rejected that
because it would publish a real user's private trip on the front page the moment
they clicked Share. Still rejected, and now unreachable: the demo is not a row,
so there is no row to pick wrongly.

**Not discovery.** M12 Community still owns a real gallery, votes and the trust
& safety surface. When it lands it can take `featured` back over — as a
database-backed, curated thing — and this module becomes the thing that ships
before there is anything to curate.

## Consequences

- `readFeaturedShare` and `DEMO_SHARE_TOKEN` are deleted. Nothing reads that env
  var anywhere in the repo.
- The **only** database work in the whole demo is the clone, which is a signed-in
  write to the visitor's own new stream.
- The fixture is now load-bearing in **four** places, not three (ADR-030's
  count): `db:seed`, `api/dev/reset-demo-data`, `@tc/factories`, and the public
  demo. `pnpm seed:verify` covers all four, and a command the domain would
  reject now fails a public page rather than a seed script — which is why
  `demoTrip.ts` throws on a rejection instead of rendering a half-built trip.
- A preview branch validates its own front door with no manual step. That was
  objection 1, and it is the reason this is worth an ADR rather than a patch.
