# M11 — Sharing, invites, and a trip you can hand to someone

**Status:** Approved 2026-08-27, **gate closed 2026-08-28**. Scheduled ahead of
M18's remaining surfaces and ahead of M16, by Mitchell's call on 2026-08-27;
M18's surfaces are unblocked by this close.

**This milestone absorbs M13's invite and role scope.** M13 keeps only
near-real-time sync and the transport ADR; roles, invites and revocation move
here, because they are the same `AccessPolicy` change as share links and doing
them apart means opening that boundary twice. M11's own Playbooks/templates
scope stayed here until the gate — **Mitchell carved it out on 2026-08-28 as
its own follow-on** rather than hold the gate open for it; see "Playbooks, and
why it is not in this gate" below. **M12 Community is explicitly not in scope** — no public gallery,
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

**Closed 2026-08-28.** Evidence for each box is in the retro below; the browser
walk was done on this branch's Vercel preview as two real actors.

- [x] A user is a durable row, and `actorId` refers to it. *(link 1)*
- [x] A trip has non-owner members with a role that `AccessPolicy` enforces.
- [x] An invited person can open the trip and modify it.
- [x] A share link renders the trip **as of the seq it was created at**, proven
      by editing the trip afterwards and seeing the link unchanged.
- [x] A shared trip can be cloned into the recipient's own trips and edited.
- [x] Trips shared with me appear in the Home grid (SPEC R4 deleted the
      "1 shared with you" label as duplicated information — they simply appear).
- [x] Every retired `<Preview>` shell is removed from `preview-registry.ts`, and
      its sync test still passes.
- [x] Contracts changelog entry per contract change; projection-rebuild golden
      test still passes.

## Playbooks, and why it is not in this gate

**Decided by Mitchell, 2026-08-28, at the gate:** Playbooks/templates becomes
its own follow-on; M11's gate closes on the six links that shipped.

The question had to be asked because this file said two things that had drifted
apart. Its scope paragraph said "M11's own Playbooks/templates scope stays"
(inherited from M7), and nothing built it: four `<Preview>` shells are still
inert and still M11-tagged in `preview-registry.ts` —
`home-playbooks-strip`, `playbooks-route`, `insert-playbook`,
`wizard-playbook-panel` — and `/playbooks` is a whole route rendering
`PREVIEW_PLAYBOOK_CARDS`, reachable from the home page's own nav. But **none of
the eight exit-gate boxes tests Playbooks**, and none of the six links touches
it. So the gate as written was satisfiable without it, and the scope sentence
was the only thing saying otherwise.

Both readings were defensible, which is exactly why it was Mitchell's call and
not a subagent's. Holding the gate open would have left every other status flag
stale — the thing `docs/milestones/README.md`'s checklist exists to prevent —
for scope no box measures. Recorded as **M11b** in `TODO.md`, **approved and
unplaced**: it needs its own scope and exit gate written before it opens, and
saved days (link 6) is the data model it would build on. The four shells stay
M11-tagged deliberately, so the registry keeps pointing at the milestone that
owns them rather than being re-tagged to a milestone that has not agreed to
take them.

## Retro — what we learned, what changed

**The gate ran on 2026-08-28 and closed the same day.** Nothing structural was
in front of it: links 1-6 had landed via PR #71, PR #78 had remediated both
2026-08-28 reviews, and migrations 0006-0010 were dispatched to production —
which is what unblocked the gate, since `recordSignIn` upserts into `users`
with no try/catch and sign-in itself throws against a database without that
table.

### Evidence

**The lane that counts: `pnpm --filter web test:e2e:ci-like`, 46/46 green on
two consecutive runs** against a production build. All five M11 specs
(`m11-invites`, `m11-share`, `m11-clone`, `m11-saved-days`, `m11-demo`) passed
on every run of the gate, including the first.

Rest of the Definition of Done: `pnpm check` green (typecheck, lint, and every
unit suite — contracts 100, pages 32, domain 153, fixtures 8, factories 354,
web 1170 passed / 1 skipped, plus 122 script tests), and **242 integration
tests across 25 files green against real Postgres**, which had to be run
explicitly — see "The false green" below. The projection-rebuild golden test
(`commands.int.test.ts`, "GOLDEN: rebuild from the log equals the live
projections") was additionally re-run alone and named in its own output.

**The browser walk, on this branch's Vercel preview, as two real actors** —
`gatealice` (owner) and `gatebob` (invited editor), via dev login, which is
live on preview and correctly absent from production. This covered the two
things a local walk cannot:

- **Invite → accept → edit as a second actor.** Alice invited
  `gatebob@example.com` as an editor from Trip settings' Travelers panel
  (`editor` / `Waiting` / Copy link / Revoke). Signed out. The invite link as a
  stranger redirected to `/signin?callbackUrl=/invite/<token>` and came back to
  the invite after sign-in. Bob saw "gatealice invited you to this trip — you'll
  be able to change the plan", joined, landed on the board with **2 travellers**
  and no read-only gating, and added a stop that persisted.
- **A pinned share still showing the old state after the trip is edited.** The
  share was minted at "Pinned at change 4" with one stop. Alice then added a
  second stop and Bob later added a third. The link still renders exactly the
  pinned plan — one stop on Day 1, "Nothing planned" on Day 2 — and says so
  itself: *"this is the plan as it was then. It has changed since."* Three
  commands landed against the trip after the pin and none of them leaked.

Also walked, because they were one click away: **the Home grid** (alice's trip
appears plainly in bob's grid with no "shared with you" label, per SPEC R4), and
**clone-with-lineage** ("Make this my trip" → *Gate Walk Kyoto (copy)*, owned by
bob, carrying the **pinned** state rather than the live one, and editable —
proven by editing it).

### Map tiles: better than a cloud session, still not a visual pass

KI-49 bounds what a cloud session may claim about the Map lens, because the
egress proxy blocks `tiles.openfreemap.org`. **This gate did not run in a cloud
session**, so that bound did not apply and the tile pipeline was checked
directly: on the preview's `/demo?lens=Map`, nine resources loaded successfully
from the tile host — the `positron` style, the `planet` tilejson, both sprite
files and four glyph ranges — and a same-context `fetch` of the style returned
200. WebGL is real (ANGLE / Apple M1 Max) and the canvas is mounted and sized.

**What was still not proven: that the tiles paint.** The WebGL canvas captures
blank in this screenshot pipeline, and MapLibre's data tiles are fetched from
its worker, where the main thread's `performance` timeline cannot see them —
so their absence from that list is not evidence either way. The honest
statement is that the tile *transport* is verified and the *pixels* are not.
A blank canvas is not being read as a pass here, and this is an M10 surface
rather than an M11 gate box.

### The CSP has now been executed by a browser — KI-66 is overtaken

KI-66 recorded that the CSP had been written, typechecked and reasoned about
but never run in a renderer. It has now run, and it works — including the part
nobody wanted to find out about the hard way. Two observations:

- It blocks `vercel.live/_next-live/feedback/feedback.js` on every preview
  page (`script-src 'self' 'unsafe-inline'`). That is Vercel's preview comment
  toolbar, not application code, so no app behaviour is affected — but it is
  preview-only chrome that will keep erroring in every preview console.
- It blocked a redirect to `https://vercel.com/sso-api?...` when Deployment
  Protection re-challenged an in-flight XHR, which surfaced in the app as
  *"This invite doesn't work — Failed to fetch"*. This is the CSP doing its
  job on a cross-origin redirect, not an invite defect: refreshing the
  `_vercel_share` bypass and repeating the click accepted the invite normally.
  `docs/guidelines/cloud-agent-sessions.md` already warns not to mistake
  Vercel's 302 for a response from the application; this is the same trap
  wearing a different mask, and it is worth knowing that it reaches the app as
  a generic fetch failure rather than as anything nameable.

### KI-75: the one red spec, and why it was a test bug

The gate's first full run was 45/46. The failure was **not** M11 — it was
`m10-map-rail.spec.ts`, failing at the same assertion every time with a
*different* day missing each time (2, then 12, then 5): 3 failures in 5 runs.

A fixed failure line with a wandering value is a sampling race. The rail
throttles focus evaluation (`scrollThrottleMs`, 50ms, leading+trailing) and
emits only on change; the scan stepped every two frames (~32ms), under that
window, so steps collapsed into one trailing evaluation that read whatever
`scrollTop` was current when it ran — and any band crossed inside a collapsed
span was never emitted at all. The spec's own header asserted the opposite
("still recorded by the MutationObserver below"), which is why the race
survived the overhaul that introduced it. Fixed by walking one band at a time
and awaiting `expectFocusedDay(i)` before advancing — an event, not a duration,
so the sleep wall stays satisfied. 6/6 green after, then 46/46 twice.

**The rule this earns:** `docs/known-issues.md` is written around a failure
whose *location* wanders. This one's location was fixed and its *value*
wandered, and it is the same diagnosis. Read the whole failure for movement,
not just the line number.

### The false green — `pnpm check` skipped the integration tests and exited 0

`pnpm check` returned 0 on this machine while running **zero** integration
tests. `test:int:if-db` probes with `pg_isready`, which is not installed here
(no local Postgres client — the database runs in Docker), and the probe is
`2>/dev/null`, so a missing binary is indistinguishable from a missing
database. The suite printed its "SKIPPED" banner and the command still
succeeded.

Postgres was running and reachable the whole time, verified two ways
(`docker exec … pg_isready` inside the container, and a `pg` client connect
from the host). The 242 integration tests were then run directly and are green.
Filed as **KI-76**. The Definition of Done names `pnpm check` as the bar, so a
green `pnpm check` that silently covers less than it appears to is worth more
than a footnote — this is the same class as the e2e lane distinction CLAUDE.md
rule 1 exists for.

### A smaller thing, recorded because it is the same class

**The gate has eight boxes. Three files said "one of nine".** `docs/STATUS.md`,
`TODO.md` and `docs/milestones/README.md` each described this milestone as
having nine exit-gate boxes with one ticked; the list above has always had
eight. Nobody had recounted since the list was written — the number was copied
between files, which is how one arithmetic slip became three assertions.
Corrected in the gate commit.

Harmless on its own. Worth a paragraph because it is the failure mode this
repo keeps paying for in larger denominations: a fact stated once, propagated
by copy, and never re-derived from the source. The gate-close checklist exists
because status flags drift; the count of the flags drifted too.

### What changed in the repo as a result

- `apps/web/e2e/m10-map-rail.spec.ts` — the band-at-a-time scan (KI-75).
- `docs/known-issues.md` — KI-75 (resolved), KI-76 (open).
- The four status flags, in one commit, per `docs/milestones/README.md`.
