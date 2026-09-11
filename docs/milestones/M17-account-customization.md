# M17 — Account preferences

*(Titled "Account customization (and a real user record)" until 2026-09-01. The
real user record shipped in M11 link 1 under ADR-025, so the parenthetical named
a delivered thing; the scope has said as much since the 2026-08-29 re-scope.)*

**Status: DONE — gate closed 2026-09-11.** Three of three live boxes, one
amended out 2026-09-01. Built in PRs #111 and #112 (merged 2026-09-02); the
gate was never closed at the time and the project moved on for nine days
without flipping a flag. See "Retro — 2026-09-11" at the bottom, which records
both the milestone and that miss.

*(Previously: Approved 2026-08-26. **Re-scoped and placed 2026-08-29** — see the
"Status — re-scoped and placed" section below, which supersedes that line and
records both amendments. Phase 2, running after M18b.)*

**Re-scope before scheduling (noted 2026-08-28) — DONE 2026-08-29, see below.**
This paragraph is the analysis that the re-scope acted on; it is kept because it
is the argument, not a live instruction. The deliverable below —
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

## Status — re-scoped and placed, 2026-08-29

**Approved 2026-08-26 out of SPEC §12; re-scoped and placed 2026-08-29**, both
by Mitchell's explicit decision. It had sat approved-but-unplaced because its
headline deliverable — the `users` table and the identity decision — had
already been shipped by M11 link 1 (ADR-025), making the milestone as written
smaller and different from the one that was approved. Two amendments, both
recorded in place below: **scope item 1 removed** and **exit-gate box 4
replaced**. What remains is the preferences half: name, home airport,
account-scope distance units through one `kmLabel`, home-time-on-hover, and
resolving `who` to a display name.

**Placed after M18b**, ahead of M12. Nothing downstream is blocked on it.

**It needs one migration** — `users` today is `id`/`email`/`name`/`image`/
`created_at`/`updated_at` and carries no preference columns.

## Why this exists

SPEC §12 (design sync `fd2edd6`, 2026-08-26) asks for three things that all land
on the same absence:

| DRIFT | Asks for | Needs |
|---|---|---|
| C5 | An **Account settings** Sheet off the avatar menu — Your name, read-only email, Home airport, a Display section | Somewhere to store a name and an airport |
| C6 | **Distance units** (`Kilometres`/`Miles`) at **account** scope — "a trip does not have a unit, a person does". One `kmLabel` owns every distance | A per-person preference |
| C7 | **Home time on hover** (default off) — `SFO 10:30 pm −1d` in Timeline's time gutter | A home airport, its tz, **and** `trip.tz` |

**That paragraph was true when this was written and is not true now**
(corrected 2026-09-01). `apps/web/src/server/db/schema.ts` is **twelve** tables,
and `users` is one of them — `id`/`email`/`name`/`image`/`created_at`/
`updated_at`, shipped by M11 link 1 under ADR-025. Identity is no longer
"whatever the auth provider hands back per request": there is a real user row
keyed on the Auth.js user id.

What is still absent is narrower and is what this milestone adds: **`users`
carries no preference columns**, so there is nowhere to put a home airport or a
distance unit. `users.name` does already exist (populated from the provider),
which makes "resolve `who` to a display name" smaller than the scope below
implies — closer to wiring than to building.

**SPEC §12's "`Your account` previously flashed 'not built yet'" is not what
this app does** (corrected 2026-09-01). It has never flashed anything: task
8b.2 **omitted the item** rather than ship one that did nothing, and
`AccountMenu.tsx` said so in a comment for four milestones. The dropdown held
"Sign out" and, in preview only, "Reset to demo data". So the C5 row above is a
missing item, not a broken one — which is a smaller thing to fix and a
different one to look for.

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

- ~~A `users` table, and the decision of what it keys on.~~ **Removed from
  scope 2026-08-29 by Mitchell's explicit decision — it already shipped.**
  M11 link 1 (PR #71, **ADR-025**) created `users` as a real table keyed on the
  Auth.js user id verbatim — Google's `sub`, or `dev-<username>` — which is the
  exact string already stored in `events.actor_id`, `pages.actor_id` and
  `TripMember.userId`, so it changed no column type anywhere. JWT sessions were
  kept rather than moving Auth.js onto a database adapter. See
  `apps/web/src/server/db/schema.ts:25`. **What this milestone adds is
  preference columns on that existing table**, not the table or the decision.
  This is why the milestone needed a re-scope before it could be placed: its
  stated headline deliverable had been built by another milestone.
- Account settings Sheet: name, read-only email, home airport, Display section.
- `kmLabel` — one helper owning every distance. Miles below 0.19 → feet; km
  below 1 → metres. **The call-site list above was wrong in both directions and
  is corrected here (2026-09-01, verified by grep).** There are exactly three,
  all in the map lens: `MapFocusCard.tsx:24`, `MapRail.tsx:361`,
  `MapDayStrip.tsx:144` — the day strip is the one this list missed.
  `mapRailData.ts` is **not** a call site: it holds no unit string at all, it
  is the `totalKm` *source*, and its computation does not change.
  **Timeline's day summary no longer renders a distance** — M10 Phase 8 removed
  it, and `TimelineLens.tsx:167-171` and `:192-195` record that; there is
  nothing there to convert. The **"longest-hop" surface named in the exit gate
  does not exist** in this app either; it is in the design prototype only.
  `packages/domain/src/trip/conflicts.ts:211` stays in kilometres: it emits a
  user-visible `~N km apart on the same day`, but it lives in the pure domain,
  which the UI may not import and which takes no I/O, so plumbing a preference
  in would cross the architecture wall (AGENTS.md invariant 4). Left as is,
  deliberately.
- Home time on hover, which additionally needs `trip.tz` and a tz resolved from
  the home airport. SPEC §12 argues — correctly — that this must stay a
  *reference on demand*, never a global display mode: every time in a plan is
  local ("dinner at 7pm" means 7pm in Kyoto), so a global toggle would rewrite
  the itinerary and render the 8:20am Romancecar as 4:20pm the previous day.
- Resolve `who` to a display name (audit B8) if the user record makes it cheap.

## Exit gate

- [x] A signed-in person can set their name and home airport, and both survive a
      sign-out/sign-in and a server restart.
      *(Closed 2026-09-11. `e2e/m17-account-preferences.spec.ts` sets both on a
      fresh account and finds them after a reload; `users.int.test.ts` drives
      the **real `recordSignIn`** over a row holding all three preferences and
      asserts they survived while `users.name` still refreshed from the
      provider — which is the sign-out/sign-in half, and the reason
      `display_name` is its own column. "Server restart" is carried by the
      columns being on `users`, not in client state or the JWT.)*
- [x] Switching Kilometres/Miles changes **every** distance the app renders —
      the map rail day totals, the map focus card, and the map day strip —
      through one helper, with no per-trip unit field anywhere.
      *(**Call-site list corrected 2026-09-01**, verified by grep. The original
      box named "longest-hop, leg labels, Timeline day summary": the
      **longest-hop surface does not exist** outside the design prototype,
      Timeline's day summary **no longer renders a distance at all** — M10
      Phase 8 removed it, `TimelineLens.tsx:167-171` and `:192-195` record it —
      and the day strip, which does render one, was missing. This is a
      correction of fact about the code, not a change to what the box asks for:
      it still says "every distance, through one helper". The one distance
      string NOT converted is the conflict engine's `~N km apart on the same
      day` (`packages/domain/src/trip/conflicts.ts:211`), which stays in
      kilometres because it lives in the pure domain — plumbing a preference in
      would cross AGENTS.md invariant 4.)*
      *(Closed 2026-09-11. All three call sites import `kmLabel` from
      `@/lib/units` — `MapFocusCard.tsx:3`, `MapRail.tsx:5`,
      `MapDayStrip.tsx:14` — and nothing else in the app formats a distance.
      "No per-trip unit field anywhere" is verified by grep: `distanceUnit`
      appears in `packages/contracts/src/identity.ts` only, which is account
      scope. The e2e walks the flip end to end — the map day tile reads `km`
      for a brand-new account, `mi` after the switch, and asserts no `km`
      string remains.)*
- [ ] ~~Home time on hover is off by default, and when on shows the reference
      line without altering any stored or displayed plan time.~~
      **Amended OUT of the gate 2026-09-01 by Mitchell's explicit decision**
      (`docs/milestones/README.md`: a gate definition changes only that way).
      **It carries forward as its own item, not a deletion** — see
      "Deliberately not here" below for its prerequisites.

      Why: the app has **no timezone infrastructure at all** (checked
      2026-09-01). There is no `tz` field anywhere in `packages/contracts`, so
      a trip has no zone to be "away from"; the two date formatters do not take
      one from anything — `lib/dates.ts` pins `Intl` to UTC and
      `lib/formatDate.ts` deliberately constructs in local time, and neither is
      a zone-aware clock; there is no airport dataset to resolve a code
      against; and there is no date/tz library in the dependency tree at all.
      This box needs all three of those built *plus* a `packages/contracts`
      change for `trip.tz` — and AGENTS.md invariant 5 reserves a contract
      change for its own reviewed PR, so it cannot sit inside another
      milestone's gate anyway. Sizing it honestly makes it a milestone, not a
      box.

      What M17 still delivers of C7: the **home airport is stored and
      displayed**. It simply does not yet drive a tz reference line.
- [x] **The preferences migration is written, applied locally, and its
      production dispatch is called out in the PR body.** Merging does not
      apply a migration — it is dispatched with
      `gh workflow run migrate-production.yml -f confirm=migrate` from `main`,
      and an undispatched migration is schema drift.
      *(**Replaces the original box 4**, "the decision on user identity is
      recorded as an ADR with the migration path for existing
      `TripMember.userId` strings" — amended 2026-08-29 by Mitchell's explicit
      decision, because **ADR-025 already recorded exactly that** as part of
      M11 link 1. Citing ADR-025 satisfies the original intent; what this
      milestone actually risks is a schema change nobody dispatches.)*
      *(Closed 2026-09-11 — **and the dispatch really happened**, which is the
      only part of this box that could not be read off the diff. PR #112 merged
      at `2026-09-02T06:47Z`; a `migrate-production` run succeeded on `main` at
      `2026-09-02T07:03Z`, sixteen minutes later. `0015_green_xorn.sql` adds
      `display_name`, `home_airport` and `distance_unit`, and four later
      migrations (0016-0018) have since applied on top of it, which they could
      not have done out of order.)*

## Deliberately not here

- Anything trip-scoped. If a preference could differ between two trips of the
  same person, it does not belong in this milestone.
- **Plan and usage in the account sheet** — designed 2026-09-02
  (`.design-sync/handoff/SPEC.md` §17.4), owned by **M21 link 5**, blocked on
  all of M20 and M21. Noted here only because of where it lands: the design
  puts a **Plan section at the top of this same sheet**, above the preferences
  this milestone is building, carrying two usage meters, past-due copy, a
  referral row and an inline three-plan chooser. Nothing here should be built
  to it — but the sheet's layout should not assume preferences are the first
  thing in it, because the cheapest moment to leave room is now and the
  dearest is after the meters exist.
- **Home time on hover (SPEC §12 C7)** — amended out of the exit gate
  2026-09-01, see box 3 above. It carries forward as its own item and still
  needs a slot in `docs/milestones/README.md`'s order; placing it is Mitchell's
  call, not something this milestone's PR decides. Its prerequisites, in the
  order they have to happen: a `trip.tz` contract field (its own reviewed PR,
  AGENTS.md invariant 5), a way to resolve an IATA code to a zone, and a
  zone-aware formatter. The home airport this milestone stores is the input it
  will read.

## Retro — 2026-09-11

**The milestone shipped on 2026-09-02 and was marked done on 2026-09-11.** The
code was not late; the bookkeeping was. That nine-day gap is the thing worth
carrying forward, not the feature — which is small, was built to its scope, and
has been in production the whole time.

**1. The gate-close checklist failed in the one way it was written to prevent.**
`docs/milestones/README.md` says every status flag flips *in one commit when the
gate passes*, and names M2 as the milestone that once stayed unticked. This is
the same failure with a different shape: M2's flags were missed at a gate that
*happened*, and M17's gate simply never happened — PRs #111 and #112 merged, the
migration was dispatched, and nobody performed the close. The checklist has no
step that fires when a milestone's last PR merges, because the trigger it names
is "the gate passes", and a gate that nobody convenes never passes. Everything
downstream then read `TODO.md` correctly and was wrong: five sessions' state
digests reported `M17 — Account preferences, 0/3` while M17's three boxes had
been satisfiable for nine days.

**2. The cost was not cosmetic — the declared order stopped describing the
work.** With M17 nominally current, the recorded order was
`M17 → M9 → M20 → M21 → M12 → M13 → M14 → M19`, and in that window **M12's link
7 merged (#159) and three M14 links merged (#126, #129, #130)** — two milestones
that sit fifth and seventh in that queue. AGENTS.md's "do not build ahead of the
current milestone" was not violated deliberately by anyone; it was violated
because the marker pointed at finished work, so "ahead" had no meaning. A stale
flag does not just misreport the plan, it suspends the rule that depends on it.

**3. What actually closed this gate was re-derived evidence, not the PR's.**
PR #112 shipped with `test:e2e:ci-like` unrun and its browser walk recorded as
the literal word *"nothing"* — an honest draft-stage entry that was never paid
off, because the PR merged without leaving draft in the usual way. Closing the
gate therefore meant running the evidence now: the spec passes on the `ci-like`
lane (2 passed), the integration suite is green (41 files, 493 tests), and the
production dispatch was confirmed from the workflow history rather than assumed
from the PR body that promised it.

**4. The spec was made to fail before it was trusted.** CLAUDE.md rule 3, applied
to somebody else's test rather than a new one. Dropping the three preference
fields from `writePreferences`'s `.set()` — leaving `updatedAt` so the write
still succeeds and the route still returns a row — turned the spec red at
`m17-account-preferences.spec.ts:94`, `Received: "sfo"`: the airport never
round-tripped, so the server-side normalisation the test exists to prove was
gone. Restored, green again. That is what makes the tick above evidence instead
of inference, and it is worth doing to *any* test whose green you are about to
spend.

### Two things carried forward, deliberately

- **`TripMemberProfile` still has no `displayName`.** The scope bullet was
  *"resolve `who` to a display name **if the user record makes it cheap**"*, and
  the seam is built: `lib/displayName.ts` is the single resolver, `displayName`
  is first in its chain, and the account menu reads it. `TravelersPanel`,
  `SharedDayScreen` and `DiscoverCard` still do not, because the field they need
  is on a `packages/contracts` schema and invariant 5 reserves a contract change
  for its own reviewed PR. It is one field on a query that already reads the
  whole `users` row. **This is not a gate box and never was** — it is the scope
  flexing where the milestone file said it may.
- **The deployed browser walk was never performed for M17.** The `ci-like` lane
  is a production build, which is the strongest evidence available with no open
  PR and no preview to walk, but it is not the same thing. `docs/STATUS.md`'s
  standing observation is that the walk has found what no test could at four
  consecutive gates — and at M18b's gate what it found was an accessibility
  defect no unit test could see. **The Sheet, the radio group and the three map
  surfaces have not had that.** Closing this gate on test evidence is a
  deliberate choice, recorded here so it is a known gap and not a silent claim.
