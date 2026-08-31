# ADR-025: A `users` table under JWT sessions, and `actor_id` as a reference to it

**Status:** Proposed — 2026-08-27. **Open to reversal**, and deliberately so:
this is the base of M11's stacked chain (link 1 of 6), so it is the cheapest
thing in the milestone to change while links 2-6 are still unwritten and the
most expensive once they are stacked on it. Reverse it here, not later.
**Deciders:** Mitchell (product/eng), Claude (implementer)
Related: ADR-003 (history substrate scoped to planning), ADR-024 (auth config
split), ADR-002 (server/UI boundary)
Milestone: `docs/milestones/M11-sharing-and-invites.md` — link 1, "Users &
identity"

## Context

M11's first user story is "invite someone to my trip." That needs durable
identity for a person **before** they accept — an invite addressed to nobody is
not an invite. There is none today.

What exists instead:

- `apps/web/src/server/db/schema.ts` has four tables — `events`,
  `trip_summaries`, `trip_details`, `pages`. There is no `users` table, and no
  table with a person in it at all.
- Auth.js runs **JWT-only**: `apps/web/src/lib/authConfig.ts` configures no
  adapter, and the `session` callback reads the user id straight off the token.
  M15 shipped Google sign-in and a `dev-login` credentials provider on that
  basis, and `src/middleware.ts` (ADR-024) reads the JWT in the Edge runtime
  with no database available to it.
- `actor_id` is a bare `text` column on `events` and on `pages`, carrying the
  Auth.js user id verbatim (Google's `sub`, or `dev-<username>`). The same
  string is `TripMember.userId` in `packages/contracts`.

So the *identifier* is already stable and already everywhere. What is missing
is a row it points at: today a person exists only for as long as their token
does, and there is nowhere to record an email you have invited but who has
never signed in, nowhere to render "who is this actor" for a member list, and
nothing for links 2-6 (roles, invites, share grants, clone lineage) to key on.

The obvious alternative — moving Auth.js onto a database adapter and database
sessions — is the standard answer to "I need a users table" and is the one
this ADR declines.

## Decision

**Keep JWT sessions. Add a `users` table that Auth.js does not know about,
populated by an upsert in the sign-in callback. Treat `actor_id` as a reference
to `users.id`, upheld at the sign-in seam rather than by a database foreign
key.**

1. **`users`** — `id text primary key`, plus nullable `email`, `name`, `image`,
   and non-null `created_at`/`updated_at`. `id` is the Auth.js user id
   *verbatim*, which is why no column type changes anywhere: the value already
   in `events.actor_id`, `pages.actor_id` and `TripMember.userId` is already the
   primary key of the new table. Migration `drizzle/0006_shocking_ironclad.sql`
   is a bare `CREATE TABLE` — no backfill, no altered column, nothing to undo.
2. **`apps/web/src/server/users.ts`** is the module's entire write surface:
   `normalizeIdentity` (pure), `upsertUser` (insert … on conflict do update),
   and `recordSignIn`, the Auth.js `signIn` callback. Identity is ordinary CRUD
   with audit fields, exactly as the module map says and ADR-003 scopes — it is
   **not** event-sourced, and no planning event carries it.
3. **The callback is composed in `apps/web/src/server/auth.ts`, not in
   `lib/authConfig.ts`.** ADR-024 made `authConfig` edge-safe so middleware can
   build its own instance from it; a database write in that object would undo
   that. Composing `signIn` at the Node-side instance keeps Postgres out of the
   Edge instance entirely. It is also the only hook that runs *once per
   sign-in*: `jwt` runs on every session read, in both runtimes.
4. **Fail-closed, both ways.** A payload with no usable id returns `false`
   (Auth.js redirects to the designed `/signin?error=` screen). A database
   failure propagates rather than being swallowed — the point of the table is
   that no session exists for a person with no row, and a session minted during
   an outage would be exactly the identity-without-a-row case links 2-6 are
   built to assume away. The app cannot serve a trip without Postgres anyway.
5. **Email is lowercased and trimmed; blank fields become `null`.** Email is the
   one field a human will later *type* in order to invite someone (link 3), and
   "Ana@Example.com" inviting "ana@example.com" must not produce two people.
   Absent and blank must not be two different states.

### Why no foreign key on `actor_id`

The milestone file proposed making `actor_id` "its foreign key". That is not
what shipped, and the difference is worth stating plainly rather than leaving
as a silent narrowing:

- **The log carries actors that are not people.** `pages.actor_id` is `'system'`
  for the lazily seeded default pages (`server/pages.ts`), and the partial
  unique index `pages_system_seed_unique` is defined in terms of that value. A
  foreign key would require inventing a fake user row for a non-person, which
  is worse than not having the constraint.
- **A FK would put an Identity write on the planning-command path.** Every
  integration test and every fixture appends events as ad-hoc actors
  (`"user-1"` alone appears 43 times). Making those inserts legal means either
  seeding identity in the planning pipeline — Identity leaking into Trip
  Planning, the ADR-003 boundary smell `AGENTS.md` says to escalate rather than
  bend — or rewriting fixtures across the suite for a constraint that buys
  nothing at runtime.
- **Eight milestones of rows predate the table.** Validating a FK means
  backfilling one user row per distinct historical `actor_id`, which manufactures
  people who never signed in.

So the reference is a *stated and tested* invariant instead: sign-in is the only
place a session id is ever minted, and it writes the row before the session
exists. `apps/web/src/server/users.int.test.ts` drives that order end to end —
sign in, execute a real `CreateTrip`, then assert the event's `actor_id` and the
trip's `TripMember.userId` both resolve to a `users` row — and asserts the
converse for `'system'`, so a future FK cannot be added without that test going
red and this reasoning being re-read.

## Alternatives rejected

- **Move Auth.js to a database adapter with database sessions.** The textbook
  answer, and genuinely better if we were starting today: identity would be
  maintained by the library rather than by our callback, and account linking
  would come for free. Rejected for M11 because it touches every auth path M15
  just shipped — the session shape, the `jwt`/`session` callbacks, the
  `dev-login` credentials provider (which Auth.js does **not** support with
  database sessions at all), the seed script's hand-rolled CSRF dance, and
  `src/middleware.ts`, which reads the JWT in the Edge runtime where a database
  round trip is exactly what ADR-024 was written to avoid. That is a milestone
  of its own, not the first link of six, and none of M11's five user stories
  need it.
- **Adopt the full Auth.js adapter schema (`accounts`, `sessions`,
  `verification_tokens`) without using database sessions.** Rejected: three
  tables nothing reads, whose shape is owned by the library, is drift waiting
  to happen. If we later want the adapter, we want it wholesale.
- **Derive identity lazily on first read instead of on sign-in.** Rejected: the
  invite case is precisely the one where the row must exist for someone who has
  *not* read anything yet.
- **No table; keep the JWT as the only identity.** This is the status quo, and
  it is what link 3 cannot be built on: an invite must outlive a token.

## Consequences

- **Reversal is cheap today and gets more expensive with each link.** The
  migration is a bare `CREATE TABLE`; dropping it would take one migration and
  the deletion of `server/users.ts` and one callback line. Links 2-6 will key
  roles, invites and share grants on `users.id` — once they do, this stops being
  reversible in isolation. That is why the status is *Proposed*.
- **Auth.js does not read this table.** Sessions still come from the JWT, so a
  user who signs in and is then deleted from `users` keeps a working session
  until it expires. Nothing in link 1 depends on that not happening; link 2's
  `AccessPolicy` is where it would start to matter, and it should be decided
  there rather than pre-empted here.
- **No contract changed.** `TripMember` stays `{ userId, role: "owner" }` —
  widening it to carry a display name or role is links 2 and 3's work, and
  doing it here would have been a contracts change with no consumer. Nothing was
  added to `packages/contracts`, so there is no changelog entry for this link.
- **Identity is now populated by every existing sign-in path for free.**
  `scripts/db-seed.ts` and `e2e/helpers.ts`'s `signInAsDevUser` both authenticate
  through the real provider flow, so both write user rows without being changed.
- **The dev and preview databases gain rows for every historical `dev-*` user
  only as those users next sign in.** There is no backfill; an `actor_id` in a
  pre-M11 event may have no `users` row, and any surface that resolves an actor
  to a person must tolerate a miss. Link 3 is the first code that will care.

## Amendment (2026-08-30) — `recordSignIn` returns `boolean | string`

Decision 4 above specifies `recordSignIn` as a fail-closed **boolean**. M11a
widens it to `Promise<boolean | string>`. Recorded here rather than changed
above, because the original reasoning is still the reasoning — only its return
type moved.

**What changed.** M11a puts an invite gate in the same callback
(`docs/milestones/M11a-invite-gate.md`, link 1). It has three distinct
refusals — nothing presented, presented but not recognised, and a single-use
code already redeemed — and each one is a different sentence on the `/signin`
screen, because "the refusal is a designed screen, not a stack trace".

**Why a string is the only way to say which.** `@auth/core@0.41.3`'s
`handleAuthorized` (`lib/actions/callback/index.js:393-409`) collapses **every**
falsy return into one `AccessDenied` code; `false`, `null` and `undefined` are
indistinguishable to anything downstream. The same function passes a **string**
return through the `redirect` callback instead, and the default redirect honours
any value starting with `/` (`init.js:13-19`). So the refusal reason travels as
a returned path — `` `/signin?error=${AdmissionRefusal.enum.…}` `` — and there
is no second hook that could carry it. The three codes are a closed Zod enum in
`packages/contracts` (`AdmissionRefusal`), not free strings, so an arbitrary
`?error=` value cannot pose as a refusal this app produced.

**Fail-closed is preserved, and is what the widening is for.**

- A payload with no usable id still returns `false`, before the gate is
  consulted at all. Auth.js still turns that into the designed
  `/signin?error=` screen.
- A database failure still propagates rather than being swallowed. The gate
  reads the `users` row and may claim an `invite_codes` row; if either throws,
  no session is minted — the same property Decision 4 states, now covering one
  more query.
- Every non-`true` return ends at `/signin`. Nothing returns `true` on a path
  the gate did not clear, and a refusal writes no `users` row, so a refused
  account leaves nothing behind.

**What did not change.** Sessions are still JWT-only, Auth.js still does not
read the `users` table, and `actor_id` is still upheld at the sign-in seam
rather than by a foreign key. The gate strengthens that last property rather
than weakening it: there is now one more reason a session cannot exist without
a row behind it.

**One consequence worth naming.** Decision 4's "the app cannot serve a trip
without Postgres anyway" now also covers admission, so a database outage
refuses *new* sign-ups as well as new sessions. That is the intended direction
— a gate that fails open is not a gate.
