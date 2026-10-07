# M35 — You can say who on a trip is actually going

**Status:** **Gate closed 2026-10-06, 12 of 12** (retro at the end). Minted 2026-10-05 by Mitchell — *"Create and add a milestone so this work is tracked
correctly."* **Built before it was minted**, on one branch (`ccr-d8e97d98-xyat7o`, PR #335), from
an approved spec and a T1–T9 plan, while **M34 is the current milestone**. So it ran out of the
README order: nothing placed it, and AGENTS.md says not to build ahead of the current
milestone. This file records that rather than hiding it. Mitchell decided the same day **not to
restack the branch** into the A/B/C split the plan describes; it is reviewed as one PR, and the
split survives only as the review order. Its row sits after M34 in `TODO.md`.
Spec: `docs/specs/2026-10-05-travellers-and-people-panel-design.md`. Plan:
`docs/plans/2026-10-05-travellers-and-people-panel.md`. Core decision: ADR-065, which amends
ADR-060 decision 2.

## Why this exists

**Every member counted as a traveller.** A stop nobody picked was priced for every member, and
the even split in balances went across all of them, viewers included (ADR-060 decision 2:
*"empty = all members"*). On #314's preview a suggester who joined only to advise **doubled the
trip's per-person total, from $9,130 to $18,260**, and showed up in "Who is in" and "Booked by".
Mitchell, 2026-10-04: *"Add a idea for the future to be able to select who in the trip is actually
going on the trip."* That candidate (`docs/candidates.md`) is the source.

**The invite UI was crowded.** The Travelers panel put the invite form, the member list and
revoke into one block. Changing a role meant revoking and re-inviting. Nothing said who owned the
trip, and the open panel did not see an invite being accepted (KI-2026-10-04-b).

**The owner had no state of their own.** The owner has no `trip_memberships` row (they come from
`TripCreated.createdBy`), so the panel had no plain way to say "Owner · created the trip", and no
place to record that the owner might not be going either.

## Decisions (Mitchell, 2026-10-05: every one as recommended)

Numbered as in the spec's §3, so the spec, the plan, ADR-065 and the commits all cite the same D.

1. **D1 — Travelling is Access data, not an event.** A table `trip_travellers(trip_id, user_id,
   travelling, updated_by, updated_at)`, overlaid at read time the way the member count already
   is. A missing row means travelling. The log never learns who is invited (invariant 1, the
   ADR-003 boundary). The cost: History does not show "Sam is no longer travelling".
2. **D2 — Everyone already on a trip stays travelling.** No backfill, so no live total moves on
   deploy.
3. **D3 — A new invite chooses, preset by role.** *Can edit* → travelling; *Can suggest* and
   *Can view* → not travelling. The owner can flip it before sending; the accept writes it.
4. **D4 — Who can change it:** the owner, for anyone including themselves, and each member for
   themselves. Editors cannot change it for others. One AccessPolicy rule.
5. **D5 — The owner can be not travelling.** Totals floor at one person.
6. **D6 — An explicit *Who is in* pick of a non-traveller stands and counts.** The chip says
   "not travelling". Rewriting picks from an Access change would be the boundary smell.
7. **D7 — *Booked by* is any member**, travelling or not. This reverses the candidate's wording,
   and was confirmed with the rest.
8. **D8 — A role changes in place** from the row menu (`PATCH …/members/:userId {role}`). It is
   Access CRUD, and it never grants `owner`.
9. **D9 — Ownership transfer is out of scope.** It is a log change and a billing-subject change.
10. **D10 — People stays in Trip settings, and the trip header gets an avatar stack** that opens
    it. A design change, recorded in SPEC §8.
11. **D11 — Realtime by `accessRev` on the events poll**, as ADR-064 added `suggestionsRev`.
    Every Access write bumps it, and clients re-read access and recost.

The 22 working decisions made during the build (W1–W22: why `travelling` is optional on the
contract, the per-trip revision counter, the gate and lapse banners, where the revision baseline
comes from, and the rest) are the spec's §7. They are not copied here.

## What shipped

All on `ccr-d8e97d98-xyat7o`, one commit per task, in the plan's order:

- **T1, contracts** (`c7b5a98`): `travelling` on members and invites, `SetTravellingInput`,
  `ChangeRoleInput`, `accessRev` on the poll page, `travellerIds`. Public API 1.6.0.
- **T2, storage and Access** (`c63ada8`): migration **0039** (`trip_travellers`,
  `trip_invites.travelling`, `trip_access_revs`), `setTravelling`, `changeRole`, `accessRevFor`.
- **T3, routes** (`7f90cad`): `PATCH /api/trips/:tripId/members/:userId`, `accessRev` on the poll,
  three client calls.
- **T4–T5, costs count travellers** (`bea5885`, `4eb4658`): domain, the read overlay, shares,
  every consumer surface, the widgets and the assistant's reads.
- **T6–T7, the People section** (`a47e895`, `0018e3e`): `Avatar` and `Menu` primitives;
  Travelling, Not travelling and Invited groups; the owner state; one `⋯` menu per row; the
  invite dialog.
- **T8, realtime and the header** (`1c575b8`): the provider re-reads access on a new revision;
  the header avatar stack.
- **T9, e2e and docs** (`3fb6f21`, `8fb451b`): `travellers.spec.ts`, the invite specs moved to
  the People section, ADR-065.
- **A fix the new spec found** (`b638a83`): the revision baseline comes from the access read
  (KI-2026-10-05-g, resolved; spec W22).
- **Merged with `main`** (`edaad30`), bringing M34's work in. This branch's KIs were renumbered
  d/e/f → e/f/g.

## Out of scope

- Ownership transfer (D9). It would be its own candidate.
- Marking yourself "not joining" one stop without opening the editor.
- Avatars and colours you choose (a separate 2026-10-04 candidate). The `Avatar` primitive built
  here is where it would plug in.
- Notebook widgets on the invite-accept page (a separate candidate).
- Showing travelling changes in History (the cost of D1).

## Exit gate

- [x] **Travelling is Access data, and deploying it moves no live total** (D1, D2): a missing row
      reads as travelling, nothing is backfilled, and a projection rebuilt from the log equals
      the stored one, because the log's members carry no `travelling` (W1).
      *(Ticked 2026-10-05: migration 0039 in `c63ada8`; `travellers.int.test.ts` against real
      Postgres. ADR-065.)*
- [x] **Who may change it, and a role change in place, are held at the Access seam** (D4, D8):
      the owner for anyone, a member for themselves, an editor for nobody else; a role change is
      owner-only and never grants or touches `owner`.
      *(Ticked 2026-10-05: `accessPolicy.test.ts` and `travellers.int.test.ts` in `c63ada8`;
      `members/[userId]/route.int.test.ts` in `7f90cad`.)*
- [x] **Costs count travellers wherever a price is multiplied** (D5, D6, D7): the read, a
      command's response, the over-budget rule, shares, balances, every consumer surface and the
      assistant's reads. A non-traveller's explicit pick still counts; *Booked by* is any member;
      the headcount floors at one.
      *(Ticked 2026-10-05: `over-budget.test.ts`, `costs.property.test.ts`,
      `trip-access.int.test.ts`, `shares.int.test.ts` and `rollups.test.ts` in `bea5885`; the
      consumer tests in `4eb4658`. Each task's seen-red report went to the building session and
      was not committed. The failure text the repo does record for this rule is the e2e one in
      the box below.)*
- [x] **The People section replaces the Travelers panel** (spec §4, D3): three groups, the owner
      state, "You", one `⋯` menu holding only what the reader may do, confirms on revoke, remove
      and leave, and an invite dialog whose "Coming on the trip" switch is preset by role.
      *(Ticked 2026-10-05: `people/*.test.tsx` in `0018e3e`, with the old panel's 25 behaviours
      rewritten against the new structure rather than dropped.)*
- [x] **An Access change reaches the board without a reload** (D11), and the header stack opens
      People (D10).
      *(Ticked 2026-10-05: `TripProvider.test.tsx`, `broadcast.test.tsx` and `TripHeader.test.tsx`
      in `1c575b8`, which resolved KI-2026-10-04-b. The first-poll baseline hid an accept made in
      the first two seconds (KI-2026-10-05-g); fixed in `b638a83` with
      `access/route.int.test.ts` and a `TripProvider.test.tsx` case.)*
- [x] **The e2e journey passes on `pnpm --filter web test:e2e:ci-like`**: a suggester joins
      preset not travelling, sits under *Not travelling* without a reload, and the owner's served
      total is unchanged until they are marked travelling, when it doubles. The invite specs
      still pass against the People section.
      *(Ticked 2026-10-05: `travellers.spec.ts`. Seen red with `overlay.ts` counting
      `members.length`: `expected 913000, received 1826000` (`3fb6f21`). Without `b638a83`'s
      fix it failed on the ci-like lane at `travellers.spec.ts:137`, and passed twice with it.
      The full ci-like run was **236/236 before the merge with `main`**, as the building session
      reported it. It has not been re-run on ci-like since `edaad30`.)*
- [x] **`pnpm check` is green on the merged branch.**
      *(Ticked 2026-10-05: at `edaad30`, clean tree. The local Tier-3 stamp
      (`.git/tc-tier3.json`, written as `pnpm check`'s last step) records that sha at
      15:15 UTC.)*
- [x] **The assistant's live set is re-run with M33's tooling** (`pnpm --filter web eval`),
      because the cost wording it reads changed (plan T5). This needs a live model and a paid run.
      *(Ticked 2026-10-06 on Mitchell's word, asked whether to tick it, leave it open or carry it:
      *"Tick it on your word"*. **Not re-run for the close**: the closing session had no model
      key. No eval output after #335 is recorded.)*
- [x] **CodeRabbit's review on #335 is worked** (`docs/guidelines/working-a-review.md`).
      This step is Mitchell's.
      *(Ticked 2026-10-06: there was no review to work. CodeRabbit skipped #335 ("does not
      receive automatic reviews because it has fewer than 10 stars"), and the PR has no reviews
      and no review threads, as read from GitHub at close.)*
- [x] **[walk]** On #335's preview, as two people: the owner invites a suggester, who accepts
      with the switch preset off. The owner's per-person total does not move, and the row sits
      under *Not travelling* without a reload. Marking them travelling doubles it. The owner row
      reads "Owner · created the trip", and the header stack opens People.
      *Walked 2026-10-05 at `edaad30` in headless Chromium, with 2–3 live contexts. All of the
      above passed:*
      - *The join showed on the owner's unreloaded page in 2.8–3.9s. The total stayed 12000,
        then went to 24000 when they were marked travelling.*
      - *Change role, Remove and Revoke all passed, with the spec's confirm wording.*
      - *The invitee's own menu showed the toggle and Leave. Their toggle reached the owner in
        2.8s.*
      - *At 390px: no overflow, 44px menu buttons, and the header stack hidden.*
      - *No console errors from the app.*

      *Not walked:*
      - *The owner was the dev account `alice`: a fresh account cannot get
        `trip.collaborators` on a preview (KI-2026-09-16-d).*
      - *The gated invite dialog.*
      - *The stop editor's "Who is in" grouping and its "not travelling" chip (D6).*
      - *The home cards' traveller count.*
      - *Copy link from a row menu.*

      *Found: KI-2026-10-05-h.*
- [x] **Migration 0039 is applied to production**: `migrate-production` dispatched after merge,
      and `pnpm state` reports it applied.
      *(Ticked 2026-10-06: run #37 (`37349376298`), dispatched 2026-10-05 17:33 UTC on `498530c`
      (#335's merge, whose tree has `0039_trip_travellers.sql`), succeeded with "migrations
      applied successfully!". Run #40 (`37478131814`) on `767d503` 2026-10-06 also succeeded and
      covers `0040` and `0041`. This session's `pnpm state` read "5+ NOT applied" from a stale
      run (`ef8d096`, 2026-09-27) because `gh` is unavailable in cloud sessions. The runs above
      were read through the GitHub API instead.)*
- [x] A retro is appended at gate close.

## Carried, not gating

- `KI-2026-10-05-e`: with nobody travelling, the board prices one person but balances charge
  nobody (W4). It is only reachable when every member, owner included, is marked not travelling.
- `KI-2026-10-05-f`: the trip-list endpoints return a lapsed owner's collaborators uncapped. It
  predates this work and was found during it.
- `KI-2026-10-05-h`: a removed member's open page never learns they were removed. Found on the
  preview walk.

## Retro — gate closed 2026-10-06 (12 of 12)

Closed at Mitchell's request on 2026-10-06 (*"close out the previous by confirming the migration
run, and checking the boxes"*). Two boxes were closed on evidence read at close: the migration,
from the `migrate-production` run log, and CodeRabbit, which never reviewed the PR. The eval
re-run is ticked on his word and was **not** run.

**What shipped.** Travelling is a per-person Access attribute counted at read time (ADR-065,
migration `0039`). Per-person costs, shares, balances, the over-budget rule and the assistant's
reads count travellers, not members. A suggester who joins to advise no longer doubles a total.
Trip settings → People replaced the Travelers panel, with an owner state, role changes in place
and Access changes that reach the board without a reload. One PR, #335.

**What held.**
- **Built before minting, still one reviewable PR.** It was built while M34 was current and was
  not restacked, by decision. The plan's A/B/C split survived as the review order, and every
  automated box was ticked before merge.
- **The e2e found the bug the unit tests missed.** It was seen red on the doubled total, and on
  the ci-like lane it found the first-poll baseline that hid an early accept (KI-2026-10-05-g,
  fixed in `b638a83`).

**What did not.**
- **The eval box gated on a paid run nobody scheduled.** It sat open for a day and closed on
  attestation. A box that needs money or a key belongs to whoever holds the key, and should say
  so when it is written.
- **`pnpm state` cannot see `migrate-production` from a cloud session** (no `gh`), so it reported
  migrations unapplied a day after they ran. The close used the GitHub API instead.

**Left open, not gating.** KI-2026-10-05-e, -f and -h, listed under *Carried, not gating*.
