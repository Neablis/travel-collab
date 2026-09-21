# Milestone decision archive

Every dated decision note whose milestones have all closed their gates, moved
here verbatim and in order on 2026-09-21. Nothing was reworded and nothing was
deleted; `docs/milestones/README.md` keeps a one-line dated pointer to each.

This is the treatment `docs/STATUS.md` has had twice already
(`docs/retros/2026-08-28-status-archive.md`,
`docs/retros/2026-09-11-status-archive.md`) and for the same reason: these
notes are **the argument, not the live instruction**, and they were 56% of a
file whose live half is the milestone table.

**Why one archive rather than one note per milestone file.** The notes cite
each other by date — *"the 2026-09-13 note below"*, *"the 2026-09-19 note
above"*, 35 such references. Splitting them across milestone files would break
every one. Kept together and in order, they still read.

**One consequence, stated so it is not discovered.** A note still in
`README.md` may say *"the 2026-08-30 note below"* about a note that now lives
here. The date is the stable reference; the direction word is not. Search by
date, in both files.

---

### 2026-08-30 — M17 is jumped; M11a and M11b run first

**Mitchell's decision, 2026-08-30**, asked for as *"finishing out the rest of
M11"*: build the two remaining milestones of the M11 access family — **M11a**
then **M11b** — ahead of **M17**, which was the placed current milestone as of
M18b's gate close the same day. M17 is not cancelled and not re-scoped; it
keeps its file, its scope and its migration, and moves to after M11b.

Why it is safe for M11a: `M11a-invite-gate.md` already states that M17 is
**sequencing, not a dependency** — nothing in the invite gate reads a
preference, a display name or a home airport.

**Why it is not free for M11b, recorded here rather than discovered mid-build.**
M11b's own prerequisites say *"M17 closes first"* for one concrete reason: link
6's author strip and link 8's public profile both display a person's name, and
resolving `who` to a display name is exactly what M17's preferences half was to
supply. Jumping M17 therefore means **M11b builds those two surfaces against the
identifier that exists today**, behind one seam, so that M17 fills it later by
changing one resolver rather than two routes. That is a consequence accepted
with the decision, not an implementation miss — see `M11b`'s file, where the
same note is recorded against the prerequisite it amends.

**M18b and M17 were placed 2026-08-29 by Mitchell**, both out of the
approved-but-unplaced set, to be built as one overnight batch alongside the
activity-field descriptor refactor (project review §6.1). M18b needed only a
place. **M17 needed a re-scope first and got one in the same decision** — its
scope item 1 and exit-gate box 4 (the `users` table and the identity decision)
are removed and replaced, because M11 link 1 shipped both under ADR-025; the
amendments are recorded in `M17-account-customization.md`. **M11b Playbooks was
the third, and it was placed a day later** — see immediately below.

**M11b Playbooks was scoped and placed 2026-08-30, and nothing is
approved-but-unplaced any more.** It had been held back for one reason: it had
no scope and no exit gate, and authoring those was a product decision rather
than overnight work. The **2026-08-30 design handoff** is that decision —
`SPEC.md` §15 / `DRIFT.md` §2b turn Playbooks into a public library across four
routes, `playbooks` (Discover), `day`, `board` and `profile`, three of them new.

**The scope line is Mitchell's and it is not §15's line.** §15 spans this
milestone and M12, which owns *"public gallery, discovery, voting, reporting —
all trust & safety scope quarantined here"*. The decision on 2026-08-30:
**M11b takes everything in §15 except reviews; M12 keeps reviews, ratings and
moderation**, and M11b is placed immediately before M12 because M12 builds on
the days M11b publishes. Two deltas from the spec text follow from that (two
sorts instead of four, no rating floor) and are recorded in the milestone file
rather than left for a build session to rediscover.

**One precondition rode on it, and it is now its own milestone.** Deferring
moderation rests on Mitchell's 2026-08-30 reasoning — *"we will gate on who we
invite to platform... we need a community before its a issue"* — and that gate
**did not exist in code**: any Google account that reaches `/signin` gets one.
Scoped the same day as **M11a** and **placed in front of M11b**, because
publishing must not go live on an open signup. It is small, because the seam
already exists: `server/auth.ts` composes a fail-closed `signIn` callback, and
`users` (ADR-025) already records who has been here. Mitchell asked for it to be
rolled in as placed work rather than built on the spot — *"Dont build it yet,
roll it as work to do before the playbook work from the designs."*

**M16's gate closed 2026-08-29** — ten of eleven boxes ticked, and the eleventh
**moved rather than waived**: *"recorded transcripts replay in CI without a live
call"* is now **M9's** box, by Mitchell's explicit decision. It was Task 7 of
PR #88's plan (the eval set plus replay harness), dropped rather than
half-landed; M9's gate already carried the identical criterion and M9 is where
the write agent it measures lives. **KI-11 stays open and is now M9's to
close.** The implementation landed earlier in **PR #88** (`5a362d3`, merged
2026-08-30 UTC), which deliberately flipped no status flag because everything in
it ran simulated — correct under this checklist — and the gate then closed on
Mitchell's live confirmation. Two things the milestone file records rather than
smooths over: Vercel holds exactly **one** real-model `ai.ask` record and the
four acceptance assertions were confirmed locally, so Wave 3's box rests on one
record plus a human pass; and **open question 1 is deliberately left open** —
one record showing two unused tools is not grounds to delete a tool. Retro and
gate evidence: `M16-assistant-read-agent.md`.

**PR #88 also shipped part of M9 early** — write tools behind
propose → review → approve, and `POST /ask/apply`. M9's gate did not close and
none of its boxes were ticked; M9 keeps its place last in the order.

**M18's gate closed 2026-08-29** — eight of eight boxes, the full Definition of
Done green, e2e 46/46 against a production build, and both fields set on a trip
created from scratch through the UI and read back off the API. Its headline
Calendar rule changed at the gate: SPEC §12's travel-day transit split was
built, walked, and **removed the same day** on Mitchell's call, because its
output depended on how the fixture tagged cities — *"I don't think the shape of
the fixture should drive functionality, that's how we get drift."* The Calendar
now groups by city alone, equal cards plus an untitled bucket, and the day-to-day
transition moved to the day label. **Tag focus was carved out as M18b**, and
placed 2026-08-29 as the milestone after M16. Retro and gate evidence:
`M18-stop-kind.md`.

**M11's gate closed 2026-08-28** — all eight exit-gate boxes, the full Definition
of Done green, the e2e suite 46/46 twice against a production build, and the two
flows a local walk cannot reach walked on a Vercel preview as two real actors
(invite → accept → edit as the invitee; a pinned share unmoved by three later
commands). One red spec in the first run was a test-side sampling race in
`m10-map-rail.spec.ts`, root-caused and fixed rather than retried — KI-75. The
run also surfaced KI-76, a `pnpm check` that exits 0 while skipping the whole
integration suite. Gate evidence and retro: `M11-sharing-and-invites.md`.

**Playbooks left M11's gate, by Mitchell's call on 2026-08-28**, as its own
follow-on — **M11b in `TODO.md`, approved and unplaced**. M11's file said its
Playbooks/templates scope stayed, but none of its eight gate boxes tested it and
none of its six links touched it; the four shells (`home-playbooks-strip`,
`playbooks-route`, `insert-playbook`, `wizard-playbook-panel`) stay M11-tagged
in `preview-registry.ts`. It needs its own scope and exit gate before it opens.
*(**Scope and exit gate written 2026-08-30** from the design handoff's §15;
deleting those four shells is now one of M11b's gate boxes.)*

**One milestone is approved and unplaced: M11b Playbooks**, and it is not
"next" merely by being unchecked — it needs its own scope and exit gate before
it opens. *(**Superseded 2026-08-30**, when the design handoff's `SPEC.md` §15
supplied the scope and Mitchell placed M11b after M17. Nothing is
approved-but-unplaced any more. Kept because it is the argument the placement
acted on.)* **M18b and M17 were the other two until 2026-08-29**, when Mitchell
placed both; M17's placement required the re-scope recorded in its own file
(its `users`-table deliverable had already shipped under ADR-025). Everything
below about M17 needing a re-scope is the argument that decision acted on, kept
because it is the reasoning, not a live instruction.

**M10's Wave-2 gate closed 2026-08-27** — the full Definition of Done green, the
e2e suite 31/31 twice against a production build, and every surface walked at
1280 / 1100 / 820px with the assistant rail shown and hidden. Phase order to
that gate was 5, 6, 7, 8, 8b, 9; **Phase 1b was cancelled unbuilt** (2026-08-26).
The walk found and fixed one defect the automated suites are structurally blind
to — see `M10-visual-craft.md`'s Wave-2 retro, which also carries the gate
evidence and the rules promoted out of the deleted phase plans. M8's gate closed
2026-08-08 and the Phase 1 gate review with Mitchell completed the same day.
**M15 Front door's gate closed 2026-08-26 (PR #56), ahead of M10's own** — an
accepted, explicit overlap (`M15-front-door.md` decision 1), not drift.

**Why M18 and not M16.** ADR-022 (2026-08-25) placed M16 immediately after
M10's gate. **M18 was then approved and scheduled ahead of it on 2026-08-26**,
on Mitchell's call — *"i dont want to do KIND and TAGS right now, but we can put
it in a soon milestone"* — because `kind` and `tags` are one contract change and
between them gate five designed surfaces. That later decision governs; M16 keeps
its place immediately after M18.

- **Reorder (2026-08-27), M11's Status line.** **M11 was scheduled ahead of
  M18's remaining surfaces and ahead of M16**, by Mitchell's call, and it
  absorbed M13's invite/role/revocation scope in the same decision (M13 keeps
  only near-real-time sync and its transport ADR — read the M13 row above with
  that subtraction applied). Links 1-6 landed 2026-08-28 via PR #71. The
  decision lives in `M11-sharing-and-invites.md`; it had not been propagated
  here or into `TODO.md` until 2026-08-28. Order from here, with **M11's gate
  closed 2026-08-28**: **M18's remaining surfaces → M16 → M12 → M13 → M14 →
  M9** (ADR-022 moves **M9 to last, after M14**; M15 is done, M10 is done,
  M11 is done).

**Two milestones are approved with no place in that order — M17 and, as of
M11's gate, M11b Playbooks. Neither is an omission, and neither is "next"
merely by sitting unchecked in `TODO.md`.** *(**Both superseded** — M17 placed
2026-08-29, M11b scoped and placed 2026-08-30. Kept as the argument, not a live
instruction.)* M11b was carved out of M11's gate
by Mitchell on 2026-08-28: M11's file said its Playbooks/templates scope
stayed, but none of its eight gate boxes tested it and none of its six links
touched it, so the gate closed without it rather than holding every other
status flag stale for scope no box measures. It needs its own scope and exit
gate written before it opens; saved days (M11 link 6) is the data model it
would build on, and its four shells stay M11-tagged in `preview-registry.ts`.
As for M17 — it is the older of the two: It was approved 2026-08-26 out of SPEC §12 and never scheduled;
until 2026-08-28 it appeared in the table above and nowhere else, which is how
an approved milestone stayed invisible to `TODO.md`, whose rule is "first
unchecked item = current work". Placing it is Mitchell's call and is not made
here. Two facts that call needs:

- **Its central question has already been answered elsewhere.** M17's file
  makes the deliverable *"a `users` table, and the decision of what it keys on
  — the decision is the deliverable here, not just the DDL."* **M11 link 1
  shipped exactly that** (PR #71, ADR-025): `users` is a real table keyed on
  the Auth.js user id verbatim, with JWT sessions kept rather than moving
  Auth.js onto a database adapter. What is left in M17 is the *preferences*
  half — name, home airport, account-scope distance units via one `kmLabel`,
  home-time-on-hover — plus resolving `who` to a display name. That is a
  smaller and more ordinary milestone than the one that was approved, and it is
  worth re-scoping before it is scheduled.
- **Nothing downstream is blocked on it.** No milestone in the order above
  names M17 as a prerequisite, so it can be placed anywhere without moving
  anything else.

### 2026-09-01 — minted and placed: M20 and M21, the first commercial milestones

**Mitchell's call, 2026-09-01**, choosing the placement from four offered:
**after M9.** **New execution order:
`M17 → M9 → M20 → M21 → M12 → M13 → M14 → M19`.** Milestone numbers are
unchanged — this is a placement, the same shape as ADR-018, ADR-021, ADR-022
and the M9 reorder above.

**Why after M9 and not sooner.** `ai-live` defaults off and M9's grounding is
what would let it be turned on, so the largest built feature in the product is
dark. Selling access to it before M9 would sell a dark feature. The competing
placement — straight after M17, to stop the entitlement stub rotting — was
declined on that ground.

**Why two milestones and not one.** M20 takes no money and is therefore
provable end to end with no external service, no test-mode/live-mode split and
no PCI surface; **its admin grant UI is what makes it provable without
Stripe.** Fused, a vendor integration problem would block the tier substrate
that AI gating, quotas and collaboration all read. The same carve the repo
made at M11 → M11a/M11b, for the same reason.

**Three decisions were Mitchell's on the day they were scoped:**

1. **Placement: after M9** (above).
2. **On lapse, granted memberships cap at `viewer`** — not "existing
   collaborators unaffected", which was recommended. The implementation
   consequence is recorded in M20 link 6: the cap is applied **on read** in
   `effectiveMembers`, never written to `trip_memberships.role`, so
   resubscribing restores every collaborator with zero writes and
   `members.ts:148`'s standing rule ("role changes are not supported — revoke
   and re-invite") is not violated.
3. **Every account existing at the tier migration gets a permanent `founder`
   grant** — inviting collaborators is a shipped capability today, and taking
   it from the earliest users is a regression the platform's invite gate makes
   cheap to avoid.

**One decision is still Mitchell's, and it blocks M21 rather than M20: the
plans and their prices.** M20 deliberately names plans without pricing them.

**An ADR is a prerequisite to M20, due before it opens** — not written
mid-build, the same standing as M13's transport ADR and M14's repeaters ADR.
`AGENTS.md`'s module map is structural law and M20 adds a module to it:
**Entitlements**, which owns plans, grants and capability resolution, is
ordinary CRUD, and — like Identity — **explicitly does not know what a trip
is.** It answers `can(account, capability)`; the caller knows that
`trip.collaborators` is about invites. That is what keeps M20's collaboration
gate from being a module-boundary violation.

### 2026-09-11 — M17's gate closed nine days late, and the queue drifted while it was open

**M17's gate closed 2026-09-11 on work that merged 2026-09-02.** The three live
exit-gate boxes were satisfiable the day PR #112 merged; nobody convened the
gate, so `TODO.md`, this file's Current milestone and every session's state
digest went on reporting `M17, 0/3` for nine days. The gate-close checklist at
the top of this file has no step that fires when a milestone's last PR merges —
its trigger is "the gate passes", and a gate nobody convenes never passes. That
is the second time a milestone has stayed unticked (M2 was the first) and the
first time it happened without the gate itself occurring.

**The consequence is an ordering question, and it is Mitchell's, not this
file's.** While M17 sat nominally current, work merged on two milestones sitting
fifth and seventh in the recorded order:

- **M12 link 7** — country search in Discover's box (#159, 2026-09-09).
- **M14 links 1-3** — the Notebooks menu and rebuilt index (#126), a widget
  owning its own day (#129), and the 21-widget catalogue with ADR-037/ADR-038
  (#130). M14's file carries **2 of 14** gate boxes ticked; its builder half is
  merged and its gate is open.

Neither is a violation anyone committed on purpose. AGENTS.md's *"do not build
ahead of the current milestone"* is enforced against the marker, and the marker
pointed at finished work, so "ahead" had stopped meaning anything. **Current
milestone is set to M9 because that is the order recorded on 2026-09-01 and no
decision has superseded it** — not because M9 is where the work has been going.
If the real sequence is now M12/M14 first, that is an amendment to make here
explicitly, the same shape as ADR-021, ADR-022 and the M9 reorder; this note
records the divergence rather than quietly resolving it.

### 2026-09-16 — reordered: M22 runs AHEAD of M21, which pauses at 11/17

**Mitchell's decision, 2026-09-16**, taken with the cost below in front of him
and chosen over closing M21 first. **This is the second way the Current
milestone line may move** — by decision rather than by a gate closing — and the
2026-09-13 reorder is the standing precedent for the shape.

**M21 is paused, not abandoned.** Its file, scope and seventeen gate boxes stand
untouched; six are open. Nothing about this note ticks, unticks or amends a box
— only Mitchell amends a gate definition, and he has not.

**What it costs M21, corrected.** The first version of this note claimed the
reorder put a deadline on one of M21's open boxes. **It does not, and the claim
was wrong in the way that matters** — it treated a bookkeeping question about a
superseded plan version as a gate on building M22.

- **M22 needs no purchase and no Stripe.** An admin grant of `premium` pins
  `livePlanVersion(planId)` (`api/admin/grants/route.ts:29`) and
  `resolveEntitlements` unions the held plan with every grant's pinned version
  (`resolver.ts:149-174`). Granting an account `api.tokens` is one operator
  action against a UI M20 already shipped — which is the grant path's stated
  purpose: *"the entire reason this milestone is provable without Stripe."*
- **What publishing `premium@v2` really changes** is which version a later
  Premium purchase verifies: v2's Stripe Price rather than v1's. `premium@v1`,
  never bought, keeps a Price that was never created — and once superseded it is
  unsellable, unheld and ungrantable, so verifying its Price verifies nothing.
  `checkPriceConsistency` reports such a version `missing`, which its own
  documentation calls *"an ordinary state"* rather than a finding.

**So M21's second gate box stays M21's, on M21's schedule.** If its wording needs
to account for a superseded version, that is an amendment for Mitchell — not a
cost M22 pays in advance.

**One finding surfaced on the way, filed not fixed**: `checkPriceConsistency`
is described as the gate box as a function and **has no caller outside its own
unit tests** — no script, no route, no scheduled check, nothing a deploy
reaches. `KI-2026-09-16-c`.

### 2026-09-16 — placed: M22, a public API and scoped account tokens

**Mitchell's call, 2026-09-16**, answering a placement question directly —
*"Im fine making it after M21."* **New execution order:
`M17 ✓ → M9 [Phase 0 ✓, paused] → M20 ✓ → M21 → M22 → M12 → M13 → M14 → M19`.**
Milestone numbers are unchanged; this is a placement, the same shape as ADR-018,
ADR-021, ADR-022 and the two reorders below.

**Placed, then scoped the same day.** This note was first written *"placed, not
scoped"* because one open decision still moved the scope — the shape of the
planning-write surface — and that was answered hours later as thirteen REST
endpoints. So the milestone file exists: `docs/milestones/M22-public-api-and-tokens.md`,
five phases and a 19-box exit gate — **all five phases landed 2026-09-16, 18 of 19 boxes ticked** — satisfying `TODO.md`'s standing task that
it be written *"before its first commit"*. **Placed and scoped is still not
started**: M22's prerequisite is M21 closed, and M21 is open. Design:
`docs/specs/2026-09-16-public-rest-api-and-scoped-tokens-design.md`.

**One correction the milestone file makes to the design's phasing table**, named
here because it moves what a phase may touch: the table put *"`premium@v2`
published"* in Phase 0 while Decision 12 said the open version question *"is not
a blocker for Phase 0, which does not touch the plan file"*. Both cannot hold,
so **Phase 0 is the contracts change only and publishing the plan version moved
to Phase 1**, where the first `accountCan` check reads it.

**What it is.** A public REST API under `src/app/api/v1/**` plus
account-generated API tokens, scoped to the whole account or to named trips,
with create and revoke. The design's central claim — and the thing its gate
should test — is that **adding endpoint N+1 costs a declaration and nothing
else**: the directory is the registry, one `route()` wrapper owns credential
resolution, scope and role checks, validation, the error envelope, pagination,
rate limiting and the OpenAPI entry, and a conformance test walking `v1/**`
fails CI on a handler that did not declare itself.

**Three boundaries fixed by Mitchell at placement**: user accounts only, **no
admin surface**, and **no AI surface** — so a token can never spend model
budget, and the AI quota and entitlement paths need no change at all.

**Its entitlement was decided the same day**: *"lets lock creating and using API
keys behind top tier for now."* A new `api.tokens` entitlement, granted by
`premium` and gating **both** minting a token and using one. Recorded as a named
plan and never as a tier height — ADR-045 rule 4 forbids plan ordering,
`studio` is the standing proof no rank expresses the set, and
`planVersions.noExtension.test.ts` walks the AST and fails on a rank comparison.
A lapse **disables** tokens rather than revoking them, so resubscribing restores
every integration with zero writes — deliberately the same shape as M20's
decision that granted memberships cap at `viewer` on read.

**Two more answers, 2026-09-16.** The **planning-write surface is thirteen REST
endpoints** and the internal command envelope is not published — the command
routes are BFF-shaped, returning the whole refreshed trip plus history on every
write, so exposing them would freeze both our `TripCommand` union and a
response built for our own re-render as public contract. And **token expiry is
mandatory, capped at 365 days**, 90-day default, with no "never" option; that
makes `api_tokens.expires_at` a `notNull` column and puts three obligations on
the UI (time remaining shown, expired distinguished from revoked, rotation named
as two actions rather than assumed as a feature).

**Writing the scope list out in plain language found a gap, now fixed.** The
draft's seven scopes let `trips:write` create an invite, because an invite is an
ordinary table write against a trip — so a token minted to sync an itinerary
could have handed a stranger editor rights. That is Access & Membership, not
Trip Planning. An eighth scope, `sharing:write`, now covers invites, member
removal and share links.

**The design is fully decided as of 2026-09-16** — scopes settled at eight, and
`PATCH` semantics settled by *"follow rest, you dont need to make opinions about
whats actually happening a patch is a patch"*: one endpoint updates an activity
whatever fields it carries, and a patch touching both a stop's fields and its day
composes the existing all-or-nothing batch. The API never mirrors the internal
command split, which is the same principle that kept the command envelope
unpublished.

**The last open item closed the same day: `premium@v2`.** Mitchell, on the
design's recommendation — *"Just do v2 then."* Granting `api.tokens` publishes **`premium@v2`**, because
`planVersions.ts` is append-only and `noExtension.test.ts` pins every published
v1 entry field by field. A subscription pins `planId@vN` forever and **there is
deliberately no mechanism to move an existing subscriber** (M21's 2026-09-02
amendment: *"what you bought is what you get, now with no mechanism to change
it"*). So **a `premium@v1` subscriber never gets API tokens** unless issued an
**admin grant of `premium@v2`** — which needs no new machinery, since
entitlements resolve as the union of the held version and every grant's pinned
version, and the grant UI already exists from M20. **The cohort needing that
grant grows for every week M21 sells `premium@v1` before M22 lands.**

**Mitchell's first answer was *"just assign it to v1, its unused atm"*, and its
premise is right — but it leads to `v2`, and that is where he landed.** Because
nobody holds `premium@v1`, **neither** option strands anyone; and
`livePlanVersion` returns the newest entry with no flag to set, so publishing
`premium@v2` needs no other edit anywhere. Editing `v1` in place, by contrast,
falsifies a **ticked M20 gate box** (*"`v1`'s entry is byte-identical
afterwards"*) and requires rewriting `noExtension.test.ts`, whose stated purpose
is to fail in the same diff that edits a published entry. The M21 price
precedent does not cover it: that argued *"the field did not exist"*, and
`entitlements` does. **Decided `v2`** — and M22's gate now carries a box
requiring `premium@v1` to be byte-identical when the milestone closes, so the
decision is enforced rather than remembered.

### 2026-09-18 — Current milestone moves to M25; M22 pauses at 18/19

**Mitchell's decision, 2026-09-18** — *"Start next milestone."* Taken with the
order above already settled the same day, so the decision is *which* milestone
is current, not what runs next: M25 is the next milestone in it.

**M22 is paused, not abandoned.** Its file, scope and nineteen gate boxes stand
untouched; one is open. Nothing here ticks, unticks or amends a box — only
Mitchell amends a gate definition, and he has not.

**What is open on M22, and why pausing is not a choice to pay for it later.**
The one box is the reachability walk — *a person mints, copies and revokes a
token by clicking, and sees time remaining on each*. Its CI lane is green and
one of its three preview clauses is met; the other two need an account that can
hold `api.tokens` **on a preview**, which is a **deployment** question rather
than a code one (`KI-20260916-d`). No amount of building closes it, and it is
no harder to close after M25 than before. *(This paragraph named
`API_TOKEN_PEPPER` when it was written on 2026-09-18. That was wrong — the
blocker is `ADMIN_USER_IDS`; see the 2026-09-19 note above.)*

**What it costs M25's predecessor, checked rather than assumed.** M25 adds **no
entitlement** (so no plan version, so no `premium@v3` and no second pinned
cohort — M25's own gate box asserts this with a test), touches **no token
path**, and writes **no migration**. So it cannot move M22's open box in either
direction. The one thing M25 *does* to M22 is measure it: M25 link 1 is the
second independent test of M22's headline claim that endpoint N+1 costs a
declaration and nothing else, this time on an endpoint with a body to build
rather than an array to slice.

**The preflight this kickoff owes, run and recorded.** `TODO.md`'s live-order
line had gone stale — it still named the pre-2026-09-18 order two days after
that order changed — and is corrected in the same commit as this note. No other
flag was unflipped: M22's gate has not passed, so its gate-close checklist is
not yet owed.

**M21 opens with one thing M20 left standing on purpose**: the operator console
has no revenue half. The four-number strip and the per-tier MRR and
median-margin columns are M21 link 7's, `admin.console.test.ts` fails on that
vocabulary appearing early, and `startPlanChange` in `PlanSection.tsx` is the
one function body checkout replaces. Prices are decided and live in M21's file.

**M9 is paused, not cancelled, and it keeps its place immediately after M21.**
Its Phase 0 (the assistant kernel) completed 2026-09-11 in PRs #162 and #163 and
ticked no gate box by design; its three real pieces of work — grounding,
conversation durability, the eval/replay harness — are untouched and its file,
scope and exit gate stand. **M9's gate was the previous `Current milestone`
value** (set 2026-09-11 when M17's gate closed) and it did **not** close; this
line moved by decision, which is the one way it may move other than a gate
close.

### 2026-09-19 — M21's and M22's gates closed, on Mitchell's attestation

**M21 closes at 17 of 17 and M22 at 19 of 19.** The boxes still open — six on
M21, one on M22 — were ticked on 2026-09-19 because **Mitchell stated he had
walked them himself and they all worked, and instructed that both gates close
on that basis.** No agent walked them, and no network log, Test Clock run or
screenshot from those walks is recorded anywhere in this repository. Every
ticked box says so in its own text; nothing earlier under those boxes was
removed.

**Why it closed this way rather than on recorded evidence.** Mitchell does not
want agents walking payments: Stripe test mode proved impractical to set up
with hosted-checkout redirects against protected Vercel previews. M22's last box
was blocked on the preview for a different reason — no browser-reachable account
could be granted `api.tokens` there (`KI-20260916-d`, which stays open).

**Two M21 boxes carry a caveat rather than a clean tick**, each written under
the box: republishing *at a new price* has no differently-priced version on
`main` to have been walked against (the only republish, `premium@v2`, is the
same $19), now `KI-20260919-e`; and `premium@v1`'s Price resolving cannot be
shown by a purchase made after v2 was published, since a purchase now pins v2.
The M21 retro also records what the 2026-09-19 audit found automation does and
does not hold under the six boxes.

**Neither close moves Current milestone**, which stays M13: both milestones sit
behind it in the order, so this is a status flip and not a marker move.

### 2026-09-19 — M23's gate closed, shipped, and the migration applied

**11 of 11 boxes**, merged as `7763913` (#192), and — unusually for this repo —
**the migration was dispatched in the same session as the merge**, so `main` and
production did not diverge. `pnpm check` green (3,115 unit + 782 integration),
`test:e2e:ci-like` at **137 passed**.

A saved day **generalises into a saved sequence in the same row**: flat
`stops[]` with a 0-based `dayIndex` defaulted to `0`, plus a stored
`day_count`. ADR-048 carries the five decisions; **two are marked ✳ because
they contradict a premise stated in the milestone file**, and both survived
review, so the ✳ marks are the record of a deliberate override rather than an
open question.

**On the migration — and read this before trusting any prose about it,
including this paragraph.** `0024_saved_day_day_count` was dispatched from
`main` after the merge and the read-only check reported
*"25/25 migrations applied. Every migration in this tree is applied."* That was
true on 2026-09-19. **It is a dated observation, not a standing fact**, and the
rule in `docs/guidelines/environments-and-deploys.md` is unchanged: the only
things that can answer "is production migrated?" are the
`migration-pending` workflow and `pnpm --filter web db:state`. A line in this
file is not one of them — an agent read a stale bullet as authority on
2026-09-16 and told Mitchell five times to dispatch migrations that were
already applied.

**What M23 leaves live for M12, which runs two milestones from here:**

- **The `saved_days` row will not change shape again for this reason**, which
  was the entire argument for running M23 before M12. M12 can key
  `saved_day_reviews` to it.
- **`SavedStop` now has a rule in its header**: every field added to it from
  2026-09-19 onwards carries `.default()`. That is what made this migration
  additive at both read boundaries, and `KI-2026-09-05-l` is **amended, not
  closed** — there is still no `{ v, stops }` wrapper, so the first genuinely
  non-additive change to that shape still has nowhere to land.
- **One parse helper, two read sites.** `parseSavedDayColumns` is shared by
  `fromRow` and `toDiscoverDay`; it sorts `dayIndex` stably and repairs
  `dayCount` upward rather than dropping a row.

**Three findings about the process, all sharper than the feature:**

1. **A gate box that names one surface will pass with the other three
   unbuilt.** Link 4's box named the Discover card. The library dialog, the
   shared-day route and the insert dialog — the one that actually performs the
   append — were not built, and a browser walk, not the suite, is what found
   it. **M12 adds reviews and moderation across several surfaces and will ship
   the same way if its boxes name one each.**
2. **Two quality gates cannot see a whole class of defect.** The colour wall
   scans for raw hex, so an **undefined token NAME** passes it clean — a
   pressed chip shipped with a transparent background. And no test layer can
   hold a layout claim: jsdom has no layout and the lint wall refuses
   `toHaveClass`, so a comment asserting *"fits the longest label this can
   produce"* was wrong by 10.19px for two commits, and only a measurement on
   the preview said so.
3. **A scripted edit that cannot fail loudly is a change you have not made.**
   One string fix silently no-opped because its replacement was written without
   asserting it matched, and a second browser walk is what caught it.

### 2026-09-19 — M25's gate closed, and what it leaves the milestones behind it

**14 of 14 boxes**, `pnpm check` green (765 tests) and `test:e2e:ci-like` at
**137 passed**. Two `v1` endpoints, two UI surfaces, **no migration, no
contract change, no entitlement and no plan version** — so it walked into none
of the `premium@v1` pinning problem M22 raised.

**Three boxes were ticked with something named rather than silently**, and the
retro carries each in full: the free-account walk's *"no upgrade prompt on any
screen it touches"* cannot be asserted as written (the trip settings sheet also
hosts M20's correctly-gated *Invite someone*); the oversized-upload refusal is
**400 rather than 413** because the box says 400 and a gate definition is
Mitchell's to change; and the OpenAPI box produced a finding it did not ask
for — see below.

**Three things it leaves live for M23, M24, M13 and M14**, which are the
milestones that each make a trip carry more:

1. **The round trip is a fixed point, and it is now a tripwire.** A field added
   to an activity and not to `toBundleStop` fails `fromTrip.test.ts` **in the
   diff that adds it**. That is the whole reason M25 was placed before those
   four rather than after them, and it is now real rather than intended.
2. **A derived reference can be FALSE rather than merely verbose.** M22's
   strongest property is that `openapi.json` cannot drift from the route
   declarations — which guarantees the document matches the *declaration*, and
   says nothing about whether the declaration matches the endpoint. Declared
   with the whole bundle schema, one endpoint's generated entry was 2,267 lines
   of recursive notebook AST for a section it never writes. **Check what a new
   endpoint's declaration publishes, not just that it publishes.**
3. **The two doors into the content-bundle format stay different.**
   `content:import` derives ids so a re-import updates its own rows; a user
   upload mints them so it can never land on somebody else's trip. Collapsing
   them is a plausible-looking simplification and is the one change that would
   make an upload dangerous.

**M22 and M21 are unchanged by this and both remain open.**

**And a correction that is worth more than the milestone note around it.** Three
places in these docs — this file's M22 row, `TODO.md`, and notes added on
2026-09-18 — said M22's open box *"needs a Vercel preview with
`API_TOKEN_PEPPER` set"*. **That is wrong twice over**, and Mitchell said so on
2026-09-19:

- **`API_TOKEN_PEPPER` is set on every Vercel target** — preview, development
  and production, all three as `sensitive`. Checked, not assumed.
- **`KI-2026-09-16-d` never mentioned that variable.** What it names is
  **`ADMIN_USER_IDS`**, which is injected at *build* time and which
  `playwright.config.ts` supplies only to the local e2e server — so
  `POST /api/admin/grants` answers 404 on a preview and no account reachable
  from a browser can hold `api.tokens` there.

**`ADMIN_USER_IDS` is bound to preview and production — and it was created
2026-09-14, two days BEFORE the walk that got the 404.** So that entry's fix
sketch ("set it in Preview and redeploy") describes a state which already held
when the entry was filed, and is probably wrong. The likely cause is the
variable's **value** rather than its absence — it takes `users.id` verbatim and
fails closed, and a dev-login operator's id is `dev-<username>`. **That is a
hypothesis**: the value is stored encrypted and was not read. The next step is a
read, not a write; the entry carries it. `KI-2026-09-16-d` stays open.

**Why this is recorded at a gate close rather than quietly fixed.** A wrong
variable name in three status files is exactly the drift this file's own
checklist exists to catch, and it survived because each copy was read as
confirmation of the others. The KI was the only document with the fact in it,
and it was the one document nobody re-read.

---

## Phase 3 checklist narrative, compressed out of TODO.md (2026-09-21)

`TODO.md` is the checklist; the detail and the retro live in each milestone's
own file. Nine closed entries had grown narrative summarising what shipped —
22,879 B of a 62KB file, describing work whose durable record is elsewhere.
They are compressed there to a tick, a date and a pointer; the removed text is
below, verbatim, so **nothing was deleted**.


### M11

- [x] **M11 Sharing, invites, and a trip you can hand to someone** —
      **gate closed 2026-08-28**
      → `docs/milestones/M11-sharing-and-invites.md`
      *(**Scheduled 2026-08-27 ahead of M18's remaining surfaces and ahead of
      M16**, by Mitchell's call — the explicit say-so this file's ordering rule
      requires. It **absorbed M13's invites/roles/revocation scope** in the same
      decision; M13 keeps only near-real-time sync and its transport ADR.
      Links 1-6 landed 2026-08-28 via PR #71 with remediation in PR #78
      (users/identity, roles and access, invites, pinned shares,
      clone-with-lineage, saved days); migrations 0006-0010 are dispatched to
      production. **Playbooks/templates — inherited from M7 — was carved out of
      this gate by Mitchell on 2026-08-28 and is its own follow-on**, so the
      four Playbooks `<Preview>` shells stay M11-tagged in
      `preview-registry.ts` with nothing else left in the milestone. Gate
      evidence and retro are in the milestone file.)*

### M11a

- [x] **M11a An invite gate on the front door** — **gate closed 2026-08-31**,
      nine of nine boxes; the three admission paths walked on **production**
      (KI-50 blocks the OAuth round trip on a preview). Gate evidence and retro
      are in the milestone file. →
      `docs/milestones/M11a-invite-gate.md` — **scoped and placed 2026-08-30**,
      then **moved ahead of M17 the same day** on Mitchell's call, so it runs
      first and **before M11b**. **It needs one migration (`invite_codes`), and
      merging does not apply it** — dispatch with
      `gh workflow run migrate-production.yml -f confirm=migrate` from `main`,
      and say so in the PR body.
      *(Created out of M11b's scoping review the same day. M11b publishes
      user-authored text and leaves reporting to M12, which rests on Mitchell's
      call that the platform is invite-gated — and it is not: any Google account
      that reaches `/signin` gets one. Three ways through the gate, all
      evaluated only when there is no `users` row: a pending M11 trip-invite
      token, a reusable **super code**, and **single-use codes** in a new
      `invite_codes` table. Small, because `users` (ADR-025) already records who
      has been here and `recordSignIn` is already a fail-closed boolean — the
      one real problem is that OAuth leaves the site, so the code rides a
      short-lived cookie across the round trip. Needs a migration, and the
      migration needs a dispatch.)*

### M11b

- [x] **M11b Playbooks becomes a public library** — **gate closed 2026-08-31**,
      eleven of eleven; publish → discover → add walked as two actors and the
      `cities` backfill run against production. Gate evidence and retro are in
      the milestone file. →
      `docs/milestones/M11b-playbooks-public-library.md` — **scoped and placed
      2026-08-30**, running after M17 and immediately before M12.
      *(Carved out 2026-08-28 when M11's gate closed: the milestone's file
      said its Playbooks scope stayed, none of its eight exit-gate boxes tested
      it, and none of the six links touched it. It then sat unplaced for two
      days because it had no scope — a product decision. The **2026-08-30
      design handoff** supplied it: `SPEC.md` §15 turns Playbooks into a
      discovery surface over other people's days across four routes —
      `playbooks` (Discover), `day`, `board`, `profile`, three of them new.
      **Mitchell drew the scope line short of reviews**: M11b takes all of §15
      except reviews and ratings, M12 keeps those plus moderation. Eight links,
      from `cities: string[]` and a city search endpoint through publishing, an
      adds ledger keyed by (day, trip), and the four routes. Closes DRIFT's D9
      and deletes the last four M11-tagged `<Preview>` shells. Saved days
      (M11 link 6, ADR-029) is the data model it builds on.)*

### M15

- [x] **M15 Front door** → `docs/milestones/M15-front-door.md`
      *(Gate closed 2026-08-26, PR #56. **Ran ahead of M10's Phase 9 gate and
      M16**, superseding ADR-021/ADR-022's stated ordering — decision 1 in the
      milestone file, reconciled into `docs/milestones/README.md`'s roadmap
      table and Current milestone in this same gate-close commit. Landing
      page, custom sign-in/sign-up (Google + dev-login), Home's empty-state
      first-run moment via the existing `NewTripWizard`'s "Create empty" (the
      designed one-field first-run screen was dropped, decision 3), and the
      header account menu (already shipped in M10 Phase 8b). Both open
      questions resolved: no separate first-run screen, and the landing copy
      ships verbatim selling M11/M12. M10's Phase 9 gate closed after this, on
      2026-08-27; **M18** is the next work.)*

### M20

- [x] **M20 An account knows what it may do** — **gate closed 2026-09-14**, 32 of
      32 live boxes, one amended out 2026-09-02. Built as #174 and #175, migrations
      0019 and 0020 dispatched to production the same day (`migrate-production` run
      20), the console walked on production and the account surfaces on a preview.
      Retro in the milestone file →
      `docs/milestones/M20-account-tiers-and-entitlements.md`
      *(**Minted, scoped and placed 2026-09-01** — the **first commercial
      milestone**: nothing in the repo had ever described a paid tier, a plan,
      a price or a payment. Placed after M9 because `ai-live` defaults off and
      M9's grounding is what would let it be turned on — selling a dark
      feature was the reason not to place it sooner. Mostly wiring a seam
      built for it and stubbed since M16: `modelSelection.ts:88` declares
      `AiEntitlementCheck`, `:89` stubs it `EVERYONE_IS_ENTITLED`, and `:47`
      says *"the day a pro-tier check exists it lands inside `isEntitled`
      below, not as a signature change"*. Nine links, the ninth added 2026-09-01 for the
      financial metrics: an **`ai_usage` cost ledger** storing tokens and
      models, never dollars (prices move, and `Money`'s integer minor units
      round a $0.0011 request to zero cents), moved out of M21 because both
      milestones' pricing decisions are guesses without it. **Plan contents are versioned data, not
      code** (2026-09-01) — plan versions are immutable and append-only, a
      purchase pins a version, and changing a price publishes a new one rather
      than rewriting what anyone was sold. ~~Prices become tweakable without a
      deploy~~ — **amended 2026-09-02, see the design note below.** **A plan is a set, not
      a rank** — Mitchell's requirement is that tiers are "not necessarily
      subsets", so copying `accessPolicy.ts:11`'s `RANK` is the obvious move
      and the wrong one. Trials, referral rewards and admin boosts collapse
      into **one time-bounded grant with three `source` values**. Free keeps
      trip planning entire; AI and inviting collaborators are paid. **Takes no
      money** — the admin grant UI is what proves it without Stripe. Two
      decisions by Mitchell the day it was scoped: plans are
      `free | plus | premium` and **defined by enumeration, never by
      extension** (the ladder is presentation only — nothing in code may know
      the three nest); on lapse granted memberships **cap at `viewer` on
      read**, never written to `trip_memberships`; existing accounts get a
      permanent `founder` grant; the **trial grants `plus` at signup**; and a
      **referral earns one month of the tier the referrer already holds**, so
      a free account earns nothing. **Link 5 carries the cost
      arithmetic**, against the models actually configured
      (`deepseek/deepseek-v4-flash-0731`, `zai/glm-4.7-flash`) rather than
      `config.ts`'s compiled Haiku default, which is not what runs: one live
      request cost ~$0.001 and a fully-maxed account lands at ~$3-25/month,
      so the ceilings are an abuse bound rather than a margin problem. Needs a migration, and an **ADR is a prerequisite** — it adds an
      Entitlements module to `AGENTS.md`'s structural-law map.)*
      *(**Design landed 2026-09-02** — `.design-sync/handoff/SPEC.md` §17,
      `DRIFT.md` §2c. Two of its four surfaces are this milestone's: the
      operator console (§17.2) and the collaboration gate in Trip settings
      (§17.3). **It cost the milestone scope, by Mitchell's decision the same
      day**: plan versions become a **static file committed to the repo**, not
      a `plan_versions` table, and the admin UI is **read-only over plans** —
      it shows what is currently live. Publishing leaves the UI and **a price
      change now costs a deploy**, which is the property the 2026-09-01
      requirement was written to avoid, accepted on the record. **Migrating
      accounts onto a newer version is not built at all** and its exit-gate box
      is amended out; entitlement-typo validation moves from publish time to
      **compile time**, which is earlier and harder to bypass. **Granting is
      untouched and stays** — it is account state, not plan definition, and it
      is what proves this milestone without Stripe. Also recorded in the file:
      the console the design draws is **half M21's** — its MRR/ARPU/margin
      strip must not be built inside M20.)*

### M21

- [x] **M21 An account can pay for itself** — **gate closed 2026-09-19, 17 of
      17**, the last six boxes **on Mitchell's attestation** that he walked them
      and they worked — not walked by an agent, and no network log or Test Clock
      evidence is recorded. Two of the six carry a caveat in the file (box 1's
      "new price" has no differently-priced version on `main`,
      `KI-20260919-e`; box 2's `premium@v1` clause). Retro in the milestone file.
      (Was current from 2026-09-14; paused 2026-09-16 → 2026-09-19 by
      Mitchell's decision to run M22 first.) →
      `docs/milestones/M21-subscriptions-and-billing.md`
      *(**All four phases written 2026-09-14/15** on `claude/keen-darwin-qkkq41`:
      the subscription table and priced plan versions, hosted checkout and the
      webhook, the `plans` route and the account sheet's billing surface, and
      the revenue half of the console. **Nine of seventeen gate boxes ticked
      with evidence**; what is left needs a real Stripe test-mode key, which no
      lane here has. **None of that costs money** —
      `docs/guidelines/billing-without-spending-money.md` is the recipe,
      including Test Clocks for the three-day grace window. **ADR-047** carries
      the three one-way decisions: Billing is its own module, the webhook is its
      sole writer, and a lapse is a derivation rather than a write. Migration
      `0021` is applied locally **and dispatched to production** — verified
      against the database 2026-09-16, not against this file. The
      milestone file's *What was built* lists five deviations from its own
      scope, each with its reason — the largest being that the price went onto
      the v1 plan entries rather than onto new versions, because naming a price
      for the first time is not editing one.)*
      *(**Minted, scoped and placed 2026-09-01**, immediately after M20.
      Stripe checkout, the webhook that is the **sole writer** of subscription
      state, the customer portal, failed payments. **Adds no entitlement and
      no gate** — if its diff touches `modelSelection.ts`, `quota.ts` or
      `members.ts`, the split has failed. Split from M20 because M20 is
      provable with no external service and this is not, because a hand-grant
      path is permanent infrastructure rather than scaffolding, and because
      the blast radius here is money. ~~**One decision is Mitchell's before it
      opens: the plans and their prices**~~ — **decided 2026-09-13: `free` $0,
      `plus` $9/month, `premium` $19/month.** M20 named the plans without
      pricing them; the numbers live in `M21-subscriptions-and-billing.md`
      under *Prerequisites* and **must not appear in M20's diff**. Also carries the `/ask` step-metering fix
      (`handleAskRequest.ts:306` charges `aiQuotas()` but never
      `aiStepQuotas()` or `settleAiSteps`), without which AI cannot be
      priced.)*
      *(**Design landed 2026-09-02** — `SPEC.md` §17.1 and §17.4 are this
      milestone's: pricing on the landing page, and plan + usage as a **Plan
      section at the top of the account sheet** (not a route). §17.4 widens
      link 5 with two usage meters, past-due copy that names the loss before
      it happens, and a referral row reading M20 link 8's data. **One
      designed surface is owned by no link in either milestone**: the pricing
      section and its `#pricing` anchor — M20 forbids a price string in its
      diff, and none of the seven links here is unauthenticated. **Mitchell
      ruled 2026-09-02 that it is not M21's either — "own it somewhere else" —
      and where is still open, so it currently has no owner.** Two constraints
      on its home: it may name a price, so it sits at or after M21 or ships
      priceless; and the landing page itself shipped in M15, so it is a section
      on a real route rather than a new surface.)*
      *(**Also amended 2026-09-02, following M20**: link 2's price fields land
      on a committed file entry rather than a `plan_versions` row, and **link
      2's migrate action no longer exists** — nothing in either milestone moves
      an existing subscriber onto a newer version. What you bought is what you
      get, now with no mechanism to change it.)*

### M22

- [x] **M22 An account can build on the API** — **gate closed 2026-09-19, 19
      of 19**, the last box (the preview walk) **on Mitchell's attestation** that
      he walked it and it worked — not walked by an agent. `KI-20260916-d` stays
      open: it is the general problem, not this box. Retro in the milestone file.
      (Was the current milestone from 2026-09-16, **by Mitchell's decision
      rather than by a gate closing** — M21 is open at 11/17 and paused;
      **paused in turn 2026-09-18 when M25 became current**, its one open box
      being a preview walk blocked on a deployment, `KI-20260916-d`) →
      `docs/milestones/M22-public-api-and-tokens.md`
      *(**Placed 2026-09-16 by Mitchell — runs after M21, before M12.**
      *"Im fine making it after M21."* A public REST API and account-generated
      API tokens, scoped to the account or to named trips, with create and
      revoke. Design: `docs/specs/2026-09-16-public-rest-api-and-scoped-tokens-design.md`.
      **Scoped 2026-09-16, and nothing is open** — the decision that held the
      file back (the shape of the planning-write surface) was answered the same
      day as thirteen REST endpoints, and the last flagged item closed with
      *"Just do v2 then"*, so `api.tokens` ships on **`premium@v2`**. The
      milestone file carries five phases and a 19-box exit gate; **all five phases landed 2026-09-16 and 18 of 19 boxes are ticked**. The one open box needs a browser walk on a Vercel preview, and `KI-20260916-d` is what blocks it: **`ADMIN_USER_IDS`**, so no account reachable from a browser can hold `api.tokens` there. *(This line said `API_TOKEN_PEPPER` until 2026-09-19 and was wrong in a way that cost a session: that variable is set on all three Vercel targets, and the KI it cited never mentioned it.)*
      **Three boundaries fixed by Mitchell at placement**: user accounts only,
      **no admin surface**, **no AI surface** — so a token can never spend model
      budget, and the AI quota and entitlement paths need no change at all.
      **Its entitlement is decided: `premium` grants a new `api.tokens`, and it
      gates both minting a token and using one** — *"lets lock creating and
      using API keys behind top tier for now"*. Recorded as a named plan and
      never as a tier height, because ADR-045 rule 4 forbids plan ordering and
      `planVersions.noExtension.test.ts` enforces it. That publishes
      **`premium@v2`**, which raises the one question the placement left open:
      a `premium@v1` subscriber is pinned to v1 forever and **there is
      deliberately no mechanism to move them** (see M21's 2026-09-02 amendment
      directly above), so they never get API tokens unless issued an admin grant
      of `premium@v2` — which needs no new machinery, since entitlements are the
      union of the held version and every grant's pinned version. **The cohort
      needing that grows for as long as M21 sells `premium@v1` before M22
      lands**, so it is worth settling before M21 goes live.
      The design's own claim to test at the gate: adding endpoint N+1 costs a
      declaration and nothing else — no auth, validation, error, pagination,
      docs or client work — because `src/app/api/v1/**` is the registry and one
      `route()` wrapper owns everything cross-cutting.)*

### M25

- [x] **M25 A trip is a file you can take with you** — **DONE, gate closed
      2026-09-19**, 14 of 14 boxes, three of them ticked with something named
      rather than silently (the free-account walk's caveat, 400 over 413, and
      the OpenAPI narrowing the box did not ask for). `pnpm check` green — 765
      tests — and `test:e2e:ci-like` **137 passed**. Two `v1` endpoints, two UI
      surfaces, no migration, no contract change, no entitlement, no plan
      version. Retro and gate evidence:
      `docs/milestones/M25-a-trip-is-a-file.md`
      *(**Minted and placed 2026-09-18 by Mitchell**, running immediately after
      M22 — small, and it reuses M22's route wrapper while that machinery is
      fresh. Trip **export and import** as JSON. **The format is
      `travel-collab/content-bundle/v1` and a third format is not created**:
      the bundle already has a schema, a CI-enforced linter, pure converters
      and a real importer, so round-trip is a gate box a test can hold, and it
      is the shape a person can hand-author — which is what *"similar to the
      api"* was asking for. A dedicated export format would be a **third
      vocabulary over the same data**, which is the drift invariant 5 exists to
      stop. **An export is a SNAPSHOT, never the event log** — the log is
      `tripId`-bound and re-importing it would violate ADR-028's id-remap rule,
      the same hazard `cloneTrip` exists to handle, so an exported trip loses
      its history. **Export is FREE** (Mitchell, 2026-09-18): *"free keeps trip
      planning entire"* is the M20 row in `docs/milestones/README.md`, and
      portability is a trust property, so it needs **no new entitlement**,
      hence no new plan version, hence it does
      not walk into the `premium@v1` pinning problem M22 raised. Import is the
      larger half — a user upload must **mint fresh ids**, where the content
      script derives them from keys so a re-import updates rows instead.
      **Three scoping questions were decided 2026-09-18.** **What it
      carries: days and activities, nothing else** — no budget, no
      members, invites or share links, no notebook pages, no lineage or
      trip status. That is a scope line, not a gap, and it buys a
      property worth naming: an export cannot carry a copy of a
      membership list out of the system. It also means an export is a
      copy of the plan and **not a backup**. **Linting: the schema
      validates an upload and the content rules do not run on it** —
      `lint.ts` states rules for authored library content headed for
      Discover, and three are errors a real trip trips routinely (an
      empty trip, stops out of clock order after an ordinary board
      reorder, a backlog item with a time window), so running it would
      reject real trips on day one. No subset and no second rule set;
      revisit if a real problem emerges. **Dates: a dated trip exports
      its real `startDate`, never `startsInDays`**, and a **dateless**
      trip carries neither anchor —
      *"we just have offsets, day 1, not January 15th"*. `BundleDay`
      already has no date field, so the trip anchor relaxes from
      *exactly one* to *at most one*. The export is a copy of **your**
      trip rather than a re-usable shape, so a stale export importing as
      a *past* trip is the correct answer, not a defect to design
      around. The dateless half is not a one-liner: `tripStartDate`'s
      `?? 0` currently resolves a missing anchor to *starting today*, so
      relaxing the refine alone would make a dateless trip silently
      dated. **Nothing on this milestone is waiting on a decision.**)*

### M23

- [x] **M23 A playbook can be more than one day** — **SHIPPED 2026-09-19**
      (#192, merged as `7763913`; gate 11/11; migration `0024` dispatched and
      production verified at 25/25) →
      `docs/milestones/M23-multi-day-playbooks.md`
      *(**Minted and placed 2026-09-18 by Mitchell**, running **before M12** —
      and that placement is the whole point: M12 keys reviews, ratings,
      reporting and moderation to a `saved_days` row, and this changes that
      row's shape. After M12 means M12's work is revisited.
      **A saved day GENERALISES into a saved sequence; it is the same object,
      not a new one.** The rejected alternative was a separate "collection"
      object over saved-day rows — rejected because a second publishable object
      either doubles M12's trust-and-safety surface or ships a library with two
      classes of content having different moderation properties.
      **The shape is a flat `stops[]` with a per-stop day indicator, not
      `days: SavedStop[][]`** — Mitchell's call, and his reason is migration:
      existing rows read as "everything on day 1" when the indicator defaults,
      so the strict `SavedStop.array()` parse at the read boundary keeps working
      with no versioned read. **That property has a precondition the scoping
      found**: the strict parse exists at **two** sites (`savedDays.ts`'s
      `fromRow` and `playbooks.ts`'s `toDiscoverDay`) and `SavedStop` carries
      **no `.default()` on any field** — so the additive claim holds only if the
      indicator lands defaulted, at both sites. See `KI-2026-09-05-l`.
      **One insert primitive, three callers** — add to an existing trip, start a
      new trip from one day, start a new trip from N days — wrapped in M6's
      atomic command group. That **absorbed and answered** the unscheduled
      candidate *"Start a new trip from a saved day"*, whose open question was
      whether it reuses the fork path or gets its own: **it reuses it**, and the
      entry was deleted on 2026-09-19 when link 3 landed. Found while building
      it: the third caller already EXISTED — `AddToTripDialog`'s "Start a new
      trip" creates the trip and then calls `insertSavedDay`, so the shared
      primitive was already shared and only needed to learn N days.
      `insertCommands.contract.test.ts` now fails if a second construction
      appears.)*

