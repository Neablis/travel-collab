# ADR-031 — The demo trip is the fixture, folded in memory, served through the real routes

**Status:** Accepted (2026-08-28). Supersedes ADR-027's *"The landing page's
'Look around a real trip'"* section and retires `DEMO_SHARE_TOKEN`.

**Depends on:** ADR-026 (a role decides what a member may do), ADR-027 (a share
is pinned to a seq, and the read replays), ADR-030 (the Japan demo trip is one
canonical fixture, in its own package).

**Closes:** KI-61.

## Context

ADR-027 made `/s/featured` a **reserved token** the API resolved through
`DEMO_SHARE_TOKEN` — one env var naming one already-published share row. It
wrote down its own weak point in the same breath: unset, the landing page's most
prominent secondary CTA lands on an empty state, "and it depends on a deploy
step no test can enforce."

Unset was not the edge case. It was every environment. `DEMO_SHARE_TOKEN` was
never in `.env.example`; neither seeder ever created a share, so there was no
token to set even for someone who wanted to; and `createShare` mints a random
one, so any token obtained by hand died at the next `db:reseed`. CI's own e2e
spec asserted the empty state, which made the suite green *because* nothing was
configured (KI-61).

Three objections, and the answer has to satisfy all three:

1. **A preview branch cannot validate itself.** Every preview deploy would need
   a human to publish a trip and paste a token before the front door worked.
2. **The homepage's second CTA is a database dependency.** `/s/featured` is
   reachable by anyone, unauthenticated, as often as they like, and each view
   cost a share lookup, a projection read, a members read, and a **full replay
   of a 74-event stream**. That is a load profile set by strangers, on the one
   path with no session to rate-limit against.
3. **It showed the wrong thing.** `SharedTripScreen` renders a pinned share as a
   flat list of days. That is right for "here is my plan as it was on Tuesday",
   and it is the wrong artefact for "here is what this product does" — no
   Timeline, no Day columns, no Map, no Calendar, no conflicts, no history.
   Someone deciding whether to sign up was being shown the least of it.

The fix path KI-61 recorded — commit a fixed token and have the seeders publish
under it — answers none of them. It still needs a seeded database on every
environment, it still replays a stream per view, it still renders the flat list,
and it needs a token-override path punched through `createShare`, which is the
single place share secrecy is decided.

## Decision

**The demo trip is not a trip. It is the fixture, folded through the domain in
memory, answered for at the access seam, and rendered by the real board.**

Three pieces, and the third is the point:

### 1. The fold

`apps/web/src/server/demoTrip.ts` runs `@tc/fixtures`' `japanTripCommandGroups`
through `decideTripCommand` → `evolveTrip` → `tripDetailFromState` — the same
functions the command pipeline runs, in the same order. It wraps the events in
real `EventEnvelope`s as it goes, one `batchId` per command group, so
`buildHistoryEntries` and `foldEnvelopes` produce a real history and a real
point-in-time replay from them. Nothing is stored.

### 2. One seam, not four branches

`requireTripAccess` is the single gate `GET /api/trips/:id`, `/history`,
`/history/:seq` and `/access` all pass through. The demo is answered *there*,
before `auth()`, as a **viewer**. So:

- All four reads serve the demo publicly, and **not one of those route files
  gained a branch or lost a check**.
- Read-only is not a new mechanism. `MINIMUM_ROLE` in `accessPolicy.ts` has no
  `viewer` entry — a viewer executes no planning command at all — so every write
  route asks this seam for `editor` or `owner` and is refused. The demo is
  read-only *by the product's own permission rule*, and a write endpoint added
  next year inherits the refusal without anyone remembering the demo exists.

The two reads that still would have touched Postgres after the seam are branched
explicitly: `getTripHistory` (which would read the stream) and the access
route's `withProfiles` (which would look up user rows for invented people).

### 3. The real board

`/demo` mounts the **same provider stack** `(app)/trips/[tripId]/page.tsx`
mounts — `TripProvider` → `FocusProvider` → `EditorHost` → `LensRouter` →
`TripBoardScreen` — around the same board. A visitor gets Day columns, Timeline,
Calendar, the Map with its rail and focus card, the day chips, the budget chip,
the traveller row, the conflict banners and the History popover. Nothing on that
page is a demo-shaped reimplementation of a lens, and nothing on it can drift
from the product, because there is only one of each.

`SharedTripScreen` stays exactly as it was, for actual shares. The two are
different artefacts: a share is one person's plan pinned to a moment, and the
demo is the product with the writes turned off.

## What had to be decided

**Read-only is enforced by hiding, not disabling.** `TripProvider` already
refused a viewer's writes before they reached the optimistic queue; what it did
not do was stop the board *offering* them, so a viewer saw a pencil and a ✕ on
every card, "Dismiss" on every conflict, "+ Add" on every column, and could drag
a card and watch it snap back. `readOnly` now threads from the provider's own
gate into `Board`, `Column`, `ActivityCard`, `TimelineLens`, `OverlapWarning`,
`ConflictBanner` and `UnscheduledRack` — the flag that refuses the command is
the flag that hides the control, so the two cannot disagree. **This fixes the
invited-viewer experience too**; it was always this way, and the demo is what
made it unignorable. Drag registration goes with the buttons: a read-only card
is not draggable and not a drop target, because "picks up and snaps back" is
precisely what `TripProvider`'s own comment says its gate exists to prevent.

What stays on a read-only board is everything that reads: every stop, time,
cost, note, route, and the conflict warnings themselves — the product noticing
something is exactly what a reader should see it do. Only the *dismissing* goes.

**The assistant rail is dropped on the demo, and only there.** It is the one
control with no read-only half: `composeAiPlan` needs a session and is a write.
Offering a signed-out visitor a launcher whose only outcome is an error is worse
than not offering it.

**Ids are deterministic and synthetic.** `deterministicMintId` (moved from the
verifier onto `@tc/fixtures`' public surface) derives counter ids from an
all-zeros prefix, so the demo renders the same day, activity and batch ids on
every instance and every request, and holds ids `randomUUID` cannot produce. The
trip itself is `DEMO_TRIP_ID` = `…-00000000d000`, a real UUID naming no row.

**It is dated relative to today** (ADR-030's rule), memoised per instance on that
date, so it re-folds on the first request of a new day and is always upcoming.

**The travellers are fiction, and they are fiction in the detail.**
`TripMember` carries only a `userId`, and `TimelineLens` renders that string
directly as the attribution label, so the ids **are** the names ("Mika",
"Jonah", "Priya", "Sam") — honest, because no account is behind any of them.
Four rather than the fold's one, because a trip planned by one person, on the
one page arguing for planning *together*, undersells the product it is
demonstrating; `JAPAN_TRIP_TRAVELLERS` declares the count beside the rest of the
fixture's fiction. The overlay lands on the **detail**, not only on the access
read, because the board renders `detail.members` in three places — with the
fold's single synthetic member it read "1 travellers" next to a raw uuid on all
68 timeline cards.

**"Make this trip mine" is the ordinary duplicate endpoint.**
`POST /api/trips/:id/duplicate`, into the same `cloneFrom` every other copy
goes through. `duplicateTrip` branches for the demo before its membership check
rather than satisfying it: the demo grants every visitor `viewer` at the seam,
but its member list names invented people, so `hasAtLeast` would refuse a real
account. Signed out, the 401 becomes `/signin?callbackUrl=/demo` and they land
back on the page they were reading.

The sign-in detour **carries the intent**, not just the destination:
`?callbackUrl=/demo?clone=1`, and the demo finishes the copy on arrival. Without
it the 401 round trip cost the visitor their click — they pressed the button,
signed in, landed back on the demo, and had to press it again, with nothing on
the page saying so. The marker is dropped from the URL (via `history.replaceState`,
not a router navigation, which would race the push that follows) before the copy
runs, so a failure leaves an ordinary `/demo`; and a 401 on the automatic run
shows the button and a message rather than bouncing to sign-in again, which is
where a loop would start.

The copy is named for the trip, **not** `<name> (copy)`: every other clone is a
copy of something already in your list and needs telling apart from it; this is
somebody's first trip, and calling it "(copy)" frames the demo as the real one.
Its lineage records `DEMO_TRIP_ID` — display-only text today ("Copied from …, as
it was at change N"), and the trade is worth it: `forkedFrom: null` would tell
the person who just copied the demo that their trip came from nowhere. A future
feature that turns lineage into a **link** has to special-case that id.

## What this is not

**Not a bespoke public-read path** — the thing M15's gate forbade. The routes,
the contracts, the provider, the lenses and the clone all stayed; the demo
travels them.

**Not a fallback to "the newest share on the instance."** ADR-027 rejected that
because it would publish a real user's private trip on the front page the moment
they clicked Share. Still rejected, and now unreachable: the demo is not a row,
so there is no row to pick wrongly.

**Not discovery.** M12 Community still owns a real gallery, votes and the trust
& safety surface. `/demo` is what ships before there is anything to curate, and
`featured` is free for M12 to mean what it says.

## Consequences

- `readFeaturedShare`, `DEMO_SHARE_TOKEN` and `GET /api/shares/featured` are
  deleted. Nothing reads that env var anywhere in the repo.
- The **only** database work in the whole demo is the clone, which is a
  signed-in write to the visitor's own new stream. A unit test mocks `pg` so that
  it throws on construction, so any future import of `db/client` into the demo's
  graph — direct or transitive — fails a test rather than opening a connection on
  a public path.
- `/demo` is prerendered (`○` in the build output). `LensRouter` reads
  `useSearchParams`, so the board sits behind a Suspense boundary and the shell,
  the banner and "Make this trip mine" are in the first paint.
- The fixture is now load-bearing in **four** places, not three (ADR-030's
  count): `db:seed`, `api/dev/reset-demo-data`, `@tc/factories`, and the public
  demo. A command the domain would reject now fails a public page rather than a
  seed script — which is why `demoTrip.ts` throws on a rejection instead of
  rendering a half-built trip, and why `pnpm seed:verify` (which runs the same
  fold inside `pnpm check`) is now guarding the front door as well.
- A preview branch validates its own front door with no manual step, and CI
  proves the CTA works instead of proving it dead-ends.

## The one thing worth arguing with

A viewer's board is now materially quieter than it was, and that change reaches
every invited viewer, not just the demo. If "show it disabled, so they know what
they would be able to do" turns out to be the better call for real viewers, the
split is one prop: `readOnly` would become two flags, one per audience. The
header already makes that call in the other direction and was deliberately left
alone — "Add stop" is *disabled* there, not hidden, and it is the one greyed
control on the page.
