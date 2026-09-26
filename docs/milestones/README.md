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

> **`pnpm milestone close <id>` performs steps 1, 4 and 6 and refuses to do
> them wrong.** It will not close a milestone with open exit-gate boxes, will
> not proceed on a parse that found nothing, will not write anything
> without `--confirm` — it prints a diff first — and **reads which milestone
> becomes current from `TODO.md`'s row order**: the next unticked milestone row,
> skipping rows marked PAUSED. `--next <id>` is optional and only asserts that
> answer; if it disagrees with the rows it refuses and tells you to move the
> row. Steps 3 and 5 are prose and stay yours; it lists them rather than
> inventing them.
>
> **A reorder therefore moves `TODO.md`'s rows** (and is recorded below, under
> its date, as every reorder is). That is the choice that closed
> `KI-2026-09-21-a` on 2026-09-24: before it, `TODO.md` said "read the marker,
> not the position", so row order carried nothing, the script had to require
> `--next`, and closing M26 its row-order guess was M12 when the order was
> `M26 → M13 → M12`.
>
> This is automated because the list is what kept failing. Step 5 was *added*
> to this checklist after M11a's and M11b's gate-close commits both missed it,
> and on 2026-09-21 `TODO.md`'s header still opened *"M21 is the current
> work"* four milestones after M21 closed. A sixth manual step would be one
> more thing to forget.

1. Tick the milestone in `TODO.md`.
2. Check every exit-gate box in the milestone's own file (`docs/milestones/`).
3. Append the retro note to that milestone file.
4. Bump **Current milestone** at the bottom of this file — the single source of
   truth (`AGENTS.md` points here, so this is the *only* place the number
   changes).
5. **Update `docs/STATUS.md`'s "Where the work is right now" and "Next
   action".** *(Added 2026-09-01.)* It was missing from this list, and the cost
   was measured: neither M11a's nor M11b's gate-close commit touched it, so the
   file `CLAUDE.md` tells every session to read **first** spent two gates
   claiming both were still open PRs in review. STATUS.md's own header promises
   it is "updated at every milestone boundary" — this step is what makes that
   true. Keep it to the pointer; the narrative belongs in the milestone file.

6. **Delete the `docs/candidates.md` entries this gate absorbed.** Entries
   annotated *"<M>'s gate deletes this entry at close"* are deleted by
   `pnpm milestone close`. This was already the stated rule — see the
   2026-09-18 note's *"annotated in place and deleted at those gates"* — and
   it was skipped: M23's entry survived its own gate closing on 2026-09-19 and
   was still there two days later. An entry that says it is *"kept here only
   for the reasoning"* is **scoped**, not placed, and is never auto-deleted.

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
| M17 | Account preferences | **Done, gate closed 2026-09-11.** Three of three live boxes; box 3 (home time on hover) was amended out 2026-09-01. Built in PRs #111 and #112 and **in production since 2026-09-02** — the gate simply went nine days unconvened while other work merged, which is the subject of its retro. **Approved 2026-08-26; re-scoped and placed 2026-08-29, after M18b.** The `users` table and the identity decision were removed from its scope — M11 link 1 shipped both (ADR-025) — leaving the preferences half. Opened by Mitchell reviewing SPEC §12: *"Skip on C5/C6/C7 and make a future milestone, account customization. We will need a new DB table, but i also think we are getting close to just wanting a user table rather than relying on the google auth jwt."* Account settings Sheet (name, email, home airport), distance units at **account** scope through one `kmLabel`, and home-time-on-hover. All three land on the same absence — **narrowed 2026-09-01**: the claim that "the schema is `events`/`trip_summaries`/`trip_details`/`pages`, there is no user row" has been false since ADR-025. The schema is twelve tables and `users` is one of them; what is missing is **preference columns on it**. `users.name` already exists, so "resolve `who` to a display name" is closer to wiring than building. The identity question this milestone was approved to answer is answered: `M17-account-customization.md` |
| M18 | A stop knows what kind of thing it is | **Done, gate closed 2026-08-29.** Ran after M10's Wave-2 gate and M11, before M16. **Widened to carry `tags` (KI-47) as well as `kind`**, on Mitchell's call — *"i dont want to do KIND and TAGS right now, but we can put it in a soon milestone"* — because the two are one contract change, one migration and one backfill decision. A stop has no `kind` — `booked`/`hold`/`idea`/`transit` lives in **note text** (`db-seed.ts` folds it there and says so). Began as one cosmetic tile; SPEC §12 made it load-bearing. **At the gate, that same SPEC §12 travel-day split was built, walked and removed** — it depended on how the fixture tagged cities, so the Calendar groups by city alone and the transition moved to the day label. Shipped: `act.badge`, tag chips, both editor pickers, the home-hero tile, `N to book`. Tag focus carved out as M18b: `M18-stop-kind.md` |
| M18b | Tag focus | **Done, gate closed 2026-08-30.** Approved 2026-08-29 and placed the same day, immediately after M16; built and closed the next day, its six behaviours green on `test:e2e:ci-like` and the deployed half walked by Mitchell on PR #91's preview. Carved out of M18's gate on the same terms M11b left M11's: M18 lands both fields, every surface that reads `kind`, and tag chips that render and can be set — M18b lands the behaviour the chips drive. SPEC §11's focus dims off-tag stops to 32% across Timeline, Day columns, Calendar and Map (Calendar instead shows `N of M match`, dimming a no-match card to 0.28). It was the only part of M18 needing shared state above the lens switch, its Calendar rule is a second design, and no M18 gate box measured it. Scope and exit gate are already written, so unlike M11b it needs only a place: `M18b-tag-focus.md` |
| M9 | The assistant cites what it plans | **Retitled 2026-09-01** (was "AI as a planning partner") after an audit against `main`: **four of its seven scope items are already shipped** — streaming, propose→review→approve, refinement within a session, and honest unknowns — and **three of its six gate boxes are already satisfied**. What remains is three things: **grounding** (`SearchPlaces` → `placeRef`, KI-81/KI-15), **conversation durability** (there is no conversation table, so a reload loses the thread), and **an eval/replay harness** (KI-11, inherited from M16's gate). **Conversation design still lives here.** Placed last by ADR-022 (2026-08-25) on two grounds — polish first, sharing first — **both of which have since been met**, and the placement has not been re-examined since; the audit recommends moving it to after M17. The practical cost of last: `ai-live` defaults off and grounding is what would let it be turned on, so the largest built feature in the product is dark. **Paused 2026-09-13, not cancelled** — Phase 0 (the assistant kernel, ADR-043) completed 2026-09-11 and ticked no gate box by design; the three real pieces of work were untouched at the time, and M9 keeps its place immediately after M21 rather than returning to the back of the queue. **All three were built 2026-09-16** (grounding, durability by `localStorage`, the replay harness — `M9-ai-planning-partner.md`); what is left of the gate is a live model call and the browser walks that rest on it: `docs/reviews/2026-09-01-milestone-audit.md` |

## Phase 3 — Outward

| # | Name | Scope |
|---|---|---|
| M11 | Fork & remix / Sharing and invites | **Done, gate closed 2026-08-28** — eight of eight boxes, e2e 46/46 twice against a production build, and the invite→accept→edit and pinned-share flows walked on a Vercel preview as two actors. **Playbooks/templates was carved out at the gate by Mitchell and is M11b — scoped and placed 2026-08-30.** Links 1-6 landed 2026-08-28 (PR #71), remediated by PR #78; retro and gate evidence in `M11-sharing-and-invites.md`. Scheduled 2026-08-27 ahead of M18's remaining surfaces and M16, and **absorbed M13's invites/roles/revocation scope** in the same decision. Clone-with-lineage, day- and trip-level templates, share links with read access. Moved ahead of Collaboration on 2026-07-28 — this is the "social" thing actually wanted, and it needs no realtime transport. **Also owns the landing page's "Look around a real trip" CTA** (2026-08-23 design sync): it needs unauthenticated read of a real trip, which is this milestone's share-link work and nothing smaller |
| M11a | An invite gate on the front door | **Scoped and placed 2026-08-30**, running after M17 and **before M11b**. Created out of M11b's scoping review the same day: M11b publishes user-authored text and leaves reporting to M12, which rests on Mitchell's call that the platform is invite-gated — *"we will gate on who we invite to platform... we need a community before its a issue"* — and today it is not, since any Google account that reaches `/signin` gets one. **Three ways through, evaluated only when there is no `users` row**: a pending M11 trip-invite token (Mitchell's call — a trip invite *is* an invitation, or M11's invite→accept flow breaks for the new collaborators it exists to serve), a **reusable super code**, and **single-use codes** in a new `invite_codes` table. Small because most of it exists: `users` (ADR-025) already records who has been here, so "never been to the app" is "has no `users` row", and `recordSignIn` is already a fail-closed boolean landing on the designed `/signin?error=` screen. The one real problem is that OAuth leaves the site, so the code rides a short-lived httpOnly cookie across the round trip. Needs a migration, and the migration needs a dispatch: `M11a-invite-gate.md` |
| M11b | Playbooks becomes a public library | **Scoped and placed 2026-08-30**, running after M17 and immediately before M12. Carved out of M11's gate 2026-08-28 and unplaced for two days because it had no scope — a product decision. The **2026-08-30 design handoff** supplied it: `SPEC.md` §15 / `DRIFT.md` §2b turn Playbooks from a private grid into a discovery surface over other people's days, across four routes — `playbooks` (Discover), `day`, `board` and `profile`, three of them new. **Mitchell drew the scope line short of reviews**: M11b takes all of §15 except reviews and ratings; M12 keeps those plus moderation, which is why M11b sits immediately before it. Eight links — `cities: string[]`, a `GET /cities?q=` endpoint, publishing (private by default, author can unpublish), an adds ledger keyed by (day, trip) without which the board's ranking rule is gameable, and the four routes. Closes DRIFT's **D9** and deletes the last four M11-tagged `<Preview>` shells. Two deltas from the spec text and one precondition — a platform signup gate that does not exist in code — are recorded in: `M11b-playbooks-public-library.md` |
| M12 | Reviews and moderation | **Retitled 2026-09-01** (was "Community"): the gallery and discovery halves of that name shipped in M11b, so the title promised a milestone that no longer exists. Originally public gallery, discovery, voting, reporting (all trust & safety scope quarantined here). **Narrowed 2026-08-30 by M11b's placement**: the public gallery and discovery are M11b's, and what M12 keeps from `SPEC.md` §15 is **reviews** (the table, stars, the ≤140-char note, the live average, the three review states), **ratings everywhere they surface** (the shared day's 5→1 histogram, the `rating`/`reviewCount` counters, the profile's average, Discover's rating floor filter and its highest-rated / most-reviewed sorts), and moderation. **Scoped 2026-09-01** — it had no file and no exit gate until then: `M12-reviews-and-moderation.md` **Widened 2026-09-09 on Mitchell's request: link 7 adds country search beside city search in Discover's box** — one typeahead returning both kinds, labelled, either selectable. It is the one part of M12 that is not trust and safety, and it **amends the milestone's own "nothing that changes what M11b ships"**; the file names the alternative (carve it out, the M11b way) if that widening is unwanted. Two things a planner needs: it is a **second migration** (`saved_days.countries`, a `text[]` snapshot on ADR-029's terms), and it has a **data prerequisite** — the content library carries `countryCode` on none of its 1,375 locations, because `geocode-content.py` writes back coordinates only, though its own `learned_countries()` already computes the answer. |
| M13 | Collaboration | **Done, gate closed 2026-09-22 — 10 of 10**, merged as `#201` (`99f32d3`). The last box, the two-actor browser walk, is ticked **on Mitchell's attestation**, not by an agent: the preview answers 402 without the owner's `trip.collaborators` entitlement. It also shipped an **unplanned sixth piece — notebooks joining the event log** (page writes went straight to the `pages` table, so a save never moved `headSeq` and the M13 poll was correctly told nothing had happened); the retro is in the milestone file. *(Everything from here to the end of this row is the scoping as written before the gate, kept for the reasoning rather than as a description of the result.)* **Narrowed 2026-08-27: invites, roles and revocation moved to M11** — what is left is near-real-time sync (transport ADR due here) and concurrent-edit conflicts as resolvable data. **It also owns per-stop attribution** (`add-stop-who` and `rack-provenance` in `preview-registry.ts`) — *no field records who a stop is for* — and **M19's link 3 depends on this milestone landing that field**, which is the whole reason M19 is placed after it. If M13 ships without it, that link returns to M19. Architecturally: swap the AccessPolicy implementation, broadcast events. The largest remaining architectural lift, so it waits until something needs it. **Scoped 2026-09-01** — it had no file and no exit gate until then; the transport ADR is a prerequisite, and link 3 (the re-prediction reducer KI-90 names) closes the KI-5 optimistic-loss class: `M13-collaboration.md` |
| M14 | Rich layer | **Code merged 2026-09-24, ahead of M24** (#222, #223, #226, #221). **Gate 17 of 22.** The five open boxes all need Mitchell: the insert Sheet design call, ADR-052 acceptance, the real-service weather walk, the six-widget walk, and the retro. *(**Updated 2026-09-24** — the rest of this cell is the 2026-09-01 scoping and is behind the milestone file, which was rescoped twice on 2026-09-03 to SPEC §18's widget model and widened 2026-09-18 with link 10, saved notebook templates. **External calendar sync is dropped** (Mitchell, 2026-09-24); embedded community objects and a TipTap/Yjs ADR are out of scope per the file — TipTap is already the editor. Ghosts are Editing-only, and the `days`/`trip` input types are retired.)* Notion-style pages with embedded community objects (TipTap/Yjs ADR due here), external calendar sync, dogfood-backlog items. The macro vocabulary deferred out of M8 returns here. **Owns the whole Notebook redesign** (`.design-sync/handoff/SPEC.md` §7, routed here 2026-08-23): reading/editing modes, values as chips, the scope × shape insert picker, prebuilt pages, the journal framing — and **repeaters**, which need their own ADR before the milestone opens (see the design-sync review §7). **Scoped 2026-09-01** — it had no file and no exit gate until then. Two items on this row need a call before it opens: the M8 macro vocabulary, and **external calendar sync**, which has no design, no ADR and no relationship to the Notebook and may deserve its own milestone: `M14-rich-layer.md` |
| M19 | A cost knows who and what it is for | **Minted and placed 2026-08-31 by Mitchell — runs last, after M9.** Opened by M11b's `preview-registry` sweep: `cost-estimate-state` and `budget-breakdown` were tagged M11, are not M11's, and belong to no existing milestone — *"it does feel very much like a tacked on concept ... splitting cost, cost per person based on whos attached to what activity, better sharing cost in the shared day ui."* The whole model today is `Money = {amountMinor, currency}`, one optional `cost` on an activity and one `budget` on a trip. Five links: a cost's **kind** (**shipped 2026-09-26**: "Spend by kind"), a cost's **settled-vs-estimate** state (unblocks `cost-estimate-state`), **who an activity is for** (overlaps M13's `add-stop-who` — must land in exactly one), **splits** derived from that, and the **shared-day** presentation. Its anchor finding: `savedDayFacts.budgetPerPerson` was a plain sum of stop costs with nothing to divide by, so a shipped field asserted a per-person meaning it did not have — **the name was removed on pull request 104** (it is `totalCost` now, dividing by nothing and claiming nothing); the cost model it was standing in for is still entirely M19's: `M19-cost-model.md` |
| M20 | An account knows what it may do | **Done, gate closed 2026-09-14** — 32 of 32 live boxes, built as #174 and #175, migrations 0019/0020 dispatched to production the same day, the console walked on production and the account surfaces on a preview; retro and gate evidence in the milestone file. **Scoped and placed 2026-09-01 — ran after M9's Phase 0, before M21.** The **first commercial milestone**: nothing in the repo had ever described a paid tier, a plan, a price or a payment. Mostly a wiring job on a seam built for it and stubbed since M16 — `modelSelection.ts:88` declares `AiEntitlementCheck`, `:89` stubs it `EVERYONE_IS_ENTITLED`, and `:47` says *"the day a pro-tier check exists it lands inside `isEntitled` below, not as a signature change"*; ADR-019 is explicit that entitlement is **not** a flag. Nine links, the ninth added 2026-09-01 when Mitchell asked for the financial metrics: **an `ai_usage` cost ledger** storing tokens and models rather than dollars, because prices move (DeepSeek's changed mid-scoping) and because `Money`'s integer minor units round a $0.0006 request to **zero cents** — the KI-1/KI-14/`budgetPerPerson` defect class on its third recurrence. It moved out of M21 deliberately: M21 has to choose prices and M20's link 5 has to choose per-tier ceilings, and both are guesses without it, while the ledger itself needs no Stripe. It carries the `/ask` step-metering fix with it. Its four rules: **a plan is a set, not a rank** (Mitchell: tiers are *"not necessarily subsets"*, so copying `accessPolicy.ts:11`'s `RANK` is the obvious move and the wrong one); **trials, referral rewards and admin boosts are one time-bounded grant with three `source` values**, not three features; entitlements **resolve per request from the database**, never from the JWT (a downgrade must bite before a token refreshes); and — added 2026-09-01 on Mitchell's requirement that prices stay tweakable *"especially in the early days"* while purchases are honoured — **a plan's contents are versioned data, not code, and a purchase pins a version**. `plan_versions` is immutable and append-only, so changing a price or a term **publishes a new version** and what someone already bought is untouched until an explicit admin *migrate to version N*; the contracts package keeps the entitlement vocabulary, the rows own the offers. That is also what makes pricing changeable **without a deploy**. Free keeps trip planning entire; AI and inviting collaborators are paid. **It takes no money** — Stripe is M21, and the admin grant UI is what makes this provable without it. Plans are `free`, `plus` and `premium`, and **defined by enumeration, never by extension** — Mitchell, 2026-09-01: *"to an end user it should look like a nested ladder, but for architecting guidance it should look like split access, where they can own different things that aren't inherited from the previous tier"*, so the three happen to nest and nothing in code may know it; the ladder is presentation only. Four decisions by Mitchell the same day: on lapse granted memberships **cap at `viewer` on read**, never written to `trip_memberships`, so resubscribing restores everyone with zero writes; every account existing at migration time gets a **permanent `founder` grant**; the **trial grants `plus` at signup**, so collaboration is never trialled; and a **referral earns one month of the tier the referrer already holds**, which means a free account earns nothing and most of the abuse surface disappears with it. Needs a migration and an ADR adding an **Entitlements** module to `AGENTS.md`'s map — **that ADR is written and accepted: ADR-045**, and the map row landed with it. **Reordered 2026-09-13 on Mitchell's call: this is the CURRENT milestone**, running ahead of M9's remaining work; M20's own *"M9, and it must be closed"* prerequisite is superseded, with the cost accepted on the record in the 2026-09-13 note below. Kickoff plan: `docs/plans/2026-09-13-M20-M21-commercial.md`: `M20-account-tiers-and-entitlements.md` |
| M21 | An account can pay for itself | **Done, gate closed 2026-09-19** — 17 of 17; the last six boxes ticked **on Mitchell's attestation** that he walked them and they worked, not on agent-recorded evidence (see the 2026-09-19 note below and the retro in the milestone file). **Scoped and placed 2026-09-01, immediately after M20.** Stripe checkout, the webhook that is the **sole writer** of subscription state, the customer portal, and failed-payment handling. **Adds no entitlement and no gate** — if its diff touches `modelSelection.ts`, `quota.ts` or `members.ts`, the split has failed. Separate from M20 for three reasons: M20 is provable end to end with no external service and this is not; a hand-grant path is permanent infrastructure (comping, trials, disputes) rather than scaffolding; and the blast radius here is money, where a webhook mistake charges someone twice or grants access nobody paid for, silently. Signature verification, idempotency under Stripe's retries, and out-of-order tolerance are each a gate box, as is *no card number ever reaches this application*. Cancelling lapses through **M20's resolver** — no second downgrade path to keep in sync. **Link 6 is the revenue half of the unit economics**, against M20's cost ledger: MRR, ARPU reported twice and labelled (all accounts vs paying accounts, which diverge badly once founder/referral/trial grants exist), trailing-30-day margin per account, and an *accounts that cost more than they pay* list **segmented by grant source** — a comped account is underwater by construction, and unsegmented those swamp the list and make the metric worthless. **Mitchell owes one decision before it opens: the plans and their prices** — M20 names plans without pricing them — **decided 2026-09-13: `free` $0, `plus` $9/month, `premium` $19/month**, so this milestone's one owed decision is closed before it opens. **Reordered 2026-09-13 on Mitchell's call: it runs immediately after M20 and ahead of M9's remaining work**, both placed by the note below: `M21-subscriptions-and-billing.md` |
| M15 | Front door | **Gate closed 2026-08-26, PR #56.** Approved 2026-08-23 (ADR-021); ADR-022 (2026-08-25) placed it after M16, but it in fact **ran ahead of both M10's Phase 9 gate and M16** — decided by Mitchell 2026-08-26, superseding ADR-021/ADR-022's stated ordering (see the reorder note below). The unauthenticated surface the product had never had: landing page, custom Google sign-in and sign-up screens replacing NextAuth's default, and the header account menu (already shipped in M10 Phase 8b). The designed first-run screen was dropped — `NewTripWizard`'s "Create empty" already creates a trip from a name alone. Scope, exit gate and retro: `M15-front-door.md` |
| M22 | An account can build on the API | **Done, gate closed 2026-09-19** — 19 of 19; the last box, the preview walk, ticked **on Mitchell's attestation** that he walked it and it worked, not by an agent (see the 2026-09-19 note below and the retro in the milestone file). **Placed 2026-09-16 by Mitchell — runs after M21, before M12**, and was the **current milestone** from then until 2026-09-18. A public REST API and account-generated API tokens, scoped to the account or to named trips, with create and revoke. All five phases landed 2026-09-16 and **18 of 19 exit-gate boxes were ticked** that day; the one left open needed a browser walk on a Vercel preview, and what blocked it was **`ADMIN_USER_IDS`** (`KI-2026-09-16-d`): it is injected at build, so no account reachable from a browser can be granted `api.tokens` there. *(This row said `API_TOKEN_PEPPER` until 2026-09-19. That was wrong — see the 2026-09-19 note below.)* Three boundaries fixed at placement: **user accounts only, no admin surface, no AI surface** — so a token can never spend model budget. Its entitlement is `api.tokens` on **`premium@v2`**, which raises the pinning problem a `premium@v1` subscriber cannot escape without an admin grant. The design's claim to test at the gate: adding endpoint N+1 costs a declaration and nothing else. *(**This row was missing until 2026-09-18** — M22 was recorded in `TODO.md`, in Current milestone below and in its own file, and not in this table. That is the same defect this file already records against M17 and M19, on its third occurrence.)*: `M22-public-api-and-tokens.md` |
| M25 | A trip is a file you can take with you | **Minted and placed 2026-09-18 by Mitchell — runs immediately after M22**, because it is small and reuses M22's route wrapper while that machinery is fresh. Trip **export and import** as JSON. **The format is `travel-collab/content-bundle/v1` and no third format is created**: the bundle already has a schema, a CI-enforced linter, pure converters and a real importer, so `export → import → compare` is a gate box a test can hold, and it is the shape a person can hand-author — which is what *"similar to the api"* was asking for. A dedicated export format would be a **third vocabulary over the same data**, the drift invariant 5 exists to stop. **An export is a snapshot, never the event log**: the log is `tripId`-bound and re-importing it would violate ADR-028's id-remap rule, the hazard `cloneTrip` exists to handle, so an exported trip loses its history. **Export is free** (Mitchell, 2026-09-18) — *"free keeps trip planning entire"* is M20's line and portability is a trust property, so it needs **no new entitlement, hence no new plan version**, and does not walk into M22's `premium@v1` pinning problem. Import is the larger half: a user upload must **mint fresh ids**, where the content script derives them from keys so a re-import updates rows instead. **Three scoping questions were decided 2026-09-18.** **What it carries: days and activities, nothing else** — no budget, no members, invites or share links, no notebook pages, no lineage or trip status. That is a scope line, not a gap, and it buys a property worth naming: an export cannot carry a copy of a membership list out of the system. It also means an export is a copy of the plan and **not a backup**. **Linting: the schema validates an upload and the content rules do not run on it** — `lint.ts` states rules for authored library content headed for Discover, and three are errors a real trip trips routinely (an empty trip, stops out of clock order after an ordinary board reorder, a backlog item with a time window), so running it would reject real trips on day one. No subset and no second rule set; revisit if a real problem emerges. **Dates: a dated trip exports its real `startDate`, never `startsInDays`**, and a **dateless** trip carries neither anchor — *"we just have offsets, day 1, not January 15th"*. `BundleDay` already has no date field, so the trip anchor relaxes from *exactly one* to *at most one*. The export is a copy of **your** trip rather than a re-usable shape, so a stale export importing as a *past* trip is the correct answer, not a defect to design around. The dateless half is not a one-liner: `tripStartDate`'s `?? 0` currently resolves a missing anchor to *starting today*, so relaxing the refine alone would make a dateless trip silently dated. **Nothing on this milestone is waiting on a decision** — see `M25-a-trip-is-a-file.md` |
| M23 | A playbook can be more than one day | **SHIPPED 2026-09-19** — gate 11/11, #192 merged as `7763913`, migration `0024_saved_day_day_count` dispatched and production verified at 25/25. What actually shipped differs from the plan below in one place worth reading before building on it: **a GAP in `dayIndex` IS an empty day**, so an interior rest day needed no column, and `dayCount` is stored only for the *trailing* empty day a gap cannot reach. ADR-048 carries that and three other decisions, two of them marked ✳ because they contradict a premise in the milestone file. *(Everything from here to the end of this row is the placement as written on 2026-09-18, kept for the reasoning rather than as a description of the result.)* **Minted and placed 2026-09-18 by Mitchell — runs BEFORE M12**, and the placement is the substance: M12 keys reviews, ratings, reporting and moderation to a `saved_days` row, and this changes that row's shape, so running it after means M12's work is revisited. **A saved day generalises into a saved sequence — the same object, not a new one.** The rejected alternative was a separate "collection" over saved-day rows: rejected because a second publishable object either doubles M12's trust-and-safety surface or ships a library with two classes of content having different moderation properties. **The shape is a flat `stops[]` with a per-stop day indicator, not `days: SavedStop[][]`** — Mitchell's call, on migration grounds: existing rows read as "everything on day 1" when the indicator defaults, so the strict `SavedStop.array()` parse at the read boundary keeps working with no versioned read, which a nested array would have forced. **That property has a precondition the scoping found**: the strict parse exists at **two** sites (`savedDays.ts`'s `fromRow` and `playbooks.ts`'s `toDiscoverDay`) and `SavedStop` carries **no `.default()` on any field**, so the additive claim holds only if the indicator lands defaulted at both. **One insert primitive, three callers** — add to an existing trip, start a trip from one day, start a trip from N days, wrapped in M6's atomic command group — which absorbs `TODO.md`'s *"Start a new trip from a saved day"* candidate and answers its open question (one shared primitive, not a second copy of fork): `M23-multi-day-playbooks.md` |
| M24 | A leg knows where it goes and by what | **Gate closed 2026-09-25, 11 of 11** (#229, #230, #232, #233; carried: `KI-2026-09-25-q`). **Minted and placed 2026-09-18 by Mitchell — runs after M12, before M14.** A travel stop gets a **transport mode** and a **second location**, and the map draws a real leg instead of inferring one from its neighbours. `MapLegend.tsx:9` has said the gap out loud since it shipped: *"We model no transport mode"*. **Mode carries its own field and does not inherit from `kind`** — `kind: "transit"` says THAT a stop is travel, `mode` says by what, and they cannot disagree because a mode is legal only on a transit stop, enforced by a `superRefine` rather than by convention. That answers the question `TODO.md`'s *"Transport mode per leg"* has carried since 2026-09-01; M19 link 1 may still answer differently for costs, with a stated reason. **`location` keeps meaning the origin** and an optional `endLocation` joins it, so no existing reader changes meaning; modelling travel as an **edge between** two stops is rejected, because the whole app is "a day is an ordered list of activities" and an edge is not in that list. **Its prerequisite is not its own deliverable**: the activity-field descriptor refactor (`KI-20260905-o` — 21 non-test files hand-enumerate activity fields and nothing goes red when one is missed) runs **once, before M13**, shared with M13 link 5 and M19 link 1: `M24-travel-legs.md` |
| M26 | The build looks like the design again | **Done, gate closed 2026-09-21 — 22 of 22 over two waves**, which is what moved the current-milestone line to M13 (the first move in five made by a gate rather than by decision). Two boxes closed on Mitchell's attestation and one is ticked with its failures named — both map specs, both KI-49; the milestone file has the basis for each. **Minted, scoped and PLACED 2026-09-19, ahead of M13.** *(This cell read "CURRENT MILESTONE — ... Link 0 (the preflight) is done; Wave 1 link 1 is next" until 2026-09-22, two days after the gate closed and a day after the marker moved. Corrected as its own thing rather than inside M13's work: `pnpm milestones` reconciles gate tallies and the marker, and does NOT read currency claims made in prose inside a table cell, so nothing was ever going to catch this but a reader. It is the defect STATUS.md's own preamble describes — a stale section in a first-read file — in the one place the checklist at the top of this file sends people to find out what is current.)* A design-parity milestone, the first since M10's Wave-2 gate closed 2026-08-27. The handoff has moved **fourteen commits** since, seven of them between 2026-09-12 and 2026-09-19, while the build ran M20/M21/M22/M25/M23 — and **three of the four that closed had no design surface at all** until the design drew them on 2026-09-19. Opened by Mitchell asking for four things by name (Playbooks looking nothing like the designs, account settings as its own page, filters and tabs re-imagined, a hover state on the Map's days); five read-only surveys against the handoff and the working tree found the rest. **Two waves, two gates.** *Wave 1* is the desktop and shared surfaces — Account as a route with three tabs (**closes D14, D12 and `KI-2026-09-17-a`**), Discover re-sorted by kind of decision (**tabs are places, chips are questions, sort rides the results sentence** — a rule for any list surface), a Playbook's days as a scope over the row M23 just shipped, the shared day's map, the Map rail's hover card, trip lifecycle (**closes D13**), §3b's region-by-region loading — of which **literally none exists** — and two guards that cannot see their own class of defect. *Wave 2* is **the phone as a surface**, which `docs/guidelines/design-system.md` has promised since M5 (*"until the mobile milestone"*), `KI-046` calls *"a milestone, not a fix"*, and `TODO.md:1030-1037` calls *"a milestone-sized decision"* — three places in this repo waiting for it to be minted. **It opens with a preflight that is not optional**: `KI-2026-09-14-c` measured that building ONE screen from this handoff cost four review rounds and three wrong builds, and this milestone builds ~20. **Nothing in it is a contract change or a re-skin** — every link is UI over data that already exists, or a named, sized exception; reviews, per-stop attribution and cost classification are routed to M12, M13 and M19 and are out of scope on purpose. **It carries open questions it must not answer silently** — nine when scoped, of which two were answered the same day (the Map rail does get a hover card, and *where the phone edits* is sequenced last in Wave 2 rather than blocking it), leaving **seven**: `M26-design-parity.md` |
| M27 | The simplify pass — the invite landing, Cass, actions that look like actions | **CURRENT MILESTONE — minted, scoped and PLACED 2026-09-23 by Mitchell, ahead of M12.** The 2026-09-22 design pass (SPEC §35): one look; a quieter Home; a trip header that never reflows (rail into Plan, a dates-pill popover, Overview as a letter, a breadcrumb back); Account as two tabs; one Filters menu on Discover; a public **invite landing** with *Have a look first*; the keep dialog's preview; **Cass**, the new-trip assistant, with a typing row and a Playbook-day turn; proposal cards with Undo. Link 10 was added mid-build on Mitchell's request: every Playbook laid out the same, map included. Seventeen decisions where design and code disagreed are recorded, not silently resolved — among them: invites still do not expire, the Playbook-day turn ranks by adds until M12 has ratings, and proposal cards derive their words rather than widening the contract: `M27-simplify-pass.md` |
| M28 | Three kinds | **Gate closed 2026-09-26, 9 of 9** (#238, #239); placed by Mitchell 2026-09-25. A stop's kind is `planned`, `pending` or `transit`; `idea` and `hold` fold into `pending`, `booked` into `planned`. Retired kinds are never written and read back as their replacement (ADR-054): `M28-three-kinds.md` |
| M29 | The time river | **In flight.** SPEC §36.9b, stacked PRs; ADR-055: `M29-time-river.md` |

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
  *(External calendar sync later moved to M14 and was **dropped** 2026-09-24.)*
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

Current milestone: M14 — Rich layer
**2026-09-26, BY M28'S GATE CLOSING** at **9 of 9**. M14's code merged on
2026-09-24; its gate is 17 of 22 and the open boxes need a person. Scope and
gate: `docs/milestones/M14-rich-layer.md`.

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

### Archived decision notes

Moved to `docs/milestones/decisions-archive.md` on 2026-09-21, verbatim and
in order — every note whose milestones have all closed their gates. They are
the argument, not the live instruction, and they were 56% of this file.

- **2026-08-30** — M17 is jumped; M11a and M11b run first
- **2026-09-01** — minted and placed: M20 and M21, the first commercial milestones
- **2026-09-11** — M17's gate closed nine days late, and the queue drifted while it was open
- **2026-09-16** — reordered: M22 runs AHEAD of M21, which pauses at 11/17
- **2026-09-16** — placed: M22, a public API and scoped account tokens
- **2026-09-18** — Current milestone moves to M25; M22 pauses at 18/19
- **2026-09-19** — M21's and M22's gates closed, on Mitchell's attestation
- **2026-09-19** — M23's gate closed, shipped, and the migration applied
- **2026-09-19** — M25's gate closed, and what it leaves the milestones behind it

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
