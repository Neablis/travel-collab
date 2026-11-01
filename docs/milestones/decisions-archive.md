# Milestone decision archive

Every dated decision note whose milestones have all closed their gates, moved
here verbatim and in order on 2026-09-21 (and two more on 2026-09-30, and eight
more on 2026-10-11, and six more on 2026-11-01, filed in date order). Nothing was reworded and nothing was
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

### 2026-09-01 — milestone audit

`docs/reviews/2026-09-01-milestone-audit.md` checked every remaining milestone
against `main` at `dd61c44`. What it found:

- **M9 is no longer the milestone its file described**, and it has been
  retitled accordingly (**"The assistant cites what it plans"**). Four of seven
  scope items and three of six gate boxes are already satisfied by shipped
  code. What remains is grounding, conversation durability and an eval harness.
- **ADR-022's two stated grounds for placing M9 last have both been met** —
  "UI polish first" (M10, 2026-08-27) and "sharing first" (M11/M11a/M11b, all
  closed). The placement has not been re-examined since those lapsed.
- **`ai-live` defaults to false and grounding is what would let it be turned
  on**, so the largest built feature in the product is dark for as long as M9
  waits.
- **M12, M13 and M14 have no milestone file and no exit gate**, against this
  file's own rule that each gets one "before work on it begins". M9 and M19 are
  scoped today; three of the next four are not.

**All four findings are now acted on.** The reorder is above. M12, M13 and M14
were scoped the same day and have files and exit gates
(`M12-reviews-and-moderation.md`, `M13-collaboration.md`, `M14-rich-layer.md`),
so no milestone in the order is unscoped except M19, which is deliberately
*placed but not scoped* pending its link-1 design question. The nine orphan AI
known issues are assigned to M9, three of them as gate boxes.
`map-legend-modes` was retagged off M9.

**M19 was placed last on 2026-08-31** ("just put at end for now" — Mitchell),
the same day it was minted. Last is a real position here, not a shrug: M19's
third link (who an activity is for) overlaps **M13**'s `add-stop-who`, and
running after M13 means M13 can land that field and M19 build the splits on it,
rather than the two racing to add a per-stop person field. If the order changes
so M19 runs first, that link has to be reassigned rather than duplicated.

**M11a and M11b each need a migration, and neither must be merged without a
dispatch** — `gh workflow run migrate-production.yml -f confirm=migrate`, from
`main`. M17 keeps its own migration for whenever it is picked up; its re-scope
(2026-08-29) already removed the `users` table and the identity decision, so
what remains is the preferences half.

### 2026-09-01 — reorder: M9 moves from last to second, by Mitchell's decision

**Mitchell's call, 2026-09-01**, on the audit below: *"reorder as you see fit."*
**New execution order: `M17 → M9 → M12 → M13 → M14 → M19`.** Milestone numbers
are unchanged — this is a placement, the same shape as ADR-018, ADR-021 and
ADR-022.

**What it supersedes.** ADR-022 (2026-08-25) moved M9 to last, after M14, on two
stated grounds: the data layer beneath a planning partner should exist first,
and UI polish and sharing come before it. **Both have since been met** — M10's
Wave-2 gate (2026-08-27) for polish; M11, M11a and M11b (all closed) for
sharing; M18, M18b and M16 for the data layer and the read agent. ADR-022's
reasoning is not overturned, it is **spent**: the conditions it named have
happened.

**Why second rather than first.** M17 stays ahead of M9 because it is already
the current milestone and is small, and because M14's insert picker needs its
account-scope fields. Nothing in M9 reads a preference.

**Why not later.** `ai-live` defaults to false and the assistant is built and
dark; grounding is what would let it be turned on. Every milestone placed ahead
of M9 extends that. M9 is also now the **smallest** of the four remaining
non-M17 milestones and the only one that was scoped before this session.

**M19 keeps its place last, unchanged.** Its link 3 (who an activity is for)
overlaps M13's `add-stop-who`, and running after M13 is what stops both from
adding the same field.

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

### 2026-09-10 — M9 opens with Phase 0, the assistant kernel

**Mitchell's call, 2026-09-10**, opening KI-2026-09-05-t: *"Lets take on
refactoring it, and the entire AI Ask system."* Chosen from three placements
offered; the two declined were finishing M17 first, and writing the design
record now and building after M17.

**Why ahead of M17.** The KI's own argument, which M9's estimate already
assumes: `handleAskRequest()` being one 455-line function is a *schedule
multiplier* on every M9 task, and ~15 of the 40 open known issues are
consequences of the same untyped boundaries. Doing M9's three real pieces of
work against that shape pays the multiplier three times.

**As decided, this paused M17 at "0 of 3 gate boxes". That reading was wrong,
and the note above is why** — M17's boxes had been satisfiable since PR #112
merged on 2026-09-02, and its gate closed on 2026-09-11 without Phase 0 giving
anything back. So the interposition cost M17 nothing: it displaced a marker,
not any work. Recorded rather than quietly corrected, because "pausing" a
milestone that was already finishable is the same drift the 2026-09-11 note
above measures, arrived at from the other direction — that note found a marker
reporting work that was done, and this one set a marker against it.

**What it is not.** It closes no gate box, of M9's or anyone's. Entitlement
policy and the `ai_usage` cost ledger stay **M20's**, under the four rules
decided 2026-09-01 — Phase 0 builds the ports those rules fill and chooses no
tier, ceiling or price. Decision: **ADR-043**. Design:
`docs/specs/2026-09-10-assistant-kernel-design.md`.

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

### 2026-09-13 — reorder: M20 and M21 run next, ahead of M9's remaining work

**Mitchell's call, 2026-09-13**, asked for directly — *"start the milestone that
creates the stripe work and ability to pay for the app."* **New execution order:
`M17 ✓ → M9 [Phase 0 ✓, paused] → M20 → M21 → M12 → M13 → M14 → M19`.**
Milestone numbers are unchanged; this is a placement, the same shape as ADR-018,
ADR-021, ADR-022 and the two reorders below. M19 stays last regardless.

**This supersedes one stated prerequisite, and that is the whole of the cost.**
`M20-account-tiers-and-entitlements.md` lists *"**M9, and it must be closed.**
Not a code dependency — a product one"*, and the 2026-09-01 placement note below
gives the reason: `ai-live` defaults off, M9's grounding is what would let it be
turned on, and **selling access to a dark feature is what running M20 first
means**. That argument has not been refuted — it has been **accepted and
outweighed**, and it is recorded here rather than quietly dropped so that
whoever writes M20's retro knows the trade was deliberate.

Three consequences to hold, each with its mitigation:

1. ~~**The AI tier ships dark.**~~ **VOID, 2026-09-13** — decided the same day,
   later the same session: **`ai-live` will be on in production before release**,
   and the flag is kept as an **emergency disable** rather than removed
   (ADR-019's 2026-09-13 amendment). So an account that buys `plus` gets a real
   assistant, and the largest cost this reorder carried is not paid at all. Two
   things the amendment settles rather than leaves implied: the fallthrough
   itself flips (not a widening rule), because a kill switch that requires
   knowing what rules exist is not one; and **the flip must come after M20's
   entitlement gate is live in production**, since `selectAiModel` checks
   entitlement *before* the flag and that check is what replaces the fallthrough
   as the spend control. **What remains true is narrower and worth keeping:**
   the assistant will be live but **ungrounded** until M9, since grounding is
   M9's work. That is a product judgement, not a blocker.
2. **The pricing decision loses the volume evidence M9 would have produced.**
   M21's prerequisites argue that setting prices after M9 is right *"because of
   evidence, not arithmetic"* — Vercel held exactly one `ai.ask` record across
   seven days. **Mitigation: the arithmetic is sufficient at this size and the
   same file says so** — a ceiling-consuming account costs ~$2-$14/month against
   the models actually configured, so any plausible price clears it. **The
   prices were decided the same day** (see below), which closes M21's one owed
   decision rather than deferring it.
3. **M9's remaining work ages.** Its twelve open AI known issues stay open
   longer. **Mitigation: none needed — they are known issues, they are assigned
   to M9, and M9 keeps its place immediately after M21** rather than returning
   to the back of the queue where ADR-022 had put it.

**Why the pair and not M21 alone.** M21 was what was asked for, and M21 cannot
open: its prerequisites are *"**M20, and it must be closed.** Every entitlement,
every gate and the resolver this milestone drives are M20's. There is nothing
here to build without them"*, plus M20 link 9's cost ledger, which link 7's
revenue comparison has nothing to compare against without. "The ability to pay
for the app" is both milestones — M20 builds what a subscription grants, M21
makes it real — so both are placed, in that order, and M20 is the one that
opens.

**Mitchell's second decision the same day: the prices.** `free` $0, `plus` $9 a
month, `premium` $19 a month — M21's one owed decision, recorded in
`M21-subscriptions-and-billing.md` under *Prerequisites*. **It is recorded in
M21's file and nowhere in M20's**, because M20's *Deliberately not here* is
explicit that *"if a price string appears in this milestone's diff, the split has
failed"* — a rule this note is subject to as well, which is why the numbers are
here as a decision record and are not to be copied into M20's plan, contracts,
or plan-version file. M20 publishes versions that are free by construction; M21
link 2 adds `price_minor`, `currency` and `stripe_price_id` to the same entries.

**The prerequisite ADR is written and accepted: ADR-045** (*Entitlements is a
module with two stores*). M20's prerequisites require it *"before the milestone
opens — not written mid-build"*, and `AGENTS.md`'s module map now carries the
**Entitlements** row it adds. That was the first act of this reorder, ahead of
any plan.

**Two more decisions the same day, both closing questions the kickoff plan
opened.** Neither changes the placement; both change what gets built.

1. **The grace window is 3 days**, from the decline rather than the period end
   (M21 link 6). It is deliberately **shorter than Stripe's own retry
   schedule**, so an account lapses while Stripe is still retrying and a later
   successful retry restores it through the ordinary webhook path.
2. **The `plus` trial is one time ever per account** — not per subscription and
   not per lapse. **This one is M20's to build, not M21's**, because the trial
   is a grant issued at signup, and it carries a schema requirement that is
   easy to violate by being tidy: **an expired or revoked trial grant is never
   deleted**, since eligibility is *"has this account ever held one"*. A
   cleanup job over `entitlement_grants` silently returns the trial to everyone
   who ever had one. M20's trial gate box is **amended** to require it, which
   is a gate change and is therefore recorded here as Mitchell's decision, per
   this file's own rule.

**What was NOT decided here.** The landing page's pricing section (`SPEC.md`
§17.1) still has no owner — Mitchell ruled on 2026-09-02 that it is neither
M20's nor M21's, and `TODO.md`'s Candidate ideas says to revisit it *"when M21
opens"*. M21 is placed, not open. It stays parked, and M21's *An unowned
surface* section remains the single copy of what it owes.

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

### 2026-09-18 — three milestones minted, M13 moved ahead of M12, two prerequisites placed

**Mitchell brought five feature ideas and one tooling idea to a design conversation
and placed all of them the same day.** Nothing here was built; this note records
what was decided so the next session does not re-derive it. Two of the five were
already scoped elsewhere and did not need a milestone.

**Minted: M23, M24 and M25**, each with a file, a scope and an exit gate before
any commit — the standing task this file requires. Their rows are in the Phase 3
table above and carry the decisions in full; the one-line versions:

- **M23 — a playbook can be more than one day.** A saved day *generalises* into a
  saved sequence rather than gaining a sibling object type.
- **M24 — a leg knows where it goes and by what.** Transport mode and a second
  location on a travel stop.
- **M25 — a trip is a file you can take with you.** Export and import, emitting
  the content-bundle format rather than a third vocabulary. Export is free.

**M13 moves ahead of M12.** M13's own file already said it sat after M12
*"because M12 is smaller and finishes a surface that is already live, **not**
because of a dependency"* — so the move costs nothing and buys three things: link
3's re-prediction reducer closes **KI-5, KI-90 and KI-77**, which are
single-player data-loss defects live in the app today and not realtime work at
all; link 5 lands *who a stop is for*, which **M19 link 3 and M14's two cut
person widgets both wait on**; and the transport ADR stops blocking. **M23 still
runs before both**, for the reason in its row.

**Realtime was the one requested feature that needed nothing**: it is M13 links 1
and 2, already scoped. One correction was made in the conversation and is worth
keeping — *"websockets"* is not a decided transport. M13 link 1 is explicitly
*"Server-Sent Events, WebSockets, or polling with a cursor — decided against this
project's actual constraints"*, and on Vercel's serverless runtime a long-lived
WebSocket needs a service this project does not run. The ADR decides; the word in
the request does not.

**Two pieces of non-milestone work are placed inside the order, and both are
prerequisites rather than deliverables:**

1. **The activity-field descriptor refactor — `KI-20260905-o` — runs once, before
   M13.** Three milestones each add a field to an activity (M13 link 5's `who`,
   M24's `mode` and `endLocation`, M19 link 1's cost kind), and today **21
   non-test files hand-enumerate activity fields with nothing going red when one
   is missed**. The class has already bitten three times (KI-1, KI-54, and M18's
   editor sheet dropping `kind`/`tags`). Paid once, the three milestones are
   cheap; paid three times, it is three chances to miss a site. **It was already
   scheduled once** — 2026-08-29, as *"one overnight batch"*, in the placement
   note further down this file — **and it did not happen**, which is why M13's
   gate now carries a box for it instead of this file carrying a second promise.
2. **An architecture map that is generated, drift-checked and annotated at gate
   close.** Designed 2026-09-18 and approved in principle;
   `docs/specs/2026-09-18-architecture-map-and-drift-audit-design.md` holds it,
   and `TODO.md`'s Candidate ideas carries the summary. It is repo automation in
   the sense of `AGENTS.md`'s *Repo automation* section, not roadmap work, which
   is why it has no milestone number. **It proposes a sixth step for the
   gate-close checklist at the top of this file** — the annotation layer is
   written at gate close, with the milestone's context live, rather than
   reconstructed cold later. That proposal is not adopted here; adopting it is a
   decision, and the checklist has already grown once for exactly this reason.

**Two asks resolved into existing milestones without a new one, and that is
recorded rather than assumed:**

- **More widgets and better widget filtering are M14** — items H, E, B, G and
  link 3. *Saving a notebook as a template for a future trip* was **not** in M14
  or anywhere else (link 7 seeds templates; nothing lets a person keep their
  own), so it is **M14's new link 10**, built on ADR-029's saved-day shape rather
  than a second personal-library pattern. M14's file carries both.
- **Starting a trip from a saved day** and **transport mode per leg** were
  unscheduled candidates in `TODO.md` with an open design question each. Both
  questions are answered in the milestones that absorbed them, and both entries
  are annotated in place and deleted at those gates.

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

### 2026-09-19 (later) — minted, scoped and placed: M26, design parity

**Opened by Mitchell**, asking that the build be brought back to the design and
naming four things: Playbooks' shared trips looking nothing like the designs,
account settings becoming its own page, filters and tabs re-imagined to improve
search, and a hover state on the Map view's days. The instruction was also
broader than the four — *"go over the design and really try to match the
designs, especially supporting both the desktop and mobile version"* — so the
scoping ran **five read-only surveys** over the whole handoff against the
working tree rather than costing the four items alone.

**Why it is a milestone and not a sweep.** No milestone has owned this question
since M10's Wave-2 gate closed on 2026-08-27, and that gate was honest that it
closed a delta against *the handoff generation available at the time*. The
handoff has moved fourteen commits since — **seven of them in the eight days to
2026-09-19** — while the build ran five commercial and infrastructure
milestones, three of which had no design surface at all until the design drew
them. The two sides did not diverge through carelessness; for three weeks it was
nobody's job to make them agree, and the design kept working.

**Three things the scoping found that change what a planner should expect.**

- **The phone is the larger half, and three places in this repo have been
  waiting for it.** `docs/guidelines/design-system.md` has said layout below
  1024px is best-effort *"until the mobile milestone"* since M5; `KI-046` says
  *"building that is a milestone, not a fix"*; `TODO.md:1030-1037` says
  *"placing the phone is a milestone-sized decision"*. Four phone surfaces are
  genuinely built to spec — the route-derived tab bar, the Ask pill, the Map day
  strip and the Notebook's push/bind/insert sheets — and **everything else a
  phone can reach is the desktop layout reflowed.**
- **`DRIFT.md` is stale in the build's favour in six places**, which nobody
  would guess from reading it: it lists eleven `<Preview>`-shelled surfaces and
  there are **six**; it calls two wizard shells *"honestly orphaned"* and both
  were built on 2026-09-16; `w-open` is shipped; the widget catalogue is 13
  primitives and 20 presets, not 7. **Fifteen places in total where the build is
  right and the handoff is behind** — and the milestone's job there is to amend
  the handoff in the same PR, not to regress the code.
- **`DRIFT` D12 is not blocked and has never been.** It reads as *"design is
  ahead by one control"*; the survey checked every layer and the field, the
  wrapper, the per-call check and **the widening refusal are all shipped and
  enforced**. The entire gap is one hardcoded `null` in a POST body.

**It opens with a preflight, and the preflight is the part to defend if the
milestone gets squeezed.** `KI-2026-09-14-c` already measured the cost of
building from this handoff without it — four review rounds and three wrong
builds, for **one** screen — and already named the five aids. This milestone
builds around twenty screens from the same handoff.

**Nine open questions were recorded in the file and deliberately not answered
there**, because each is a decision rather than a task. **Mitchell answered the
two that gated work on 2026-09-19, the same day:**

- **The Map rail gets its hover card** — *"if you want more info you can move
  your mouse over and hover or move your mouse out to see the ui witout the
  hover."* Detail on demand rather than a second way to select a day. On that
  reading the build's no-hover-tint rule and the design's card turn out to be
  **compatible**: the design tints the row on **focus only** and raises the card
  beside it, so the test defending the rule stays green and nothing is deleted.
  What looked like the milestone's one reversal is not one.
- **Where the phone edits is sequenced rather than blocked** — *"Phone edit is
  right after."* Link 13 runs **last in Wave 2**, so the design answer is owed
  against a phone that otherwise works instead of against a hypothesis, and **no
  link in the milestone is blocked on a pending decision.** What it does not yet
  settle is the substance: a phone treatment of Plan, or an amendment to §10
  saying a phone can render day columns after all.

The other seven — sign out's home, an account-level currency, the day chip rail
on Map, the trip status badge, inferring *on foot* from `kind === "transit"`,
`lastUsedAt`, and whether Duplicate clears dates for a shared-trip clone — can
all be answered as their links come up.

**Two known issues were filed by the scoping** and are both scoped as link 8:
`KI-2026-09-19-f` (an accent reaches MapLibre through `getComputedStyle`, the
documented non-fix — correct today only because the tokens happen to be hex) and
`KI-2026-09-19-g` (the colour wall passes an **undefined token name**, which is
how M23 shipped a transparent chip).

### 2026-10-05 — minted: M35, built before it was minted

**Mitchell's call, 2026-10-05:** *"Create and add a milestone so this work is tracked
correctly."* The travellers and People work was specced, approved (D1–D11) and built T1–T9 on one
branch, PR #335, **while M34 was current and with no milestone placing it**. That is building
ahead of the current milestone, and this note records it rather than back-dating a placement.
M35 is minted to give the work a gate. Its row goes after M34 in `TODO.md`, so M34 stays current
and `pnpm milestone close M34` reads M35 as the next milestone from the row order.

**Mitchell also decided not to restack the branch.** The plan's A/B/C split (data and server,
costs, the People panel) stays as a review order, and #335 is reviewed and merged as one PR.
Scope and gate: `docs/milestones/M35-travellers-and-people.md`.

### 2026-10-06 — minted and placed: M36, the operator console, started ahead of M34's close

**Mitchell's call, 2026-10-06:** *"I added a design handoff to redo the admin/operator dashboard.
Create a new milestone … then start on that milestone, it will be the next milestone."* M36 is
**placed immediately after M34**, so its `TODO.md` row sits above M35's and `pnpm milestone close
M34` will make it current. **M35 moves one row down**: it is built and merged, and what is left of
its gate (the eval re-run, CodeRabbit, the 0039 dispatch, the retro) does not need it to be
current.

**It is started before M34 closes**, which is building ahead of the current milestone. M34 has
two boxes open, the preview walk and the retro, both Mitchell's or the gate-closer's; nothing in
M36 touches the add-stop sheet. Recorded here rather than back-dated.

### 2026-10-06 — M34, M9 and M36 closed on Mitchell's production word; M29 and M30 get their rows; TODO.md trimmed

**Mitchell, 2026-10-06:** *"close out M9 for good and M34, ive testing those in production and
they work … dont do any walk through or checking of boxes that involve confirm its working, i
already did those"*. Both gates were closed on that attestation; nothing was re-walked.

- **M34** closed 7 of 7 through `pnpm milestone close M34`, which made **M36** current.
- **M9** closed 10 of 10 by hand, because the script skips a PAUSED row. It is **closed, not
  paused**: its row is ticked, which also settles the `pnpm milestones` disagreement between it
  and the Phase 0 row. Two boxes asked for an artefact in the file (a real call's `meta`, a
  recorded transcript) and are ticked by decision; the retro names them.
- **M29 and M30** had closed on 2026-10-04 with no `TODO.md` row, so `pnpm milestones` showed
  them as unknown. Each now has a ticked row, and this table's entries say closed.
- **M36** closed 13 of 13 the same day, on Mitchell's *"im done with admin dashboard, works"*,
  through `pnpm milestone close M36`, which made **M35** current: the last unticked row.
- **`TODO.md` was at 87% of its surface budget**, so the closed rows were collapsed to title, date
  and file (`docs/retros/2026-10-06-retired-rules.md` holds the old text verbatim).

### 2026-10-06 — M35 closed; M37 is current

**Mitchell, 2026-10-06:** *"Let's start the next milestone, close out the previous by confirming
the migration run, and checking the boxes"*. M35 closed 12 of 12 through `pnpm milestone close
M35`, which made **M37** current.
- **Migration `0039` was confirmed from the run, not from `pnpm state`.** `migrate-production`
  run #37 on `498530c` logged "migrations applied successfully!". `pnpm state` cannot list runs
  without `gh`, so in a cloud session it read a 2026-09-27 run and reported `0039` unapplied.
- **CodeRabbit had nothing to work.** It skipped #335 because of the repo's star count.
- **The eval re-run was ticked on Mitchell's word** (*"Tick it on your word"*). It was not run.

### 2026-10-20 — minted: M51, ahead of M49

**Asked 2026-10-19, scoped 2026-10-20.** M50's walk filed the homepage redesign as a candidate
(*The front door tells the story*) and as its own milestone, starting from a design review. The
review ran on 2026-10-20 (three directions, two second rounds, two motion prototypes), and Mitchell
chose C2, the sea of notebooks. **M51 is minted, scoped and current.** It is placed **ahead of
M49**, which waits (Mitchell: M51 goes ahead of M49, and nothing in M49 has started). M48 stays
parked. Order: M51 → M49 → M43 → M44, with M48 parked. The decisions are in
`M51-the-front-door-tells-the-story.md`.

### 2026-10-22 — minted: M52, the trip comes with you

**Asked 2026-10-22.** Mitchell: *"we have lots of functionality to plan the trip, and we have some
functionality for after the trip. But nothing during the trip."* He listed flight details and a
countdown just before, today's overview with the next stop and directions, the assistant for
questions and changes mid-trip, and a trip chat, and asked where it should live without breaking
the simple-UI rule. **M52 is minted, not scoped**, and placed **after M51** (*"a upcoming
milestone to do next"*), ahead of M49. M51 stays current. The chat is already built (M46); the
recommendation for where the rest lives is phase-driven content on Home and Overview, with no new
tab (SPEC §10). Order: M51 → M52 → M49 → M43 → M44, with M48 parked.

**Answered later the same day.** Mitchell replaced that recommendation with a *During the trip*
notebook: a Today scope applied to every widget with a day, new widgets for the rest, and Overview
swapping to it during the trip. He dropped live flight tracking, push and offline (all three are
candidates), took flight details into M52 (M44 keeps containment), and asked for the assistant in
the group chat, paid plans only, on the asker's quota and accepted only by the asker.
In a second review he settled the swap (under way only), local time for every stop, change
lines in the chat, and `@assistant` reading the chat through a `read_chat` tool whose message
count is a tunable constant.

### 2026-10-26 — minted and placed: M54, the motion pass

**Asked 2026-10-26.** Mitchell: *"Start working on the milestone that adds the animations and
transitions."* The design was written and approved on 2026-10-25 and said it would become its own
milestone. **M54 is minted, scoped and current**, ahead of M43, on his answer at scoping. Its
decisions 17–21 (placement, the route cross-fade, the welcome cookie, reduced motion in e2e, the
eight-part split) are in `M54-the-motion-pass.md`, the mechanisms in ADR-082. The parts run as an
unattended stack. Order: M54 → M43 → M44 → M53, with M48 parked.

### 2026-10-27 — minted: M55, a connector Claude signs in to

**Asked 2026-10-27.** Mitchell: *"Could you add a milestone to the caesura project to add the
ability for a oauth connector so you can connect?"*, then *"Yes, add it"*. The need is a daily
Claude routine that researches a destination and publishes an itinerary, which today would need a
`tc_…` token pasted where a routine cannot keep it. **M55 is minted, not scoped**, and placed
**last**, after M53, since he named no place for it. M43 stays current on `main` (M54's part 0,
PR 593, is open and would make M54 current). The design questions and eleven recommended decisions
are in `M55-claude-connects-as-you.md`. Order: M43 → M44 → M53 → M55, with M48 parked.

### 2026-10-27 — placed: M55 ahead of M43

**Asked 2026-10-27**, at M55's scoping. Mitchell placed **M55 ahead of M43**, so M55 is the
**current milestone**; M43 waits behind it, unscoped. He answered all eleven decisions the same
day: D1–D6 and D9 as recommended, D7 changed (registration open to any HTTPS redirect, with a
threat review), D8's hashing changed (API tokens and OAuth secrets both HMAC-SHA256, every
existing `tc_` token revoked), D10 Connected apps in Account → Profile with Disconnect only (widened to
*"via <client>"* labels, then withdrawn the same day to simplify; the labels and the
operator-console mirror to `docs/candidates.md`), D11 changed (no duplicate guard;
publish answers the public URL). ADR-083 records the design; the plan is
`docs/plans/2026-10-27-M55-claude-connects-as-you.md`. Order: M55 → M43 → M44 → M53, with M48
parked.

### 2026-10-30 — minted and placed: M56, New trip as a picker

**Asked 2026-10-30.** Mitchell: *"Start working on
docs/specs/2026-10-29-new-trip-picker-and-trip-builder-design.md. I want it to be the next work
we do, so go ahead and get the plan ready to be the next milestone then start work."* **M56 is
minted, scoped and current**, ahead of M43. He answered D1–D9 the same day: D1 changed to
*create first* (no pre-trip builder, no `new-trip` surface), D2 changed to no server draft, D7
changed to Cass in both; D3 (world search as a signed-in branch of `/api/places`), D4, D5, D8 and
the new D9 (published days as an optional card on Review) as recommended, D6 withdrawn. ADR-084
records the mechanisms; the plan is `docs/plans/2026-10-30-M56-new-trip-picker.md`. Order: M56 →
M43 → M44 → M53, with M48 parked.

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

---

## Moved out of README.md on 2026-09-30

The retirement pass under `docs/guidelines/retiring-a-rule.md`, run because
`docs/milestones/README.md` was at 89% of its surface budget. Verbatim, nothing
reworded. Two kinds of text:

- **The Current-milestone placement paragraphs from M26 to M28.** Each records
  why a milestone was current. All of those milestones have closed; the live
  line is `Current milestone:` in `README.md`.
- **Four notes from under the Phase 3 table** whose stated order was superseded
  by later decisions (their own text says so), plus M10's reopened Wave-1 gate,
  which Wave 2 closed on 2026-08-27. The 2026-07-28 restructure, the 2026-07-07
  placement notes, the 2026-07-10/11 renumberings and the 2026-08-23 design sync
  stay in `README.md`: the renumbering tables are how to read older files.

### Current-milestone placements, M26 to M28

*(The paragraphs below are earlier placements, kept for their reasoning.)*

**M28 — Three kinds — was current from 2026-09-25 to 2026-09-26.**
**2026-09-25, PLACED BY MITCHELL** after M24's gate closed: *"Planned =
Default, Pending = Combo Idea / Hold, Transit = Travel. The rest feel too small
to be worth complicating ui."* Built the same day (#238, #239); ADR-054;
`docs/milestones/M28-three-kinds.md`.

**M14 was current for a few hours on 2026-09-25**, until M28 was placed ahead.

**M24 — A leg knows where it goes and by what — was current from 2026-09-23**
to 2026-09-25.

**2026-09-23, PLACED BY MITCHELL** ahead of M12, the way M26 was placed ahead
of M13: M12 puts ratings onto surfaces this pass reshapes (Discover's Filters
menu, the new-trip Playbook-day turn), and reshaping them once is cheaper.
Scope, ten links, seventeen decisions and the gate:
`docs/milestones/M27-simplify-pass.md`. M12 is next.

*(The paragraphs below are M12's placement, kept for its reasoning.)*

**2026-09-22, BY M13'S GATE CLOSING** at **10 of 10** — the second consecutive
move made by a gate rather than by Mitchell placing a milestone, which is the
way the checklist at the top of this file describes. M13 held the line from
2026-09-21.

**M13's last box, the two-actor browser walk, is ticked on Mitchell's
attestation** — he walked the preview himself after `#201` merged. An agent
could not: a two-member trip needs the owner's `trip.collaborators`
entitlement and the preview answers **402**. That is the same basis M21, M22
and M26 closed boxes on, and it is named in the milestone file rather than
blurred. M13 also carried an **unplanned sixth piece** — notebooks joining the
event log, after a two-device report — and its retro is in the milestone file.

*(The paragraphs below are M26's close, kept for its reasoning.)*

**Two of M26's boxes closed on Mitchell's attestation, not on agent-recorded
evidence** — the API-token scope walk and the free-account no-access fork, both
of which the preview seed cannot produce an account for. Same basis M21 and M22
closed on, and named in the milestone file rather than blurred. **A third is
ticked with its failures named rather than as an unqualified green:**
`test:e2e:ci-like` ran 153 passed / 2 failed, both map specs, both KI-49 (the
browser does not trust the agent proxy's CA, so MapLibre never draws) — a
container fact, not a code one.

**M13's preflight is DONE — 2026-09-21, and it is no longer a risk to carry.**
The activity-field descriptor refactor (`KI-20260905-o`) ran once, before this
milestone, as its own piece of work at Mitchell's request. ~21 non-test files
hand-enumerated activity fields and nothing went red when one was missed; now
`ActivitySnapshot` declares the set once and a ninth field is a compile error
at every site. It was shared with M19 link 1 and M24, so both are unblocked
too. It had been scheduled once before, on 2026-08-29 as *"one overnight
batch"*, and did not happen — which is why it was a gate box rather than a
promise, and that box is now ticked.

**M23's gate closed at 11 of 11 and SHIPPED** the same day (#192, merged as
`7763913`), with its migration dispatched and production verified; the note is
below. **M25's gate closed 2026-09-19**, 14 of 14. **M22's gate closed
2026-09-19 at 19 of 19 and M21's at 17 of 17**, both on Mitchell's attestation
rather than on agent-recorded evidence — the note is below.
Order from here:
`M11a ✓ → M11b ✓ → M17 ✓ → M9 [built 2026-09-16, paused — gate needs a live model call] → M20 ✓ → M21 ✓ → M22 ✓ → M25 ✓ → M23 ✓ → M26 ✓ → M13 ✓ → M12 → M24 → M14 → M19`.
**Reordered and widened 2026-09-18 by Mitchell** — three milestones minted (M23, M24, M25), M13 moved ahead of M12, and two pieces of non-milestone work placed inside that order: see the 2026-09-18 note below.
**M22 was placed 2026-09-16 and moved ahead of M21 the same day** — both notes
below. The second one also records a cost it first got wrong.
**This line then moved to M25 on 2026-09-18** — the third time it has moved by
decision rather than by a gate close, and the note recording it is directly
below.

**M26 was minted, scoped AND placed on 2026-09-19** — it is now in that order,
ahead of M13, and the note below records both the scoping and the placement.
The argument for this position is the one the milestone file already carried:
M13 adds a second actor to the surfaces M26 rebuilds, so the other order
rebuilds them twice. What it owes forward is unchanged — M12 renders reviews
into two surfaces M26 rebuilds, and going first means M12 adds rows to a
finished layout.

### Superseded reorder notes

- **Reorder (2026-08-08), ADR-018.** M10 "Visual craft pass" executes *before*
  M9, not after, despite its higher number — an external design-team handoff
  specified M9's (and M11's) not-yet-built surfaces, removing the
  design-uncertainty reason the original M9-then-M10 ordering existed for. New
  execution order: `M8 ✓ → [Phase 1 gate review ✓] → M10 → M9 → M11 → M12 →
  M13 → M14`. *(Amended 2026-08-23 by ADR-021, which inserts M15 between M10 and
  M9: `M8 ✓ → [Phase 1 gate review ✓] → M10 → M15 → M9 → M11 → M12 → M13 → M14`.)*
  Milestone *numbers* are unchanged — this is an execution-order
  swap, not a renumbering — see `docs/milestones/M10-visual-craft.md` and the
  ADR for the full argument.

- **Reorder (2026-08-25), ADR-022.** **M16 "The assistant answers questions"**
  is added and executes right after M10's Wave-2 gate, ahead of M15; **M9 moves
  to last, after M14.** Mitchell declined to open M9 on the grounds that the data
  layer beneath a planning partner is not strong enough yet and that UI polish
  and sharing come first. Scoping the smaller ask surfaced why it is not a
  styling task: the AI endpoint derives its reply from *committed commands*, so a
  question that changes nothing returns "I couldn't turn that into any changes",
  and the context envelope carries no activity time windows — a question about
  free time is unanswerable twice over. M16 builds the read half on its own
  endpoint, leaving the command pipeline untouched. New execution order:
  `M8 ✓ → [Phase 1 gate review ✓] → M10 → M16 → M15 → M11 → M12 → M13 → M14 → M9`.
  Milestone *numbers* are unchanged — the same placement-not-renumbering shape as
  ADR-018 and ADR-021.

- **Reorder (2026-08-26), M15 decision 1 — supersedes ADR-021/ADR-022's stated
  order.** **M15 "Front door" ran ahead of M10's Phase 9 gate and ahead of
  M16**, and its own gate closed 2026-08-26 (PR #56) while M10's Phase 9 gate
  was still open. ADR-021 had placed M15 after M10's gate and before M9;
  ADR-022 then placed M16 ahead of M15 on the same "after M10's gate" footing.
  Neither anticipated M15 executing — and finishing — *before* M10's own gate
  closed. Mitchell accepted M10 staying open meanwhile (`M15-front-door.md`
  decision 1). Execution order, reflecting what actually happened rather than
  what was planned: `M8 ✓ → [Phase 1 gate review ✓] → M10 (Wave 2, Phase 9
  gate open) → M15 ✓ → M16 → M11 → M12 → M13 → M14 → M9`. Milestone *numbers*
  are unchanged — the same placement-not-renumbering shape as ADR-018,
  ADR-021 and ADR-022.

  **Superseded twice since, both on 2026-08-26:** M18 was approved and
  scheduled between M10's gate and M16 (see M18's row above), and M10's own
  Phase 9 gate then closed on 2026-08-27. **Superseded again 2026-08-27**, when
  M11 was scheduled ahead of both M18's remaining surfaces and M16. Current
  order is `M11 → M18 (surfaces) → M16 → M12 → M13 → M14 → M9`, with **M17
  approved and unplaced** — *superseded 2026-08-29, when M17 was re-scoped and
  placed after M18b; see Current milestone below.*

- **Gate reopened (2026-08-14).** M10's Wave-1 gate closed 2026-08-10 on branch
  `claude/m10-trip-planner-visual-7bbacf` (PR #23, still unmerged). An external
  review that Mitchell requested — `docs/design-feedback/2026-08-14-M10-redesign-
  external-review.md` — found two things the gate could not have caught: the
  design handoff had advanced **two** generations since the version Wave 1 was
  built from (1,412 → 2,048 → 2,623 lines), and Wave 1's own new assistant rail
  introduced three blocking defects, the worst of which the e2e suite is
  structurally blind to (`playwright.config.ts` sets no `viewport`, so every spec
  runs at 1280px, above the 1179px breakpoint where the page-blocking scrim turns
  on). **Wave 2** closes the delta; plan at `docs/plans/2026-08-14-M10-redesign-
  delta.md`. Milestone numbers and order are unchanged.

---

## Moved out of README.md on 2026-10-11

The retirement pass `pnpm milestone close M41` listed, under
`docs/guidelines/retiring-a-rule.md`, run because `docs/milestones/README.md`
was at 88% of its surface budget. Verbatim, nothing reworded. Two kinds of text:

- **Eight dated notes, filed above in date order**: the two from 2026-09-01
  (the milestone audit, and M9's move from last to second), 2026-09-10,
  2026-09-13, 2026-10-05 and three from 2026-10-06. Every milestone they
  place or close has closed its gate. `README.md` keeps a dated pointer to each.
- **The Current-milestone placement paragraphs from M14 to M34**, below. Each
  records why a milestone was current. All of those milestones have closed; the
  live line is `Current milestone:` in `README.md`.

### Current-milestone placements, M14 to M34

**M34 became current 2026-10-05, by M33's gate closing** at **6 of 6**, the day it was minted.
Scope and gate: `docs/milestones/M34-nearby-stops.md`; build plan
`docs/plans/2026-10-05-M34-nearby-stops.md`.

**M33 — evals — was current on 2026-10-05 only**, by M32's gate closing. Its retro is at the end
of `docs/milestones/M33-evals.md`.

**M32 — the free-day tool — was current on 2026-10-05 only**, by M31's gate closing. Its retro is
at the end of `docs/milestones/M32-free-day.md`.

**M31 — the assistant ledger — was current from 2026-10-04 to 2026-10-05**, by M19's gate
closing. Its retro is at the end of `docs/milestones/M31-assistant-ledger.md`.

**M19 — the cost model — became current 2026-10-01, by M14's gate closing** at **22 of 22**,
and was scoped on 2026-10-02 by ADR-060. Scope and gate: `docs/milestones/M19-cost-model.md`.

**M14 — Rich layer — was current from 2026-09-26 to 2026-10-01**, by M28's gate
closing. Its retro is at the end of `docs/milestones/M14-rich-layer.md`.

---

## Moved out of README.md on 2026-11-01

The retirement pass `pnpm milestone close M43` listed, under
`docs/guidelines/retiring-a-rule.md`, run because `docs/milestones/README.md`
was at 89% of its surface budget. Verbatim, nothing reworded. Two kinds of text:

- **Six dated notes, filed above in date order**: 2026-10-20 (M51), 2026-10-22
  (M52), 2026-10-26 (M54), both from 2026-10-27 (M55) and 2026-10-30 (M56).
  Every milestone they place or close has closed its gate. `README.md` keeps a
  dated pointer to each.
- **The table rows of 30 closed milestones**, below, each the whole row
  as it stood. They carried scoping and placement history written before the
  gate (criteria 2 and 3), and six of them still described a closed milestone
  as proposed or current (criterion 5). `README.md` keeps each row with its
  gate, one line of scope and its milestone file.

### Table rows for closed milestones, as they stood on 2026-11-01

| # | Name | Scope |
|---|---|---|
| M9 | The assistant cites what it plans | **Gate closed 2026-10-06, 10 of 10, on Mitchell's production attestation** (two artefact boxes ticked by decision; see the retro). **Retitled 2026-09-01** (was "AI as a planning partner") after an audit against `main`: **four of its seven scope items are already shipped** — streaming, propose→review→approve, refinement within a session, and honest unknowns — and **three of its six gate boxes are already satisfied**. What remains is three things: **grounding** (`SearchPlaces` → `placeRef`, KI-81/KI-15), **conversation durability** (there is no conversation table, so a reload loses the thread), and **an eval/replay harness** (KI-11, inherited from M16's gate). **Conversation design still lives here.** Placed last by ADR-022 (2026-08-25) on two grounds — polish first, sharing first — **both of which have since been met**, and the placement has not been re-examined since; the audit recommends moving it to after M17. The practical cost of last: `ai-live` defaults off and grounding is what would let it be turned on, so the largest built feature in the product is dark. **Paused 2026-09-13, not cancelled** — Phase 0 (the assistant kernel, ADR-043) completed 2026-09-11 and ticked no gate box by design; the three real pieces of work were untouched at the time, and M9 keeps its place immediately after M21 rather than returning to the back of the queue. **All three were built 2026-09-16** (grounding, durability by `localStorage`, the replay harness — `M9-ai-planning-partner.md`); what is left of the gate is a live model call and the browser walks that rest on it: `docs/reviews/2026-09-01-milestone-audit.md` |
| M10 | Visual craft pass | **Done, Wave-2 gate closed 2026-08-27.** Executed before M9 (see the 2026-08-08 reorder note below). Wave 1's gate closed 2026-08-10 on a branch; an external review on 2026-08-14 reopened it (the design handoff had moved two generations, and the wave introduced three blocking defects). Wave 2 closed the delta across Phases 0-8 plus 8b; Phase 1b was cancelled unbuilt. The "make it beautiful" pass: a coherent restyle of Home/Trip-plan against the design handoff, plus inert `<Preview>` shells for M9/M11's not-yet-built surfaces. Retro and gate evidence: `M10-visual-craft.md` |
| M11 | Fork & remix / Sharing and invites | **Done, gate closed 2026-08-28** — eight of eight boxes, e2e 46/46 twice against a production build, and the invite→accept→edit and pinned-share flows walked on a Vercel preview as two actors. **Playbooks/templates was carved out at the gate by Mitchell and is M11b — scoped and placed 2026-08-30.** Links 1-6 landed 2026-08-28 (PR #71), remediated by PR #78; retro and gate evidence in `M11-sharing-and-invites.md`. Scheduled 2026-08-27 ahead of M18's remaining surfaces and M16, and **absorbed M13's invites/roles/revocation scope** in the same decision. Clone-with-lineage, day- and trip-level templates, share links with read access. Moved ahead of Collaboration on 2026-07-28 — this is the "social" thing actually wanted, and it needs no realtime transport. **Also owns the landing page's "Look around a real trip" CTA** (2026-08-23 design sync): it needs unauthenticated read of a real trip, which is this milestone's share-link work and nothing smaller |
| M11a | An invite gate on the front door | **Scoped and placed 2026-08-30**, running after M17 and **before M11b**. Created out of M11b's scoping review the same day: M11b publishes user-authored text and leaves reporting to M12, which rests on Mitchell's call that the platform is invite-gated — *"we will gate on who we invite to platform... we need a community before its a issue"* — and today it is not, since any Google account that reaches `/signin` gets one. **Three ways through, evaluated only when there is no `users` row**: a pending M11 trip-invite token (Mitchell's call — a trip invite *is* an invitation, or M11's invite→accept flow breaks for the new collaborators it exists to serve), a **reusable super code**, and **single-use codes** in a new `invite_codes` table. Small because most of it exists: `users` (ADR-025) already records who has been here, so "never been to the app" is "has no `users` row", and `recordSignIn` is already a fail-closed boolean landing on the designed `/signin?error=` screen. The one real problem is that OAuth leaves the site, so the code rides a short-lived httpOnly cookie across the round trip. Needs a migration, and the migration needs a dispatch: `M11a-invite-gate.md` |
| M11b | Playbooks becomes a public library | **Scoped and placed 2026-08-30**, running after M17 and immediately before M12. Carved out of M11's gate 2026-08-28 and unplaced for two days because it had no scope — a product decision. The **2026-08-30 design handoff** supplied it: `SPEC.md` §15 / `DRIFT.md` §2b turn Playbooks from a private grid into a discovery surface over other people's days, across four routes — `playbooks` (Discover), `day`, `board` and `profile`, three of them new. **Mitchell drew the scope line short of reviews**: M11b takes all of §15 except reviews and ratings; M12 keeps those plus moderation, which is why M11b sits immediately before it. Eight links — `cities: string[]`, a `GET /cities?q=` endpoint, publishing (private by default, author can unpublish), an adds ledger keyed by (day, trip) without which the board's ranking rule is gameable, and the four routes. Closes DRIFT's **D9** and deletes the last four M11-tagged `<Preview>` shells. Two deltas from the spec text and one precondition — a platform signup gate that does not exist in code — are recorded in: `M11b-playbooks-public-library.md` |
| M12 | Reviews and moderation | **Retitled 2026-09-01** (was "Community"): the gallery and discovery halves of that name shipped in M11b, so the title promised a milestone that no longer exists. Originally public gallery, discovery, voting, reporting (all trust & safety scope quarantined here). **Narrowed 2026-08-30 by M11b's placement**: the public gallery and discovery are M11b's, and what M12 keeps from `SPEC.md` §15 is **reviews** (the table, stars, the ≤140-char note, the live average, the three review states), **ratings everywhere they surface** (the shared day's 5→1 histogram, the `rating`/`reviewCount` counters, the profile's average, Discover's rating floor filter and its highest-rated / most-reviewed sorts), and moderation. **Scoped 2026-09-01** — it had no file and no exit gate until then: `M12-reviews-and-moderation.md` **Widened 2026-09-09 on Mitchell's request: link 7 adds country search beside city search in Discover's box** — one typeahead returning both kinds, labelled, either selectable. It is the one part of M12 that is not trust and safety, and it **amends the milestone's own "nothing that changes what M11b ships"**; the file names the alternative (carve it out, the M11b way) if that widening is unwanted. Two things a planner needs: it is a **second migration** (`saved_days.countries`, a `text[]` snapshot on ADR-029's terms), and it has a **data prerequisite** — the content library carries `countryCode` on none of its 1,375 locations, because `geocode-content.py` writes back coordinates only, though its own `learned_countries()` already computes the answer. |
| M13 | Collaboration | **Done, gate closed 2026-09-22 — 10 of 10**, merged as `#201` (`99f32d3`). The last box, the two-actor browser walk, is ticked **on Mitchell's attestation**, not by an agent: the preview answers 402 without the owner's `trip.collaborators` entitlement. It also shipped an **unplanned sixth piece — notebooks joining the event log** (page writes went straight to the `pages` table, so a save never moved `headSeq` and the M13 poll was correctly told nothing had happened); the retro is in the milestone file. *(Everything from here to the end of this row is the scoping as written before the gate, kept for the reasoning rather than as a description of the result.)* **Narrowed 2026-08-27: invites, roles and revocation moved to M11** — what is left is near-real-time sync (transport ADR due here) and concurrent-edit conflicts as resolvable data. **It also owns per-stop attribution** (`add-stop-who` and `rack-provenance` in `preview-registry.ts`) — *no field records who a stop is for* — and **M19's link 3 depends on this milestone landing that field**, which is the whole reason M19 is placed after it. If M13 ships without it, that link returns to M19. Architecturally: swap the AccessPolicy implementation, broadcast events. The largest remaining architectural lift, so it waits until something needs it. **Scoped 2026-09-01** — it had no file and no exit gate until then; the transport ADR is a prerequisite, and link 3 (the re-prediction reducer KI-90 names) closes the KI-5 optimistic-loss class: `M13-collaboration.md` |
| M14 | Rich layer | **Gate closed 2026-10-01, 22 of 22** (#222, #223, #226, #221). Code merged 2026-09-24, ahead of M24. Mitchell settled the insert Sheet call, ADR-052 and the six-widget walk on 2026-09-27, and attested the real-service weather walk on 2026-10-01. *(**Updated 2026-09-24** — the rest of this cell is the 2026-09-01 scoping and is behind the milestone file, which was rescoped twice on 2026-09-03 to SPEC §18's widget model and widened 2026-09-18 with link 10, saved notebook templates. **External calendar sync is dropped** (Mitchell, 2026-09-24); embedded community objects and a TipTap/Yjs ADR are out of scope per the file — TipTap is already the editor. Ghosts are Editing-only, and the `days`/`trip` input types are retired.)* Notion-style pages with embedded community objects (TipTap/Yjs ADR due here), external calendar sync, dogfood-backlog items. The macro vocabulary deferred out of M8 returns here. **Owns the whole Notebook redesign** (`.design-sync/handoff/SPEC.md` §7, routed here 2026-08-23): reading/editing modes, values as chips, the scope × shape insert picker, prebuilt pages, the journal framing — and **repeaters**, which need their own ADR before the milestone opens (see the design-sync review §7). **Scoped 2026-09-01** — it had no file and no exit gate until then. Two items on this row need a call before it opens: the M8 macro vocabulary, and **external calendar sync**, which has no design, no ADR and no relationship to the Notebook and may deserve its own milestone: `M14-rich-layer.md` |
| M16 | The assistant answers questions | **Done, gate closed 2026-08-29.** Approved 2026-08-25 — ADR-022. Originally placed right after M10's gate and before M15; **M15 in fact closed its own gate first (2026-08-26), ahead of both M10's Phase 9 gate and M16** — see the 2026-08-26 reorder note below. M16 still runs before M11-M14. The sidebar styled to `SPEC.md` §9's *docked* presentation (a flex sibling, not a scrim overlay; both `<Preview>` blocks deleted), then a **read-only tool-using agent** on its own endpoint — one question, one answer, scoped to the selected day or the trip — then analytics on which tools get called and how many calls an answer costs. The command path is untouched. Exists because the AI endpoint today is a *command* endpoint and structurally cannot answer a question: `M16-assistant-read-agent.md` |
| M17 | Account preferences | **Done, gate closed 2026-09-11.** Three of three live boxes; box 3 (home time on hover) was amended out 2026-09-01. Built in PRs #111 and #112 and **in production since 2026-09-02** — the gate simply went nine days unconvened while other work merged, which is the subject of its retro. **Approved 2026-08-26; re-scoped and placed 2026-08-29, after M18b.** The `users` table and the identity decision were removed from its scope — M11 link 1 shipped both (ADR-025) — leaving the preferences half. Opened by Mitchell reviewing SPEC §12: *"Skip on C5/C6/C7 and make a future milestone, account customization. We will need a new DB table, but i also think we are getting close to just wanting a user table rather than relying on the google auth jwt."* Account settings Sheet (name, email, home airport), distance units at **account** scope through one `kmLabel`, and home-time-on-hover. All three land on the same absence — **narrowed 2026-09-01**: the claim that "the schema is `events`/`trip_summaries`/`trip_details`/`pages`, there is no user row" has been false since ADR-025. The schema is twelve tables and `users` is one of them; what is missing is **preference columns on it**. `users.name` already exists, so "resolve `who` to a display name" is closer to wiring than building. The identity question this milestone was approved to answer is answered: `M17-account-customization.md` |
| M18 | A stop knows what kind of thing it is | **Done, gate closed 2026-08-29.** Ran after M10's Wave-2 gate and M11, before M16. **Widened to carry `tags` (KI-47) as well as `kind`**, on Mitchell's call — *"i dont want to do KIND and TAGS right now, but we can put it in a soon milestone"* — because the two are one contract change, one migration and one backfill decision. A stop has no `kind` — `booked`/`hold`/`idea`/`transit` lives in **note text** (`db-seed.ts` folds it there and says so). Began as one cosmetic tile; SPEC §12 made it load-bearing. **At the gate, that same SPEC §12 travel-day split was built, walked and removed** — it depended on how the fixture tagged cities, so the Calendar groups by city alone and the transition moved to the day label. Shipped: `act.badge`, tag chips, both editor pickers, the home-hero tile, `N to book`. Tag focus carved out as M18b: `M18-stop-kind.md` |
| M18b | Tag focus | **Done, gate closed 2026-08-30.** Approved 2026-08-29 and placed the same day, immediately after M16; built and closed the next day, its six behaviours green on `test:e2e:ci-like` and the deployed half walked by Mitchell on PR #91's preview. Carved out of M18's gate on the same terms M11b left M11's: M18 lands both fields, every surface that reads `kind`, and tag chips that render and can be set — M18b lands the behaviour the chips drive. SPEC §11's focus dims off-tag stops to 32% across Timeline, Day columns, Calendar and Map (Calendar instead shows `N of M match`, dimming a no-match card to 0.28). It was the only part of M18 needing shared state above the lens switch, its Calendar rule is a second design, and no M18 gate box measured it. Scope and exit gate are already written, so unlike M11b it needs only a place: `M18b-tag-focus.md` |
| M19 | A cost knows who and what it is for | **Minted and placed 2026-08-31 by Mitchell — runs last, after M9.** Opened by M11b's `preview-registry` sweep: `cost-estimate-state` and `budget-breakdown` were tagged M11, are not M11's, and belong to no existing milestone — *"it does feel very much like a tacked on concept ... splitting cost, cost per person based on whos attached to what activity, better sharing cost in the shared day ui."* The whole model today is `Money = {amountMinor, currency}`, one optional `cost` on an activity and one `budget` on a trip. Five links: a cost's **kind** (**shipped 2026-09-26**: "Spend by kind"), a cost's **settled-vs-estimate** state (unblocks `cost-estimate-state`), **who an activity is for** (overlaps M13's `add-stop-who` — must land in exactly one), **splits** derived from that, and the **shared-day** presentation. Its anchor finding: `savedDayFacts.budgetPerPerson` was a plain sum of stop costs with nothing to divide by, so a shipped field asserted a per-person meaning it did not have — **the name was removed on pull request 104** (it is `totalCost` now, dividing by nothing and claiming nothing); the cost model it was standing in for is still entirely M19's: `M19-cost-model.md` |
| M20 | An account knows what it may do | **Done, gate closed 2026-09-14** — 32 of 32 live boxes, built as #174 and #175, migrations 0019/0020 dispatched to production the same day, the console walked on production and the account surfaces on a preview; retro and gate evidence in the milestone file. **Scoped and placed 2026-09-01 — ran after M9's Phase 0, before M21.** The **first commercial milestone**: nothing in the repo had ever described a paid tier, a plan, a price or a payment. Mostly a wiring job on a seam built for it and stubbed since M16 — `modelSelection.ts:88` declares `AiEntitlementCheck`, `:89` stubs it `EVERYONE_IS_ENTITLED`, and `:47` says *"the day a pro-tier check exists it lands inside `isEntitled` below, not as a signature change"*; ADR-019 is explicit that entitlement is **not** a flag. Nine links, the ninth added 2026-09-01 when Mitchell asked for the financial metrics: **an `ai_usage` cost ledger** storing tokens and models rather than dollars, because prices move (DeepSeek's changed mid-scoping) and because `Money`'s integer minor units round a $0.0006 request to **zero cents** — the KI-1/KI-14/`budgetPerPerson` defect class on its third recurrence. It moved out of M21 deliberately: M21 has to choose prices and M20's link 5 has to choose per-tier ceilings, and both are guesses without it, while the ledger itself needs no Stripe. It carries the `/ask` step-metering fix with it. Its four rules: **a plan is a set, not a rank** (Mitchell: tiers are *"not necessarily subsets"*, so copying `accessPolicy.ts:11`'s `RANK` is the obvious move and the wrong one); **trials, referral rewards and admin boosts are one time-bounded grant with three `source` values**, not three features; entitlements **resolve per request from the database**, never from the JWT (a downgrade must bite before a token refreshes); and — added 2026-09-01 on Mitchell's requirement that prices stay tweakable *"especially in the early days"* while purchases are honoured — **a plan's contents are versioned data, not code, and a purchase pins a version**. `plan_versions` is immutable and append-only, so changing a price or a term **publishes a new version** and what someone already bought is untouched until an explicit admin *migrate to version N*; the contracts package keeps the entitlement vocabulary, the rows own the offers. That is also what makes pricing changeable **without a deploy**. Free keeps trip planning entire; AI and inviting collaborators are paid. **It takes no money** — Stripe is M21, and the admin grant UI is what makes this provable without it. Plans are `free`, `plus` and `premium`, and **defined by enumeration, never by extension** — Mitchell, 2026-09-01: *"to an end user it should look like a nested ladder, but for architecting guidance it should look like split access, where they can own different things that aren't inherited from the previous tier"*, so the three happen to nest and nothing in code may know it; the ladder is presentation only. Four decisions by Mitchell the same day: on lapse granted memberships **cap at `viewer` on read**, never written to `trip_memberships`, so resubscribing restores everyone with zero writes; every account existing at migration time gets a **permanent `founder` grant**; the **trial grants `plus` at signup**, so collaboration is never trialled; and a **referral earns one month of the tier the referrer already holds**, which means a free account earns nothing and most of the abuse surface disappears with it. Needs a migration and an ADR adding an **Entitlements** module to `AGENTS.md`'s map — **that ADR is written and accepted: ADR-045**, and the map row landed with it. **Reordered 2026-09-13 on Mitchell's call: this is the CURRENT milestone**, running ahead of M9's remaining work; M20's own *"M9, and it must be closed"* prerequisite is superseded, with the cost accepted on the record in the 2026-09-13 note below. Kickoff plan: `docs/plans/2026-09-13-M20-M21-commercial.md`: `M20-account-tiers-and-entitlements.md` |
| M21 | An account can pay for itself | **Done, gate closed 2026-09-19** — 17 of 17; the last six boxes ticked **on Mitchell's attestation** that he walked them and they worked, not on agent-recorded evidence (see the 2026-09-19 note below and the retro in the milestone file). **Scoped and placed 2026-09-01, immediately after M20.** Stripe checkout, the webhook that is the **sole writer** of subscription state, the customer portal, and failed-payment handling. **Adds no entitlement and no gate** — if its diff touches `modelSelection.ts`, `quota.ts` or `members.ts`, the split has failed. Separate from M20 for three reasons: M20 is provable end to end with no external service and this is not; a hand-grant path is permanent infrastructure (comping, trials, disputes) rather than scaffolding; and the blast radius here is money, where a webhook mistake charges someone twice or grants access nobody paid for, silently. Signature verification, idempotency under Stripe's retries, and out-of-order tolerance are each a gate box, as is *no card number ever reaches this application*. Cancelling lapses through **M20's resolver** — no second downgrade path to keep in sync. **Link 6 is the revenue half of the unit economics**, against M20's cost ledger: MRR, ARPU reported twice and labelled (all accounts vs paying accounts, which diverge badly once founder/referral/trial grants exist), trailing-30-day margin per account, and an *accounts that cost more than they pay* list **segmented by grant source** — a comped account is underwater by construction, and unsegmented those swamp the list and make the metric worthless. **Mitchell owes one decision before it opens: the plans and their prices** — M20 names plans without pricing them — **decided 2026-09-13: `free` $0, `plus` $9/month, `premium` $19/month**, so this milestone's one owed decision is closed before it opens. **Reordered 2026-09-13 on Mitchell's call: it runs immediately after M20 and ahead of M9's remaining work**, both placed by the note below: `M21-subscriptions-and-billing.md` |
| M22 | An account can build on the API | **Done, gate closed 2026-09-19** — 19 of 19; the last box, the preview walk, ticked **on Mitchell's attestation** that he walked it and it worked, not by an agent (see the 2026-09-19 note below and the retro in the milestone file). **Placed 2026-09-16 by Mitchell — runs after M21, before M12**, and was the **current milestone** from then until 2026-09-18. A public REST API and account-generated API tokens, scoped to the account or to named trips, with create and revoke. All five phases landed 2026-09-16 and **18 of 19 exit-gate boxes were ticked** that day; the one left open needed a browser walk on a Vercel preview, and what blocked it was **`ADMIN_USER_IDS`** (`KI-2026-09-16-d`): it is injected at build, so no account reachable from a browser can be granted `api.tokens` there. *(This row said `API_TOKEN_PEPPER` until 2026-09-19. That was wrong — see the 2026-09-19 note below.)* Three boundaries fixed at placement: **user accounts only, no admin surface, no AI surface** — so a token can never spend model budget. Its entitlement is `api.tokens` on **`premium@v2`**, which raises the pinning problem a `premium@v1` subscriber cannot escape without an admin grant. The design's claim to test at the gate: adding endpoint N+1 costs a declaration and nothing else. *(**This row was missing until 2026-09-18** — M22 was recorded in `TODO.md`, in Current milestone below and in its own file, and not in this table. That is the same defect this file already records against M17 and M19, on its third occurrence.)*: `M22-public-api-and-tokens.md` |
| M23 | A playbook can be more than one day | **SHIPPED 2026-09-19** — gate 11/11, #192 merged as `7763913`, migration `0024_saved_day_day_count` dispatched and production verified at 25/25. What actually shipped differs from the plan below in one place worth reading before building on it: **a GAP in `dayIndex` IS an empty day**, so an interior rest day needed no column, and `dayCount` is stored only for the *trailing* empty day a gap cannot reach. ADR-048 carries that and three other decisions, two of them marked ✳ because they contradict a premise in the milestone file. *(Everything from here to the end of this row is the placement as written on 2026-09-18, kept for the reasoning rather than as a description of the result.)* **Minted and placed 2026-09-18 by Mitchell — runs BEFORE M12**, and the placement is the substance: M12 keys reviews, ratings, reporting and moderation to a `saved_days` row, and this changes that row's shape, so running it after means M12's work is revisited. **A saved day generalises into a saved sequence — the same object, not a new one.** The rejected alternative was a separate "collection" over saved-day rows: rejected because a second publishable object either doubles M12's trust-and-safety surface or ships a library with two classes of content having different moderation properties. **The shape is a flat `stops[]` with a per-stop day indicator, not `days: SavedStop[][]`** — Mitchell's call, on migration grounds: existing rows read as "everything on day 1" when the indicator defaults, so the strict `SavedStop.array()` parse at the read boundary keeps working with no versioned read, which a nested array would have forced. **That property has a precondition the scoping found**: the strict parse exists at **two** sites (`savedDays.ts`'s `fromRow` and `playbooks.ts`'s `toDiscoverDay`) and `SavedStop` carries **no `.default()` on any field**, so the additive claim holds only if the indicator lands defaulted at both. **One insert primitive, three callers** — add to an existing trip, start a trip from one day, start a trip from N days, wrapped in M6's atomic command group — which absorbs `TODO.md`'s *"Start a new trip from a saved day"* candidate and answers its open question (one shared primitive, not a second copy of fork): `M23-multi-day-playbooks.md` |
| M24 | A leg knows where it goes and by what | **Gate closed 2026-09-25, 11 of 11** (#229, #230, #232, #233; carried: `KI-2026-09-25-q`). **Minted and placed 2026-09-18 by Mitchell — runs after M12, before M14.** A travel stop gets a **transport mode** and a **second location**, and the map draws a real leg instead of inferring one from its neighbours. `MapLegend.tsx:9` has said the gap out loud since it shipped: *"We model no transport mode"*. **Mode carries its own field and does not inherit from `kind`** — `kind: "transit"` says THAT a stop is travel, `mode` says by what, and they cannot disagree because a mode is legal only on a transit stop, enforced by a `superRefine` rather than by convention. That answers the question `TODO.md`'s *"Transport mode per leg"* has carried since 2026-09-01; M19 link 1 may still answer differently for costs, with a stated reason. **`location` keeps meaning the origin** and an optional `endLocation` joins it, so no existing reader changes meaning; modelling travel as an **edge between** two stops is rejected, because the whole app is "a day is an ordered list of activities" and an edge is not in that list. **Its prerequisite is not its own deliverable**: the activity-field descriptor refactor (`KI-20260905-o` — 21 non-test files hand-enumerate activity fields and nothing goes red when one is missed) runs **once, before M13**, shared with M13 link 5 and M19 link 1: `M24-travel-legs.md` |
| M25 | A trip is a file you can take with you | **Minted and placed 2026-09-18 by Mitchell — runs immediately after M22**, because it is small and reuses M22's route wrapper while that machinery is fresh. Trip **export and import** as JSON. **The format is `travel-collab/content-bundle/v1` and no third format is created**: the bundle already has a schema, a CI-enforced linter, pure converters and a real importer, so `export → import → compare` is a gate box a test can hold, and it is the shape a person can hand-author — which is what *"similar to the api"* was asking for. A dedicated export format would be a **third vocabulary over the same data**, the drift invariant 5 exists to stop. **An export is a snapshot, never the event log**: the log is `tripId`-bound and re-importing it would violate ADR-028's id-remap rule, the hazard `cloneTrip` exists to handle, so an exported trip loses its history. **Export is free** (Mitchell, 2026-09-18) — *"free keeps trip planning entire"* is M20's line and portability is a trust property, so it needs **no new entitlement, hence no new plan version**, and does not walk into M22's `premium@v1` pinning problem. Import is the larger half: a user upload must **mint fresh ids**, where the content script derives them from keys so a re-import updates rows instead. **Three scoping questions were decided 2026-09-18.** **What it carries: days and activities, nothing else** — no budget, no members, invites or share links, no notebook pages, no lineage or trip status. That is a scope line, not a gap, and it buys a property worth naming: an export cannot carry a copy of a membership list out of the system. It also means an export is a copy of the plan and **not a backup**. **Linting: the schema validates an upload and the content rules do not run on it** — `lint.ts` states rules for authored library content headed for Discover, and three are errors a real trip trips routinely (an empty trip, stops out of clock order after an ordinary board reorder, a backlog item with a time window), so running it would reject real trips on day one. No subset and no second rule set; revisit if a real problem emerges. **Dates: a dated trip exports its real `startDate`, never `startsInDays`**, and a **dateless** trip carries neither anchor — *"we just have offsets, day 1, not January 15th"*. `BundleDay` already has no date field, so the trip anchor relaxes from *exactly one* to *at most one*. The export is a copy of **your** trip rather than a re-usable shape, so a stale export importing as a *past* trip is the correct answer, not a defect to design around. The dateless half is not a one-liner: `tripStartDate`'s `?? 0` currently resolves a missing anchor to *starting today*, so relaxing the refine alone would make a dateless trip silently dated. **Nothing on this milestone is waiting on a decision** — see `M25-a-trip-is-a-file.md` |
| M26 | The build looks like the design again | **Done, gate closed 2026-09-21 — 22 of 22 over two waves**, which is what moved the current-milestone line to M13 (the first move in five made by a gate rather than by decision). Two boxes closed on Mitchell's attestation and one is ticked with its failures named — both map specs, both KI-49; the milestone file has the basis for each. **Minted, scoped and PLACED 2026-09-19, ahead of M13.** *(This cell went on claiming M26 was current for two days after its gate closed — corrected 2026-09-22; `pnpm milestones` does not read prose inside a cell.)* A design-parity milestone, the first since M10's Wave-2 gate closed 2026-08-27. The handoff has moved **fourteen commits** since, seven of them between 2026-09-12 and 2026-09-19, while the build ran M20/M21/M22/M25/M23 — and **three of the four that closed had no design surface at all** until the design drew them on 2026-09-19. Opened by Mitchell asking for four things by name (Playbooks looking nothing like the designs, account settings as its own page, filters and tabs re-imagined, a hover state on the Map's days); five read-only surveys against the handoff and the working tree found the rest. **Two waves, two gates.** *Wave 1* is the desktop and shared surfaces — Account as a route with three tabs (**closes D14, D12 and `KI-2026-09-17-a`**), Discover re-sorted by kind of decision (**tabs are places, chips are questions, sort rides the results sentence** — a rule for any list surface), a Playbook's days as a scope over the row M23 just shipped, the shared day's map, the Map rail's hover card, trip lifecycle (**closes D13**), §3b's region-by-region loading — of which **literally none exists** — and two guards that cannot see their own class of defect. *Wave 2* is **the phone as a surface**, which `docs/guidelines/design-system.md` has promised since M5 (*"until the mobile milestone"*), `KI-046` calls *"a milestone, not a fix"*, and `TODO.md:1030-1037` calls *"a milestone-sized decision"* — three places in this repo waiting for it to be minted. **It opens with a preflight that is not optional**: `KI-2026-09-14-c` measured that building ONE screen from this handoff cost four review rounds and three wrong builds, and this milestone builds ~20. **Nothing in it is a contract change or a re-skin** — every link is UI over data that already exists, or a named, sized exception; reviews, per-stop attribution and cost classification are routed to M12, M13 and M19 and are out of scope on purpose. **It carries open questions it must not answer silently** — nine when scoped, of which two were answered the same day (the Map rail does get a hover card, and *where the phone edits* is sequenced last in Wave 2 rather than blocking it), leaving **seven**: `M26-design-parity.md` |
| M27 | The simplify pass — the invite landing, Cass, actions that look like actions | **CURRENT MILESTONE — minted, scoped and PLACED 2026-09-23 by Mitchell, ahead of M12.** The 2026-09-22 design pass (SPEC §35): one look; a quieter Home; a trip header that never reflows (rail into Plan, a dates-pill popover, Overview as a letter, a breadcrumb back); Account as two tabs; one Filters menu on Discover; a public **invite landing** with *Have a look first*; the keep dialog's preview; **Cass**, the new-trip assistant, with a typing row and a Playbook-day turn; proposal cards with Undo. Link 10 was added mid-build on Mitchell's request: every Playbook laid out the same, map included. Seventeen decisions where design and code disagreed are recorded, not silently resolved — among them: invites still do not expire, the Playbook-day turn ranks by adds until M12 has ratings, and proposal cards derive their words rather than widening the contract: `M27-simplify-pass.md` |
| M36 | The operator console is four tabs, and an account has a page | **Gate closed 2026-10-06, 13 of 13**, the walks on Mitchell's attestation. Current for part of 2026-10-06, by M34's gate closing. **Minted, scoped and placed 2026-10-06 by Mitchell as the next milestone** — after M34, ahead of M35 — and **started the same day** while M34 is current (see the 2026-10-06 note below). The 2026-10-05 handoff (`specs/operator-console.md`, DRIFT D20/D21) redraws the one-scroll console as Financial · Users · Library · AI models, gives an account a page (usage, activity, grants, revoke with a confirm), deletes `GrantSourcePanel`, and is the first admin surface to read M31's ledger. Growth per tier and notebook shares are out by decision: neither has a source. Six links, no planned migration: `M36-operator-console.md` |
| M39 | The phone layout is decided once, and Caesura installs like an app | **Proposed 2026-10-06, scoped 2026-10-07**: all six decisions answered as recommended. From `docs/candidates.md`; see *2026-10-06 — proposed: M37 to M47*. The phone/tablet design critique and its KIs, the phone conflict state, PWA install tiers 1–2: `M39-the-phone-is-decided.md` |
| M40 | A big change is reviewed whole, taken whole, and undone whole | **Proposed 2026-10-06, scoped 2026-10-09**: all seven decisions answered as recommended. From `docs/candidates.md`; see *2026-10-06 — proposed: M37 to M47*. Accept all as one batch, named snapshots, assistant planning turns write suggestions (ADR-067); three parts after a phase-0 PR: `M40-a-big-change-is-one-change.md` |
| M43 | A trip's notebooks keep up with their templates | **Proposed 2026-10-06, not scoped. Moved last 2026-10-12**, behind M49, by Mitchell: nothing it fixes is hurting today. (This row said *"scoped 2026-10-07: all six decisions answered as recommended"* until 2026-10-10. That was a bulk edit; the milestone file never recorded an answer.) From `docs/candidates.md`; see *2026-10-06 — proposed: M37 to M47*. **Shrunk 2026-10-17** by Mitchell: seed back-fill and reset were already built (2026-09-27), so what is left is the Overview's identity in the database, the derived Overview title, and the `open` widget's design and filters: `M43-notebooks-keep-up.md` |
| M49 | A cover can come from anywhere, and be framed where you want it | **Scoped 2026-10-25 with Mitchell; current.** Decisions 4–10 answered as recommended (ADR-081); four parts plus part 0. **Proposed 2026-10-12**; decisions 1–3 answered by Mitchell at minting. On his ask; see *2026-10-12 — reordered and minted*. Placed after M48, ahead of M43 and M44. A trip's cover set, read and cleared on the public API from any image URL (referenced, never stored), and a cover's crop repositioned in the API and by drag on the band. Absorbs the *Reposition a cover* candidate: `M49-covers-from-anywhere.md` |
| M51 | The front door tells the story | **Closed 2026-10-22, gate 11 of 11**, on Mitchell's ruling, with the landing's signup path and the production link check left as KI-2026-10-22-a and KI-2026-10-20-c. **Proposed and scoped 2026-10-20 with Mitchell; current from 2026-10-20**, ahead of M49 (which waits) and M48 (parked). From the top entry of `docs/candidates.md`, placed by a design review with three directions and two motion prototypes; see *2026-10-20 — minted: M51, ahead of M49*. The landing becomes a sea of the library's 148 public days as real Discover cards, from a build-time snapshot, with the story's moments rising out of it; a pricing ladder; names on stops (`addedBy`, `openapi.json`); a day picker over `startingAt` (ADR-050); the landing's path into onboarding. Nine parts (the plan is deleted): `M51-the-front-door-tells-the-story.md` |
| M52 | The trip comes with you: a notebook for today, and an assistant the group can ask | **Closed 2026-10-24, gate 13 of 13**, the [walk] ticked on Mitchell's word; PR 546 (part 12's follow-up) open at the close. **Scoped 2026-10-23. Placed after M51, ahead of M49.** Nothing changes today when a trip starts. From 3 days before the trip through its last day, its Overview swaps to a seeded *During the trip* notebook whose `dateScope: "today"` setting narrows every widget left without a day, plus new widgets (now and next with Directions, flights, the group chat, day-of Ask prompts). Flight legs gain a flight number (the `booking` object stays in M44). The assistant learns what time it is, gets a near-me-now tool only while the trip is under way, and can be `@assistant`-ed in the trip chat on the asker's paid plan and quota, its proposals accepted only by the asker. No live flight status, push, offline or device location: `M52-the-trip-comes-with-you.md` |
| M55 | Claude connects to Caesura as you, and can publish what it plans | **Closed 2026-10-28, gate 17 of 17** (part 0 PR 613). Scoped 2026-10-27 with Mitchell. **Placed ahead of M43** the same day (see *2026-10-27 — placed: M55 ahead of M43*). Proposed 2026-10-27 by Mitchell; see *2026-10-27 — minted: M55, a connector Claude signs in to*. A remote MCP server at `/api/mcp` (streamable HTTP, stateless) and our own OAuth 2.1 authorization server in front of it (PKCE S256, open dynamic client registration and client metadata documents, rotating refresh tokens), so Claude, Claude Code and other MCP clients can act as the signed-in person through M22's two gates. Every API secret moves to HMAC-SHA256 and existing `tc_` tokens are revoked. Tools adapt existing v1 routes; Connected apps with Disconnect. All eleven decisions answered (D7, D8's hashing, D11 changed; D10 widened to *"via <client>"* labels and withdrawn the same day, the labels to `docs/candidates.md`); ADR-083; planned as five parts plus part 0, built as eleven: `M55-claude-connects-as-you.md` |
| M56 | New trip is a picker, and the assistant never strands you | **Scoped 2026-10-30, current.** Minted and placed **ahead of M43** the same day by Mitchell; see *2026-10-30 — minted and placed: M56*. From `docs/specs/2026-10-29-new-trip-picker-and-trip-builder-design.md`, reshaped by D1 (create first: no pre-trip builder). New trip becomes five picker pages and Review with no free text, one icon per tag, world place search for signed-in callers, pace and tags on the trip, and the assistant gains `ask_user`, `show_options` and `hand_off` with a generated capability block, so every *I can't* carries a button. ADR-084; six parts plus part 0: `M56-new-trip-is-a-picker.md` |
