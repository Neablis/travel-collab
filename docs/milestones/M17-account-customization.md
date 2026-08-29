# M17 — Account customization (and a real user record)

**Status:** Approved 2026-08-26, not started, **and not placed in the execution
order** — see `docs/milestones/README.md`'s Current-milestone section for the two
facts that placement decision needs. Phase 2.

**Re-scope before scheduling (noted 2026-08-28).** The deliverable below —
*"a `users` table, and the decision of what it keys on"* — **has already been
decided and shipped by M11 link 1** (PR #71, **ADR-025**): `users` is a real
table (`apps/web/src/server/db/schema.ts`) keyed on the Auth.js user id
verbatim (Google's `sub`, or `dev-<username>`), which is the same string already
stored in `events.actor_id`, `pages.actor_id` and `TripMember.userId`, with JWT
sessions kept rather than moving Auth.js onto a database adapter. What remains
here is the *preferences* half — name, home airport, account-scope distance
units, home-time-on-hover, and resolving `who` to a display name. That is a
smaller milestone than the one approved; the identity question this file frames
as the point is answered.

**Opened by:** Mitchell, reviewing SPEC §12 — *"Skip on C5/C6/C7 and make a
future milestone, account customization. We will need a new DB table, but i also
think we are getting close to just wanting a user table rather than relying on
the google auth jwt."*

## Why this exists

SPEC §12 (design sync `fd2edd6`, 2026-08-26) asks for three things that all land
on the same absence:

| DRIFT | Asks for | Needs |
|---|---|---|
| C5 | An **Account settings** Sheet off the avatar menu — Your name, read-only email, Home airport, a Display section. `Your account` currently flashes "not built yet" | Somewhere to store a name and an airport |
| C6 | **Distance units** (`Kilometres`/`Miles`) at **account** scope — "a trip does not have a unit, a person does". One `kmLabel` owns every distance | A per-person preference |
| C7 | **Home time on hover** (default off) — `SFO 10:30 pm −1d` in Timeline's time gutter | A home airport, its tz, **and** `trip.tz` |

The build has nowhere to put any of it. `apps/web/src/server/db/schema.ts` is
four tables — `events`, `trip_summaries`, `trip_details`, `pages`. There is no
user row. Identity today is whatever the auth provider hands back per request.

Mitchell's framing is the important part and is why this is a milestone rather
than a table: **the question is not "where do we put a distance unit", it is
whether the product should have its own user record at all** instead of leaning
on the provider's token for identity. Everything in C5–C7 is a symptom.

## The shape of the problem

This app is event-sourced: trip state is a fold over `events`, and the read
models are projections. Account preferences are **not** trip state — they are
not versioned, not undoable, and not part of any trip's history. Putting them in
the event log would make "switch to miles" an entry in a trip's undo stack,
which is obviously wrong. So this is a genuinely new persistence concept for the
codebase, not another projection.

Related, and worth deciding at the same time: `TripMember.userId` is a bare
string (`dev-alice` in the seed), which is why activity cards render a raw
`dev-alice` for "who" (audit B8). A real user table gives that a display name to
resolve against.

## Scope

- A `users` table, and the decision of what it keys on (provider subject? an
  internal id with the provider subject as a credential?) — **the decision is
  the deliverable here, not just the DDL.**
- Account settings Sheet: name, read-only email, home airport, Display section.
- `kmLabel` — one helper owning every distance. Call sites today hardcode `km`:
  `mapRailData.ts:68`, `MapFocusCard.tsx:24`, `MapRail.tsx:358`, and
  Timeline's day summary. Miles below 0.19 → feet; km below 1 → metres.
- Home time on hover, which additionally needs `trip.tz` and a tz resolved from
  the home airport. SPEC §12 argues — correctly — that this must stay a
  *reference on demand*, never a global display mode: every time in a plan is
  local ("dinner at 7pm" means 7pm in Kyoto), so a global toggle would rewrite
  the itinerary and render the 8:20am Romancecar as 4:20pm the previous day.
- Resolve `who` to a display name (audit B8) if the user record makes it cheap.

## Exit gate

- [ ] A signed-in person can set their name and home airport, and both survive a
      sign-out/sign-in and a server restart.
- [ ] Switching Kilometres/Miles changes **every** distance in the app — map
      rail totals, focus card, longest-hop, leg labels, Timeline day summary —
      through one helper, with no per-trip unit field anywhere.
- [ ] Home time on hover is off by default, and when on shows the reference line
      without altering any stored or displayed plan time.
- [ ] The decision on user identity (own record vs provider token) is recorded
      as an ADR, with the migration path for existing `TripMember.userId`
      strings.

## Deliberately not here

- Anything trip-scoped. If a preference could differ between two trips of the
  same person, it does not belong in this milestone.
