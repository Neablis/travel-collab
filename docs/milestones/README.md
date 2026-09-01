# Milestones and gate discipline

Work proceeds through gates in order. A milestone is done when its **gate**
passes: a demo script runs clean, the test suite (including all prior
milestones' e2e scripts) is green, and a short retro note ("what we learned,
what changed") is committed. No building ahead of the current milestone.

Each milestone gets its own file here with an exit checklist before work on it
begins. Scope inside a milestone can flex; a gate definition changes only by
explicit decision from Mitchell, recorded in the file.

## Gate-close checklist (run in one commit when a milestone's gate passes)

A milestone's gate passing is the single trigger for flipping **every** status
flag, in **one commit** — never a trailing manual step (that is how M2 stayed
unticked). When the deployed gate demo passes:

1. Tick the milestone in `TODO.md`.
2. Check every exit-gate box in the milestone's own file (`docs/milestones/`).
3. Append the retro note to that milestone file.
4. Bump **Current milestone** at the bottom of this file — the single source of
   truth (`AGENTS.md` points here, so this is the *only* place the number
   changes).

The *next* milestone's plan opens with a preflight that re-checks this list
(`TODO.md` standing tasks), so a missed flag is caught at the next kickoff.

## Phase 1 — Full single-player product

**Phase gate: Mitchell plans a real upcoming trip end-to-end with the product
and needs no other tool.** Deliberate trade-off (decided 2026-07-07): Phase 1
has zero network effects — validation is personal utility only — in exchange
for collaboration later landing on a product people already want to join.

| # | Name | Scope |
|---|---|---|
| M0 | Walking skeleton | Monorepo, CI, Google auth, event store, one command→event→projection→UI thread, deployed to Vercel |
| M1 | Planning core | Trips, days, activities; drag-to-reschedule; soft-conflict engine (overlaps, impossible geography) |
| M2 | History & time travel | History UI, undo, revert-to-state — proves the event-sourcing bet before stakes rise |
| M3 | Place & time | Map view (MapLibre), timeline view, calendar views; date-anchored events whose anchors produce soft conflicts when dates shift. *(The anchor UI is retired in M8; the domain rules stay — see that file.)* |
| M4 | Money & lenses | Cost items on activities/days/flights with rollup to trip; output lenses: itinerary, daily, full-trip |
| M5 | Design foundations | Tailwind design system: tokens, documented palette, styled primitives and composites, then a re-skin of every existing surface. Answered "is it consistent" — not "is it obvious" (M8) or "is it beautiful" (M10) |
| M6 | Atomic changes | Client/generator-declared command groups committed as one atomic batch, so undo/redo/revert treat them as a single change. Optimistic updates added mid-milestone |
| M7 | Solo delight | Dynamic pages with typed macros, lazily-instantiated templates, a Notebook route outside time-travel, schema-derived constrained AI via Vercel AI Gateway |
| M8 | Make it real | **Done, gate closed 2026-08-08.** Trip lifecycle (name, dates, archive/delete, duplicate — `SetTripName` did not exist before this, PR #21); anchors retired from the UI but kept dormant; Notebook pulled back to plain notes; KI-5 sync indicator. **Interaction design lives here.** *(Core-loop ergonomics — search-to-add, quick add, moving activities — and first-run/empty states trimmed from scope 2026-08-07; see that milestone's file and `TODO.md`'s Candidate ideas.)* |

## Phase 2 — A product worth using

| # | Name | Scope |
|---|---|---|
| M10 | Visual craft pass | **Done, Wave-2 gate closed 2026-08-27.** Executed before M9 (see the 2026-08-08 reorder note below). Wave 1's gate closed 2026-08-10 on a branch; an external review on 2026-08-14 reopened it (the design handoff had moved two generations, and the wave introduced three blocking defects). Wave 2 closed the delta across Phases 0-8 plus 8b; Phase 1b was cancelled unbuilt. The "make it beautiful" pass: a coherent restyle of Home/Trip-plan against the design handoff, plus inert `<Preview>` shells for M9/M11's not-yet-built surfaces. Retro and gate evidence: `M10-visual-craft.md` |
| M16 | The assistant answers questions | **Done, gate closed 2026-08-29.** Approved 2026-08-25 — ADR-022. Originally placed right after M10's gate and before M15; **M15 in fact closed its own gate first (2026-08-26), ahead of both M10's Phase 9 gate and M16** — see the 2026-08-26 reorder note below. M16 still runs before M11-M14. The sidebar styled to `SPEC.md` §9's *docked* presentation (a flex sibling, not a scrim overlay; both `<Preview>` blocks deleted), then a **read-only tool-using agent** on its own endpoint — one question, one answer, scoped to the selected day or the trip — then analytics on which tools get called and how many calls an answer costs. The command path is untouched. Exists because the AI endpoint today is a *command* endpoint and structurally cannot answer a question: `M16-assistant-read-agent.md` |
| M17 | Account customization | **Approved 2026-08-26; re-scoped and placed 2026-08-29, after M18b.** The `users` table and the identity decision were removed from its scope — M11 link 1 shipped both (ADR-025) — leaving the preferences half. Opened by Mitchell reviewing SPEC §12: *"Skip on C5/C6/C7 and make a future milestone, account customization. We will need a new DB table, but i also think we are getting close to just wanting a user table rather than relying on the google auth jwt."* Account settings Sheet (name, email, home airport), distance units at **account** scope through one `kmLabel`, and home-time-on-hover. All three land on the same absence: the schema is `events`/`trip_summaries`/`trip_details`/`pages` — there is no user row. The real question is whether the product should own its identity rather than lean on the provider token: `M17-account-customization.md` |
| M18 | A stop knows what kind of thing it is | **Done, gate closed 2026-08-29.** Ran after M10's Wave-2 gate and M11, before M16. **Widened to carry `tags` (KI-47) as well as `kind`**, on Mitchell's call — *"i dont want to do KIND and TAGS right now, but we can put it in a soon milestone"* — because the two are one contract change, one migration and one backfill decision. A stop has no `kind` — `booked`/`hold`/`idea`/`transit` lives in **note text** (`db-seed.ts` folds it there and says so). Began as one cosmetic tile; SPEC §12 made it load-bearing. **At the gate, that same SPEC §12 travel-day split was built, walked and removed** — it depended on how the fixture tagged cities, so the Calendar groups by city alone and the transition moved to the day label. Shipped: `act.badge`, tag chips, both editor pickers, the home-hero tile, `N to book`. Tag focus carved out as M18b: `M18-stop-kind.md` |
| M18b | Tag focus | **Done, gate closed 2026-08-30.** Approved 2026-08-29 and placed the same day, immediately after M16; built and closed the next day, its six behaviours green on `test:e2e:ci-like` and the deployed half walked by Mitchell on PR #91's preview. Carved out of M18's gate on the same terms M11b left M11's: M18 lands both fields, every surface that reads `kind`, and tag chips that render and can be set — M18b lands the behaviour the chips drive. SPEC §11's focus dims off-tag stops to 32% across Timeline, Day columns, Calendar and Map (Calendar instead shows `N of M match`, dimming a no-match card to 0.28). It was the only part of M18 needing shared state above the lens switch, its Calendar rule is a second design, and no M18 gate box measured it. Scope and exit gate are already written, so unlike M11b it needs only a place: `M18b-tag-focus.md` |
| M9 | AI as a planning partner | **Moved to last, after M14 — ADR-022 (2026-08-25).** Thread contract, streaming, propose→review→approve before commit, a refine turn, and grounding (`SearchPlaces`). The substrate from M7 is sound; the interaction is what is missing. **Conversation design lives here.** M16 now builds the read half first, so this milestone adds write tools and conversation *to a working agent* and inherits its eval harness rather than building one |

## Phase 3 — Outward

| # | Name | Scope |
|---|---|---|
| M11 | Fork & remix / Sharing and invites | **Done, gate closed 2026-08-28** — eight of eight boxes, e2e 46/46 twice against a production build, and the invite→accept→edit and pinned-share flows walked on a Vercel preview as two actors. **Playbooks/templates was carved out at the gate by Mitchell and is M11b — scoped and placed 2026-08-30.** Links 1-6 landed 2026-08-28 (PR #71), remediated by PR #78; retro and gate evidence in `M11-sharing-and-invites.md`. Scheduled 2026-08-27 ahead of M18's remaining surfaces and M16, and **absorbed M13's invites/roles/revocation scope** in the same decision. Clone-with-lineage, day- and trip-level templates, share links with read access. Moved ahead of Collaboration on 2026-07-28 — this is the "social" thing actually wanted, and it needs no realtime transport. **Also owns the landing page's "Look around a real trip" CTA** (2026-08-23 design sync): it needs unauthenticated read of a real trip, which is this milestone's share-link work and nothing smaller |
| M11a | An invite gate on the front door | **Scoped and placed 2026-08-30**, running after M17 and **before M11b**. Created out of M11b's scoping review the same day: M11b publishes user-authored text and leaves reporting to M12, which rests on Mitchell's call that the platform is invite-gated — *"we will gate on who we invite to platform... we need a community before its a issue"* — and today it is not, since any Google account that reaches `/signin` gets one. **Three ways through, evaluated only when there is no `users` row**: a pending M11 trip-invite token (Mitchell's call — a trip invite *is* an invitation, or M11's invite→accept flow breaks for the new collaborators it exists to serve), a **reusable super code**, and **single-use codes** in a new `invite_codes` table. Small because most of it exists: `users` (ADR-025) already records who has been here, so "never been to the app" is "has no `users` row", and `recordSignIn` is already a fail-closed boolean landing on the designed `/signin?error=` screen. The one real problem is that OAuth leaves the site, so the code rides a short-lived httpOnly cookie across the round trip. Needs a migration, and the migration needs a dispatch: `M11a-invite-gate.md` |
| M11b | Playbooks becomes a public library | **Scoped and placed 2026-08-30**, running after M17 and immediately before M12. Carved out of M11's gate 2026-08-28 and unplaced for two days because it had no scope — a product decision. The **2026-08-30 design handoff** supplied it: `SPEC.md` §15 / `DRIFT.md` §2b turn Playbooks from a private grid into a discovery surface over other people's days, across four routes — `playbooks` (Discover), `day`, `board` and `profile`, three of them new. **Mitchell drew the scope line short of reviews**: M11b takes all of §15 except reviews and ratings; M12 keeps those plus moderation, which is why M11b sits immediately before it. Eight links — `cities: string[]`, a `GET /cities?q=` endpoint, publishing (private by default, author can unpublish), an adds ledger keyed by (day, trip) without which the board's ranking rule is gameable, and the four routes. Closes DRIFT's **D9** and deletes the last four M11-tagged `<Preview>` shells. Two deltas from the spec text and one precondition — a platform signup gate that does not exist in code — are recorded in: `M11b-playbooks-public-library.md` |
| M12 | Community | Public gallery, discovery, voting, reporting (all trust & safety scope quarantined here). **Narrowed 2026-08-30 by M11b's placement**: the public gallery and discovery are M11b's, and what M12 keeps from `SPEC.md` §15 is **reviews** (the table, stars, the ≤140-char note, the live average, the three review states), **ratings everywhere they surface** (the shared day's 5→1 histogram, the `rating`/`reviewCount` counters, the profile's average, Discover's rating floor filter and its highest-rated / most-reviewed sorts), and moderation |
| M13 | Collaboration | **Narrowed 2026-08-27: invites, roles and revocation moved to M11** — what is left is near-real-time sync (transport ADR due here) and concurrent-edit conflicts as resolvable data. Architecturally: swap the AccessPolicy implementation, broadcast events. The largest remaining architectural lift, so it waits until something needs it |
| M14 | Rich layer | Notion-style pages with embedded community objects (TipTap/Yjs ADR due here), external calendar sync, dogfood-backlog items. The macro vocabulary deferred out of M8 returns here. **Owns the whole Notebook redesign** (`.design-sync/handoff/SPEC.md` §7, routed here 2026-08-23): reading/editing modes, values as chips, the scope × shape insert picker, prebuilt pages, the journal framing — and **repeaters**, which need their own ADR before the milestone opens (see the design-sync review §7) |
| M19 | A cost knows who and what it is for | **Minted and placed 2026-08-31 by Mitchell — runs last, after M9.** Opened by M11b's `preview-registry` sweep: `cost-estimate-state` and `budget-breakdown` were tagged M11, are not M11's, and belong to no existing milestone — *"it does feel very much like a tacked on concept ... splitting cost, cost per person based on whos attached to what activity, better sharing cost in the shared day ui."* The whole model today is `Money = {amountMinor, currency}`, one optional `cost` on an activity and one `budget` on a trip. Five links: a cost's **kind** (unblocks `budget-breakdown`), a cost's **settled-vs-estimate** state (unblocks `cost-estimate-state`), **who an activity is for** (overlaps M13's `add-stop-who` — must land in exactly one), **splits** derived from that, and the **shared-day** presentation. Its anchor finding: `savedDayFacts.budgetPerPerson` was a plain sum of stop costs with nothing to divide by, so a shipped field asserted a per-person meaning it did not have — **the name was removed on pull request 104** (it is `totalCost` now, dividing by nothing and claiming nothing); the cost model it was standing in for is still entirely M19's: `M19-cost-model.md` |
| M15 | Front door | **Gate closed 2026-08-26, PR #56.** Approved 2026-08-23 (ADR-021); ADR-022 (2026-08-25) placed it after M16, but it in fact **ran ahead of both M10's Phase 9 gate and M16** — decided by Mitchell 2026-08-26, superseding ADR-021/ADR-022's stated ordering (see the reorder note below). The unauthenticated surface the product had never had: landing page, custom Google sign-in and sign-up screens replacing NextAuth's default, and the header account menu (already shipped in M10 Phase 8b). The designed first-run screen was dropped — `NewTripWizard`'s "Create empty" already creates a trip from a name alone. Scope, exit gate and retro: `M15-front-door.md` |

- **Restructure (2026-07-28), from the Phase 1 gate review.** The gate had not
  been met and the reason was structural, not cosmetic: a trip cannot be renamed
  or deleted. **M8 "Make it real"** was inserted to close that floor, **M9 "AI as
  a planning partner"** and **M10 "Visual craft pass"** were added, and
  **Fork & remix moved ahead of Collaboration** — the wanted "social" feature is
  cloning and sharing, which needs no realtime transport, while Collaboration is
  the biggest remaining architectural lift. Renumbering:

  | was | is now |
  |---|---|
  | M8 Collaboration | **M13** |
  | M9 Fork & lineage | **M11** (Fork & remix) |
  | M10 Community | **M12** |
  | M11 Rich layer | **M14** |

  Forward pointers were updated in the ADRs, the foundation spec, the
  guidelines, and `known-issues.md` in the same change. **Closed milestone files
  and closed per-milestone design specs were deliberately NOT rewritten** — they
  were true when written, and this table is how to read them.

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

Placement notes (decided 2026-07-07):
- The notes page appears twice on purpose: basic solo notes in M7; embeds and
  community objects in M11.
- Internal calendar UX (drag, holiday anchors) is M3; *external* calendar sync
  is M11 — the original vision bundled these, they are different features.
- M2 precedes M3–M7 deliberately: prove history/revert works before investing
  in breadth on top of it.
- **Renumbering (2026-07-10):** M5 "Atomic changes" was inserted before Solo
  delight; milestones formerly M5–M9 shifted +1. Forward milestone-pointers in
  the ADRs, foundation spec, and guidelines were updated to match in the same
  change.
- **Renumbering (2026-07-11):** M5 "Design foundations" was inserted after
  Money & lenses (decided by Mitchell mid-M4: base functionality first, then a
  design-system pass before further UI breadth, so the polished single-player
  baseline can guide collaboration UX). Milestones formerly M5–M10 shifted +1
  (Atomic changes is now M6, …, Rich layer M11). Phase 1 is now M0–M7. Forward
  milestone-pointers updated to match in the same change.

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

- **Design sync (2026-08-23).** The design bundle is now committed in-repo at
  `.design-sync/handoff/` — `design/Trip Planner Redesign.dc.html` (3,524 lines),
  `SPEC.md`, `DRIFT.md`, a Japan seed export. It is the **only readable source of
  truth**: generations 1–3 (1,412 / 2,048 / 2,623) lived at a `~/Downloads` path
  no session can reach, so generation-diffing is over — reconcile design against
  *code*, using `apps/web/src/lib/preview-registry.ts` as the spine for "not
  built yet", the way `DRIFT.md` does.

  The sync brings net-new surfaces (landing page, sign-in/sign-up, first-run,
  account menu, a full Notebook redesign) and renames the product to **Caesura**.
  Full reconciliation, the drift questions, and the per-item routing:
  `docs/design-feedback/2026-08-23-design-sync-review.md`. Headline routing —
  **M15** takes landing/auth/first-run/account menu; **M14** takes the Notebook
  redesign and the repeaters ADR; **M11** takes the landing page's "Look around a
  real trip" CTA; `TripSummary.startDate` is its own reviewed contract step.

  **Decided 2026-08-23.** M15 is approved and executes after M10's gate, before
  M9 (**ADR-021**). Two additions to M10's gate are approved and recorded in
  `M10-visual-craft.md`: **Phase 8b** (five presentational items — the Caesura
  rename, a working sign out, a three-state save indicator, the sync-failure
  banner, calendar month blocks) and **Phase 1b** (the header adopts `SPEC.md`
  §1's focus-scope model, as an explicit revisit of the merged Phase 1). Three
  questions stay open — start-only trip dates, first-run vs. the four-step
  wizard, and whether the landing copy may sell M11/M12 — see the review's §8.

Current milestone: **M17 — Account customization**
(`M17-account-customization.md`), as of **2026-08-31, when M11a's and M11b's
gates both closed** — M11a nine of nine with its admission paths walked on
production, M11b eleven of eleven with the two-actor publish walk and the
`cities` backfill. Order from here:
`M11a ✓ → M11b ✓ → M17 → M12 → M13 → M14 → M9 → M19`.

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
