# M11 — Sharing, invites, and a trip you can hand to someone

**Status:** Approved 2026-08-27, **in flight**. Scheduled ahead of M18's
remaining surfaces and ahead of M16, by Mitchell's call on 2026-08-27.

**This milestone absorbs M13's invite and role scope.** M13 keeps only
near-real-time sync and the transport ADR; roles, invites and revocation move
here, because they are the same `AccessPolicy` change as share links and doing
them apart means opening that boundary twice. M11's own Playbooks/templates
scope stays. **M12 Community is explicitly not in scope** — no public gallery,
no discovery, no voting, and therefore none of the trust & safety surface it
quarantines. Mitchell, 2026-08-27: *"We can hold on the full community trip
board, right now just figure out sharing when i choose what and why, and
inviting them to my trip."*

## Why now, and what it displaces

M18 stops after PR 1. Its `kind`/`tags` contract fields are merged and **inert**
— nothing reads them, there is no half-built surface to unwind, and no migration
to reverse. That makes it the cheapest possible place to stop, which is why the
reorder costs nothing. M18's remaining surfaces and M16 both move behind this.

## The five things a person can actually do

1. **Invite someone to my trip**, and have them modify it.
2. **Share a read-only version of my trip from the current history point** — if I
   click Share and then keep planning, the link still shows the trip as it was
   when I shared it.
3. **Clone a trip someone shared with me** into my own, where it is editable
   because it is now mine.
4. **Select parts of my trip and save them** for reuse.
5. **See trips shared with me** alongside my own.

## Two decisions this milestone must make first

Both are ADR-worthy, both sit under everything else, and both are the most
likely thing in this milestone to be overturned in review.

**Identity — there is no users table today.** The schema is four tables
(`events`, `trip_summaries`, `trip_details`, `pages`); Auth.js runs JWT-only
with no adapter, and `actorId` is a bare `text` column. Inviting someone
requires durable identity *before* they accept. Proposed: keep JWT sessions, add
a `users` table populated on sign-in, and make `actorId` its foreign key —
cheaper than moving Auth.js to database sessions, which would touch every auth
path M15 shipped. **Decided in link 1:
`docs/architecture/ADR-025-users-table-under-jwt-sessions.md`** (Proposed, open
to reversal). One narrowing against the proposal above: `actorId` refers to
`users.id` but has **no database foreign key** — the log carries the non-person
`'system'` actor and eight milestones of rows that predate the table, and a FK
would put an Identity write on the planning-command path (the ADR-003 boundary
smell). The reference is upheld at the sign-in seam and tested end to end
instead; ADR-025 has the full argument.

**Pinned share reads.** `events` carries `(streamId, seq)` under a unique index
and M2 already built replay. Proposed: a share token stores the trip's `seq` at
share time and the read replays `seq <= n`, rather than snapshotting the
projection. A snapshot is really a copy and drifts from "share this point in
history." Note this read cannot use the materialized `trip_details` projection.
**ADR due.**

## Scope, as a stacked chain

Each link branches off the previous one and opens a **draft PR based on its
parent**, never on `main` (`AGENTS.md:170-188` — a branch is not done until its
PR is open; stacking is compatible with that, merging early is not). Links run
**sequentially**: one Postgres `travel` database on :5433 is shared by every
worktree on the machine, so parallel links race on it.

| # | Link | Preview shells retired |
|---|---|---|
| 1 | Users & identity | — |
| 2 | Roles & `AccessPolicy` — `TripMember.role` literal → `owner\|editor\|viewer` | — |
| 3 | Invites — create / accept / revoke | `trip-invites`, `wizard-invite-list` |
| 4 | Pinned read-only share | `share-button`, `landing-peek-trip`, `landing-see-finished` |
| 5 | Clone-with-lineage | — |
| 6 | Keep-a-day / saved parts | `keep-day-flag`, `keep-day-dialog`, `add-saved-day` |

Links 1 and 2 are contract changes, so each is its own reviewed step
(`AGENTS.md:160`) — the shape M18 PR 1 proved.

**Known design gap.** SPEC §8 lists **Travelers UI as "deliberately not designed
yet"**; travelers are reachable only through Trip settings until it exists. Link
3 therefore invents its own invite-management UI. Keep it minimal and inside
Trip settings, where the spec already parks it, and expect this to be the
surface most likely to be redesigned.

## Exit gate

- [x] A user is a durable row, and `actorId` refers to it. *(link 1)*
- [ ] A trip has non-owner members with a role that `AccessPolicy` enforces.
- [ ] An invited person can open the trip and modify it.
- [ ] A share link renders the trip **as of the seq it was created at**, proven
      by editing the trip afterwards and seeing the link unchanged.
- [ ] A shared trip can be cloned into the recipient's own trips and edited.
- [ ] Trips shared with me appear in the Home grid (SPEC R4 deleted the
      "1 shared with you" label as duplicated information — they simply appear).
- [ ] Every retired `<Preview>` shell is removed from `preview-registry.ts`, and
      its sync test still passes.
- [ ] Contracts changelog entry per contract change; projection-rebuild golden
      test still passes.
