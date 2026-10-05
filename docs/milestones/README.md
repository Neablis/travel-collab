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

> **`pnpm milestone close <id>` performs steps 1, 4 and 6, lists 3, 5 and 7,
> and refuses to do them wrong.** It will not close a milestone with open
> exit-gate boxes, will not proceed on a parse that found nothing, will not
> write anything without `--confirm` — it prints a diff first — and **reads which milestone
> becomes current from `TODO.md`'s row order**: the next unticked milestone row,
> skipping rows marked PAUSED. `--next <id>` is optional and only asserts that
> answer; if it disagrees with the rows it refuses and tells you to move the
> row. Steps 3, 5 and 7 are judgement and stay yours; it lists them rather than
> inventing them.
>
> **A reorder therefore moves `TODO.md`'s rows** (and is recorded below, under
> its date, as every reorder is). That is the choice that closed
> `KI-2026-09-21-a` on 2026-09-24: before it, `TODO.md` said "read the marker,
> not the position", so row order carried nothing, the script had to require
> `--next`, and closing M26 its row-order guess was M12 when the order was
> `M26 → M13 → M12`.

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
   `pnpm milestone close` (M23's survived its own gate by two days when this
   was manual). An entry that says it is *"kept here only for the reasoning"*
   is **scoped**, not placed, and is never auto-deleted.

7. **A retirement pass on any first-read file past 85% of its surface budget**,
   when `pnpm milestone close` lists one — `docs/guidelines/retiring-a-rule.md`.

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
| M14 | Rich layer | **Gate closed 2026-10-01, 22 of 22** (#222, #223, #226, #221). Code merged 2026-09-24, ahead of M24. Mitchell settled the insert Sheet call, ADR-052 and the six-widget walk on 2026-09-27, and attested the real-service weather walk on 2026-10-01. *(**Updated 2026-09-24** — the rest of this cell is the 2026-09-01 scoping and is behind the milestone file, which was rescoped twice on 2026-09-03 to SPEC §18's widget model and widened 2026-09-18 with link 10, saved notebook templates. **External calendar sync is dropped** (Mitchell, 2026-09-24); embedded community objects and a TipTap/Yjs ADR are out of scope per the file — TipTap is already the editor. Ghosts are Editing-only, and the `days`/`trip` input types are retired.)* Notion-style pages with embedded community objects (TipTap/Yjs ADR due here), external calendar sync, dogfood-backlog items. The macro vocabulary deferred out of M8 returns here. **Owns the whole Notebook redesign** (`.design-sync/handoff/SPEC.md` §7, routed here 2026-08-23): reading/editing modes, values as chips, the scope × shape insert picker, prebuilt pages, the journal framing — and **repeaters**, which need their own ADR before the milestone opens (see the design-sync review §7). **Scoped 2026-09-01** — it had no file and no exit gate until then. Two items on this row need a call before it opens: the M8 macro vocabulary, and **external calendar sync**, which has no design, no ADR and no relationship to the Notebook and may deserve its own milestone: `M14-rich-layer.md` |
| M19 | A cost knows who and what it is for | **Minted and placed 2026-08-31 by Mitchell — runs last, after M9.** Opened by M11b's `preview-registry` sweep: `cost-estimate-state` and `budget-breakdown` were tagged M11, are not M11's, and belong to no existing milestone — *"it does feel very much like a tacked on concept ... splitting cost, cost per person based on whos attached to what activity, better sharing cost in the shared day ui."* The whole model today is `Money = {amountMinor, currency}`, one optional `cost` on an activity and one `budget` on a trip. Five links: a cost's **kind** (**shipped 2026-09-26**: "Spend by kind"), a cost's **settled-vs-estimate** state (unblocks `cost-estimate-state`), **who an activity is for** (overlaps M13's `add-stop-who` — must land in exactly one), **splits** derived from that, and the **shared-day** presentation. Its anchor finding: `savedDayFacts.budgetPerPerson` was a plain sum of stop costs with nothing to divide by, so a shipped field asserted a per-person meaning it did not have — **the name was removed on pull request 104** (it is `totalCost` now, dividing by nothing and claiming nothing); the cost model it was standing in for is still entirely M19's: `M19-cost-model.md` |
| M20 | An account knows what it may do | **Done, gate closed 2026-09-14** — 32 of 32 live boxes, built as #174 and #175, migrations 0019/0020 dispatched to production the same day, the console walked on production and the account surfaces on a preview; retro and gate evidence in the milestone file. **Scoped and placed 2026-09-01 — ran after M9's Phase 0, before M21.** The **first commercial milestone**: nothing in the repo had ever described a paid tier, a plan, a price or a payment. Mostly a wiring job on a seam built for it and stubbed since M16 — `modelSelection.ts:88` declares `AiEntitlementCheck`, `:89` stubs it `EVERYONE_IS_ENTITLED`, and `:47` says *"the day a pro-tier check exists it lands inside `isEntitled` below, not as a signature change"*; ADR-019 is explicit that entitlement is **not** a flag. Nine links, the ninth added 2026-09-01 when Mitchell asked for the financial metrics: **an `ai_usage` cost ledger** storing tokens and models rather than dollars, because prices move (DeepSeek's changed mid-scoping) and because `Money`'s integer minor units round a $0.0006 request to **zero cents** — the KI-1/KI-14/`budgetPerPerson` defect class on its third recurrence. It moved out of M21 deliberately: M21 has to choose prices and M20's link 5 has to choose per-tier ceilings, and both are guesses without it, while the ledger itself needs no Stripe. It carries the `/ask` step-metering fix with it. Its four rules: **a plan is a set, not a rank** (Mitchell: tiers are *"not necessarily subsets"*, so copying `accessPolicy.ts:11`'s `RANK` is the obvious move and the wrong one); **trials, referral rewards and admin boosts are one time-bounded grant with three `source` values**, not three features; entitlements **resolve per request from the database**, never from the JWT (a downgrade must bite before a token refreshes); and — added 2026-09-01 on Mitchell's requirement that prices stay tweakable *"especially in the early days"* while purchases are honoured — **a plan's contents are versioned data, not code, and a purchase pins a version**. `plan_versions` is immutable and append-only, so changing a price or a term **publishes a new version** and what someone already bought is untouched until an explicit admin *migrate to version N*; the contracts package keeps the entitlement vocabulary, the rows own the offers. That is also what makes pricing changeable **without a deploy**. Free keeps trip planning entire; AI and inviting collaborators are paid. **It takes no money** — Stripe is M21, and the admin grant UI is what makes this provable without it. Plans are `free`, `plus` and `premium`, and **defined by enumeration, never by extension** — Mitchell, 2026-09-01: *"to an end user it should look like a nested ladder, but for architecting guidance it should look like split access, where they can own different things that aren't inherited from the previous tier"*, so the three happen to nest and nothing in code may know it; the ladder is presentation only. Four decisions by Mitchell the same day: on lapse granted memberships **cap at `viewer` on read**, never written to `trip_memberships`, so resubscribing restores everyone with zero writes; every account existing at migration time gets a **permanent `founder` grant**; the **trial grants `plus` at signup**, so collaboration is never trialled; and a **referral earns one month of the tier the referrer already holds**, which means a free account earns nothing and most of the abuse surface disappears with it. Needs a migration and an ADR adding an **Entitlements** module to `AGENTS.md`'s map — **that ADR is written and accepted: ADR-045**, and the map row landed with it. **Reordered 2026-09-13 on Mitchell's call: this is the CURRENT milestone**, running ahead of M9's remaining work; M20's own *"M9, and it must be closed"* prerequisite is superseded, with the cost accepted on the record in the 2026-09-13 note below. Kickoff plan: `docs/plans/2026-09-13-M20-M21-commercial.md`: `M20-account-tiers-and-entitlements.md` |
| M21 | An account can pay for itself | **Done, gate closed 2026-09-19** — 17 of 17; the last six boxes ticked **on Mitchell's attestation** that he walked them and they worked, not on agent-recorded evidence (see the 2026-09-19 note below and the retro in the milestone file). **Scoped and placed 2026-09-01, immediately after M20.** Stripe checkout, the webhook that is the **sole writer** of subscription state, the customer portal, and failed-payment handling. **Adds no entitlement and no gate** — if its diff touches `modelSelection.ts`, `quota.ts` or `members.ts`, the split has failed. Separate from M20 for three reasons: M20 is provable end to end with no external service and this is not; a hand-grant path is permanent infrastructure (comping, trials, disputes) rather than scaffolding; and the blast radius here is money, where a webhook mistake charges someone twice or grants access nobody paid for, silently. Signature verification, idempotency under Stripe's retries, and out-of-order tolerance are each a gate box, as is *no card number ever reaches this application*. Cancelling lapses through **M20's resolver** — no second downgrade path to keep in sync. **Link 6 is the revenue half of the unit economics**, against M20's cost ledger: MRR, ARPU reported twice and labelled (all accounts vs paying accounts, which diverge badly once founder/referral/trial grants exist), trailing-30-day margin per account, and an *accounts that cost more than they pay* list **segmented by grant source** — a comped account is underwater by construction, and unsegmented those swamp the list and make the metric worthless. **Mitchell owes one decision before it opens: the plans and their prices** — M20 names plans without pricing them — **decided 2026-09-13: `free` $0, `plus` $9/month, `premium` $19/month**, so this milestone's one owed decision is closed before it opens. **Reordered 2026-09-13 on Mitchell's call: it runs immediately after M20 and ahead of M9's remaining work**, both placed by the note below: `M21-subscriptions-and-billing.md` |
| M15 | Front door | **Gate closed 2026-08-26, PR #56.** Approved 2026-08-23 (ADR-021); ADR-022 (2026-08-25) placed it after M16, but it in fact **ran ahead of both M10's Phase 9 gate and M16** — decided by Mitchell 2026-08-26, superseding ADR-021/ADR-022's stated ordering (see the reorder note below). The unauthenticated surface the product had never had: landing page, custom Google sign-in and sign-up screens replacing NextAuth's default, and the header account menu (already shipped in M10 Phase 8b). The designed first-run screen was dropped — `NewTripWizard`'s "Create empty" already creates a trip from a name alone. Scope, exit gate and retro: `M15-front-door.md` |
| M22 | An account can build on the API | **Done, gate closed 2026-09-19** — 19 of 19; the last box, the preview walk, ticked **on Mitchell's attestation** that he walked it and it worked, not by an agent (see the 2026-09-19 note below and the retro in the milestone file). **Placed 2026-09-16 by Mitchell — runs after M21, before M12**, and was the **current milestone** from then until 2026-09-18. A public REST API and account-generated API tokens, scoped to the account or to named trips, with create and revoke. All five phases landed 2026-09-16 and **18 of 19 exit-gate boxes were ticked** that day; the one left open needed a browser walk on a Vercel preview, and what blocked it was **`ADMIN_USER_IDS`** (`KI-2026-09-16-d`): it is injected at build, so no account reachable from a browser can be granted `api.tokens` there. *(This row said `API_TOKEN_PEPPER` until 2026-09-19. That was wrong — see the 2026-09-19 note below.)* Three boundaries fixed at placement: **user accounts only, no admin surface, no AI surface** — so a token can never spend model budget. Its entitlement is `api.tokens` on **`premium@v2`**, which raises the pinning problem a `premium@v1` subscriber cannot escape without an admin grant. The design's claim to test at the gate: adding endpoint N+1 costs a declaration and nothing else. *(**This row was missing until 2026-09-18** — M22 was recorded in `TODO.md`, in Current milestone below and in its own file, and not in this table. That is the same defect this file already records against M17 and M19, on its third occurrence.)*: `M22-public-api-and-tokens.md` |
| M25 | A trip is a file you can take with you | **Minted and placed 2026-09-18 by Mitchell — runs immediately after M22**, because it is small and reuses M22's route wrapper while that machinery is fresh. Trip **export and import** as JSON. **The format is `travel-collab/content-bundle/v1` and no third format is created**: the bundle already has a schema, a CI-enforced linter, pure converters and a real importer, so `export → import → compare` is a gate box a test can hold, and it is the shape a person can hand-author — which is what *"similar to the api"* was asking for. A dedicated export format would be a **third vocabulary over the same data**, the drift invariant 5 exists to stop. **An export is a snapshot, never the event log**: the log is `tripId`-bound and re-importing it would violate ADR-028's id-remap rule, the hazard `cloneTrip` exists to handle, so an exported trip loses its history. **Export is free** (Mitchell, 2026-09-18) — *"free keeps trip planning entire"* is M20's line and portability is a trust property, so it needs **no new entitlement, hence no new plan version**, and does not walk into M22's `premium@v1` pinning problem. Import is the larger half: a user upload must **mint fresh ids**, where the content script derives them from keys so a re-import updates rows instead. **Three scoping questions were decided 2026-09-18.** **What it carries: days and activities, nothing else** — no budget, no members, invites or share links, no notebook pages, no lineage or trip status. That is a scope line, not a gap, and it buys a property worth naming: an export cannot carry a copy of a membership list out of the system. It also means an export is a copy of the plan and **not a backup**. **Linting: the schema validates an upload and the content rules do not run on it** — `lint.ts` states rules for authored library content headed for Discover, and three are errors a real trip trips routinely (an empty trip, stops out of clock order after an ordinary board reorder, a backlog item with a time window), so running it would reject real trips on day one. No subset and no second rule set; revisit if a real problem emerges. **Dates: a dated trip exports its real `startDate`, never `startsInDays`**, and a **dateless** trip carries neither anchor — *"we just have offsets, day 1, not January 15th"*. `BundleDay` already has no date field, so the trip anchor relaxes from *exactly one* to *at most one*. The export is a copy of **your** trip rather than a re-usable shape, so a stale export importing as a *past* trip is the correct answer, not a defect to design around. The dateless half is not a one-liner: `tripStartDate`'s `?? 0` currently resolves a missing anchor to *starting today*, so relaxing the refine alone would make a dateless trip silently dated. **Nothing on this milestone is waiting on a decision** — see `M25-a-trip-is-a-file.md` |
| M23 | A playbook can be more than one day | **SHIPPED 2026-09-19** — gate 11/11, #192 merged as `7763913`, migration `0024_saved_day_day_count` dispatched and production verified at 25/25. What actually shipped differs from the plan below in one place worth reading before building on it: **a GAP in `dayIndex` IS an empty day**, so an interior rest day needed no column, and `dayCount` is stored only for the *trailing* empty day a gap cannot reach. ADR-048 carries that and three other decisions, two of them marked ✳ because they contradict a premise in the milestone file. *(Everything from here to the end of this row is the placement as written on 2026-09-18, kept for the reasoning rather than as a description of the result.)* **Minted and placed 2026-09-18 by Mitchell — runs BEFORE M12**, and the placement is the substance: M12 keys reviews, ratings, reporting and moderation to a `saved_days` row, and this changes that row's shape, so running it after means M12's work is revisited. **A saved day generalises into a saved sequence — the same object, not a new one.** The rejected alternative was a separate "collection" over saved-day rows: rejected because a second publishable object either doubles M12's trust-and-safety surface or ships a library with two classes of content having different moderation properties. **The shape is a flat `stops[]` with a per-stop day indicator, not `days: SavedStop[][]`** — Mitchell's call, on migration grounds: existing rows read as "everything on day 1" when the indicator defaults, so the strict `SavedStop.array()` parse at the read boundary keeps working with no versioned read, which a nested array would have forced. **That property has a precondition the scoping found**: the strict parse exists at **two** sites (`savedDays.ts`'s `fromRow` and `playbooks.ts`'s `toDiscoverDay`) and `SavedStop` carries **no `.default()` on any field**, so the additive claim holds only if the indicator lands defaulted at both. **One insert primitive, three callers** — add to an existing trip, start a trip from one day, start a trip from N days, wrapped in M6's atomic command group — which absorbs `TODO.md`'s *"Start a new trip from a saved day"* candidate and answers its open question (one shared primitive, not a second copy of fork): `M23-multi-day-playbooks.md` |
| M24 | A leg knows where it goes and by what | **Gate closed 2026-09-25, 11 of 11** (#229, #230, #232, #233; carried: `KI-2026-09-25-q`). **Minted and placed 2026-09-18 by Mitchell — runs after M12, before M14.** A travel stop gets a **transport mode** and a **second location**, and the map draws a real leg instead of inferring one from its neighbours. `MapLegend.tsx:9` has said the gap out loud since it shipped: *"We model no transport mode"*. **Mode carries its own field and does not inherit from `kind`** — `kind: "transit"` says THAT a stop is travel, `mode` says by what, and they cannot disagree because a mode is legal only on a transit stop, enforced by a `superRefine` rather than by convention. That answers the question `TODO.md`'s *"Transport mode per leg"* has carried since 2026-09-01; M19 link 1 may still answer differently for costs, with a stated reason. **`location` keeps meaning the origin** and an optional `endLocation` joins it, so no existing reader changes meaning; modelling travel as an **edge between** two stops is rejected, because the whole app is "a day is an ordered list of activities" and an edge is not in that list. **Its prerequisite is not its own deliverable**: the activity-field descriptor refactor (`KI-20260905-o` — 21 non-test files hand-enumerate activity fields and nothing goes red when one is missed) runs **once, before M13**, shared with M13 link 5 and M19 link 1: `M24-travel-legs.md` |
| M26 | The build looks like the design again | **Done, gate closed 2026-09-21 — 22 of 22 over two waves**, which is what moved the current-milestone line to M13 (the first move in five made by a gate rather than by decision). Two boxes closed on Mitchell's attestation and one is ticked with its failures named — both map specs, both KI-49; the milestone file has the basis for each. **Minted, scoped and PLACED 2026-09-19, ahead of M13.** *(This cell went on claiming M26 was current for two days after its gate closed — corrected 2026-09-22; `pnpm milestones` does not read prose inside a cell.)* A design-parity milestone, the first since M10's Wave-2 gate closed 2026-08-27. The handoff has moved **fourteen commits** since, seven of them between 2026-09-12 and 2026-09-19, while the build ran M20/M21/M22/M25/M23 — and **three of the four that closed had no design surface at all** until the design drew them on 2026-09-19. Opened by Mitchell asking for four things by name (Playbooks looking nothing like the designs, account settings as its own page, filters and tabs re-imagined, a hover state on the Map's days); five read-only surveys against the handoff and the working tree found the rest. **Two waves, two gates.** *Wave 1* is the desktop and shared surfaces — Account as a route with three tabs (**closes D14, D12 and `KI-2026-09-17-a`**), Discover re-sorted by kind of decision (**tabs are places, chips are questions, sort rides the results sentence** — a rule for any list surface), a Playbook's days as a scope over the row M23 just shipped, the shared day's map, the Map rail's hover card, trip lifecycle (**closes D13**), §3b's region-by-region loading — of which **literally none exists** — and two guards that cannot see their own class of defect. *Wave 2* is **the phone as a surface**, which `docs/guidelines/design-system.md` has promised since M5 (*"until the mobile milestone"*), `KI-046` calls *"a milestone, not a fix"*, and `TODO.md:1030-1037` calls *"a milestone-sized decision"* — three places in this repo waiting for it to be minted. **It opens with a preflight that is not optional**: `KI-2026-09-14-c` measured that building ONE screen from this handoff cost four review rounds and three wrong builds, and this milestone builds ~20. **Nothing in it is a contract change or a re-skin** — every link is UI over data that already exists, or a named, sized exception; reviews, per-stop attribution and cost classification are routed to M12, M13 and M19 and are out of scope on purpose. **It carries open questions it must not answer silently** — nine when scoped, of which two were answered the same day (the Map rail does get a hover card, and *where the phone edits* is sequenced last in Wave 2 rather than blocking it), leaving **seven**: `M26-design-parity.md` |
| M27 | The simplify pass — the invite landing, Cass, actions that look like actions | **CURRENT MILESTONE — minted, scoped and PLACED 2026-09-23 by Mitchell, ahead of M12.** The 2026-09-22 design pass (SPEC §35): one look; a quieter Home; a trip header that never reflows (rail into Plan, a dates-pill popover, Overview as a letter, a breadcrumb back); Account as two tabs; one Filters menu on Discover; a public **invite landing** with *Have a look first*; the keep dialog's preview; **Cass**, the new-trip assistant, with a typing row and a Playbook-day turn; proposal cards with Undo. Link 10 was added mid-build on Mitchell's request: every Playbook laid out the same, map included. Seventeen decisions where design and code disagreed are recorded, not silently resolved — among them: invites still do not expire, the Playbook-day turn ranks by adds until M12 has ratings, and proposal cards derive their words rather than widening the contract: `M27-simplify-pass.md` |
| M28 | Three kinds | **Gate closed 2026-09-26, 9 of 9** (#238, #239); placed by Mitchell 2026-09-25. A stop's kind is `planned`, `pending` or `transit`; `idea` and `hold` fold into `pending`, `booked` into `planned`. Retired kinds are never written and read back as their replacement (ADR-054): `M28-three-kinds.md` |
| M29 | The time river | **Merged, gate open, not current.** SPEC §36.9b, four PRs merged 2026-09-26; ADR-055: `M29-time-river.md` |
| M30 | Notebooks with one job each, and links between them | **Built 2026-09-26, unplaced.** Four seeded notebooks and two id-based link widgets (ADR-056): `M30-notebooks-and-links.md` |
| M31 | We can see what the assistant costs, step by step and tool by tool | **Minted 2026-10-03 and placed after M19; built 2026-10-03 beside M19, not current** (Mitchell: build the ledger now, and defer the eve port until there are users). It is ADR-062's Phase 1: per-step and per-tool rows next to `ai_usage`, cached tokens, per-step pricing, and the `ai-usage` skill's SQL. It closed KI-2026-09-14-b and KI-2026-09-17-c. **Gate closed 2026-10-05, 7 of 7**: a $20/month Gateway budget, and a baseline of two production turns Mitchell accepted in place of a preview live-set run. The port (Phases 2–5) is a candidate: `M31-assistant-ledger.md` |
| M32 | The assistant can say which day is free, in one call | **Gate closed 2026-10-05, 7 of 7** (current for the same day, from M31's close); minted 2026-10-04 from Mitchell's production turn and built beside M31. `find_free_time` ranks every day inside 08:00-22:00 in one call, and each ledger step carries its duration (migration `0037`): `M32-free-day.md` |
| M33 | We can see whether an assistant change works before it ships | **CURRENT MILESTONE from 2026-10-05**, by M32's gate closing; minted and built the same day beside M31 and M32, merged as #327. `pnpm --filter web eval` runs the live set through the unmocked `/ask` handler on production's per-tier models, grades it in code, states its cost and stops at a cap: `M33-evals.md` |

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

Current milestone: M33 — We can see whether an assistant change works before i…
**M33 became current 2026-10-05, by M32's gate closing** at **7 of 7**. Scope and gate:
`docs/milestones/M33-evals.md`; every box is ticked but the retro.

**M32 — the free-day tool — was current on 2026-10-05 only**, by M31's gate closing. Its retro is
at the end of `docs/milestones/M32-free-day.md`.

**M31 — the assistant ledger — was current from 2026-10-04 to 2026-10-05**, by M19's gate
closing. Its retro is at the end of `docs/milestones/M31-assistant-ledger.md`.

**M19 — the cost model — became current 2026-10-01, by M14's gate closing** at **22 of 22**,
and was scoped on 2026-10-02 by ADR-060. Scope and gate: `docs/milestones/M19-cost-model.md`.

**M14 — Rich layer — was current from 2026-09-26 to 2026-10-01**, by M28's gate
closing. Its retro is at the end of `docs/milestones/M14-rich-layer.md`.

### Archived decision notes

Moved to `docs/milestones/decisions-archive.md` on 2026-09-21, verbatim and
in order — every note whose milestones have all closed their gates. The
2026-09-30 retirement pass (`docs/guidelines/retiring-a-rule.md`) moved two more
notes, the Current-milestone placement paragraphs from M26 to M28, and four
superseded reorder notes from under the Phase 3 table. They are
the argument, not the live instruction, and they were 56% of this file.

- **2026-08-30** — M17 is jumped; M11a and M11b run first
- **2026-09-01** — minted and placed: M20 and M21, the first commercial milestones
- **2026-09-11** — M17's gate closed nine days late, and the queue drifted while it was open
- **2026-09-16** — reordered: M22 runs AHEAD of M21, which pauses at 11/17
- **2026-09-16** — placed: M22, a public API and scoped account tokens
- **2026-09-18** — three milestones minted, M13 moved ahead of M12, two prerequisites placed
- **2026-09-18** — Current milestone moves to M25; M22 pauses at 18/19
- **2026-09-19** — M21's and M22's gates closed, on Mitchell's attestation
- **2026-09-19** — M23's gate closed, shipped, and the migration applied
- **2026-09-19** — M25's gate closed, and what it leaves the milestones behind it
- **2026-09-19 (later)** — minted, scoped and placed: M26, design parity
- **2026-08-08, 2026-08-14, 2026-08-25, 2026-08-26** — the superseded reorders and M10's reopened gate, and the placement paragraphs for M26 to M28: *Moved out of README.md on 2026-09-30*, at the end

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
