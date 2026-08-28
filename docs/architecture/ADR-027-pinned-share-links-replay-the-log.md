# ADR-027 — A share link is pinned to a seq, and the read replays

**Status:** Proposed (M11 link 4, 2026-08-27). Open to reversal.

**Depends on:** ADR-003 (event sourcing is scoped to planning), ADR-005
(history commands are appended, never destructive), ADR-026 (Access is CRUD,
and a link is a bearer credential).

## Context

M11's second user story: *"Share a read-only version of my trip from the
current history point — if I click Share and then keep planning, the link still
shows the trip as it was when I shared it."*

That sentence rules out the obvious implementation. `trip_details` is a
materialized projection of the trip **as it is now**; serving it from a share
link would make every link track the live trip, and the feature would not
exist.

## Decision

A share stores the trip's event `seq` at the moment it was created, and the
public read **replays** the log to that seq (`getTripDetailAtWithHead`, the
same replay M2 built for the history preview).

- The pin is read **inside the same transaction that inserts the row**. A
  command landing between a separate read and the write would produce a link
  pinned to a point the sharer never saw.
- The pin is **immutable**. Re-pinning mints a new token, so a link already
  handed out can never change under the person holding it. The UI says which
  change each link is pinned to for exactly this reason.
- The alternative — snapshot the projection into the share row — was rejected
  because a snapshot is a copy, and a copy drifts from "share this point in
  history": it would keep working after the events behind it were reverted,
  and it would need its own migration every time `TripDetail` changed shape.

The cost is one stream read per public view. That is the same read the history
preview has always done, and `getTripDetailAtWithHead` exists so the pinned
read answers "what did it look like" and "has it moved on since" from that one
read rather than two.

## What a stranger is served

`SharedTripView`, not `TripDetail`, written as an **explicit field list** in
`packages/contracts/src/share.ts`. A public read is the one place a field
leaks to people the trip's owner never chose, so a new `TripDetail` field has
to be opted in rather than arriving by spread. Three things are dropped:

- `members` — actor ids identify real people. `travellerCount` says the one
  thing the view needs ("3 travellers") without naming anyone.
- `conflicts` / `dismissedConflictIds` — planning advice for whoever is
  editing. A shared plan is finished as far as its reader is concerned.
- `status` — a deleted trip's link is refused outright (the person who deleted
  it said it should not exist; a link handed out earlier is not an exception),
  so there is no other status a served view could be in.

The view also carries `stale`: true when the trip has moved on since the link
was created. The page says so, because a reader who is also a traveller should
know the plan in front of them is not the current one.

## Who may create one — `editor`, not `owner`

Deliberately a different line from invites, which are owner-only (ADR-026). An
invite grants *participation*, and who is on a trip is the owner's call. A
pinned share grants a read of one frozen point and nothing else, which is
within what a planning participant already does. A **viewer** cannot create one:
they would be handing out access they were themselves given.

This is the decision here most worth arguing with. If sharing turns out to be
something owners want to hold, the change is one string in
`app/api/trips/[tripId]/shares/route.ts`.

## The landing page's "Look around a real trip"

M15 shipped that CTA as a `<Preview>` shell and its gate forbade building a
bespoke public-read path for it. This link builds the general one, so the shell
retires — but SPEC §14 also says the landing page *"runs on nothing: no
session, no fetch, no backend"*, so the CTA must not go looking for a trip to
peek at.

Resolution: the CTA is an ordinary `<Link href="/s/featured">`. `featured` is a
**reserved token** the API maps to the deployment's configured share
(`DEMO_SHARE_TOKEN`); Next.js routes the static segment ahead of the dynamic
one, and real tokens are 43-character base64url so they can never collide with
it. The landing page still fetches nothing; `/s/featured` is an ordinary share
page reading an ordinary share.

Which trip that is, is **deployment configuration, not a product feature**.
M12 Community owns discovery, voting and the trust & safety surface that would
decide it, and is explicitly out of M11's scope. There is deliberately no
fallback to "the newest share on the instance" — that would publish some real
user's private trip on the front page the moment they clicked Share. Unset
means unset, and `/s/featured` says so in a designed empty state with a way
onward.

**The known weak point:** with `DEMO_SHARE_TOKEN` unset — CI, a fresh local
database, and any deploy where nobody set it — the landing page's most
prominent secondary CTA lands on that empty state. It is honest and it is not
a crash, but it is a worse front door than a shell was, and it depends on a
deploy step no test can enforce. Worth revisiting if M12 slips further.

## Consequences

- `/s/:token` sits under the `(front)` route group and is deliberately **absent
  from `middleware.ts`'s matcher**. Matching it would bounce every recipient of
  a share link to `/signin`, which is precisely what the link exists to avoid.
- `SharedTripScreen` is read-only *by construction*, not by disabling controls:
  there is no `TripProvider` and no command client anywhere in its subtree, so
  a mutating control cannot be added there by accident.
- `GET /api/shares/:token` is the only endpoint in the app that does not call
  `auth()`. That is the feature. It is covered by an integration test that
  asserts it works with no session at all, so a future "just add auth() to
  every route" sweep fails loudly instead of silently killing sharing.
