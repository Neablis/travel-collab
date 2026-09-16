# M21 — An account can pay for itself

**Status:** **OPEN at 11 of 17, and PAUSED since 2026-09-16** — Mitchell's
decision to run M22 ahead of it, recorded in `docs/milestones/README.md` under
*2026-09-16 — reordered*. **Nothing in this file is amended by that pause**: the
scope, the seven links and all seventeen boxes stand exactly as written, and the
six open ones are still owed.

> **One box acquires a deadline from the pause, and it is box 2.** M22's Phase 1
> publishes `premium@v2`, after which `livePlanVersion("premium")` returns v2 and
> `startCheckout` (`billing/checkout.ts:119`) can never again create
> `premium@v1`'s Stripe Price — which has never been created, because
> `stripePriceFor` creates one lazily at a version's first checkout and
> `premium@v1` has never been bought. `checkPriceConsistency` cannot substitute:
> no Price means `missing`, not `ok`. **So the Premium buy-and-refund this box
> names must happen before M22's Phase 1**, or the box needs an amendment —
> which only Mitchell makes.

**Was OPEN and building since 2026-09-14.** Phases 1–4 are written; what
is still owed is a walk against a real Stripe test-mode key, which is the half
no lane in this repo can drive. **Build log and the five deviations from this
file are at the bottom**, under *What was built*. Originally scoped and placed
2026-09-01, immediately after M20. **Reordered
2026-09-13 on Mitchell's call** — the commercial pair runs ahead of M9's
remaining work, so the live order is
`M17 ✓ → M9 [Phase 0 ✓, paused] → M20 → M21 → M12 → M13 → M14 → M19`. **This
milestone is placed, not open**: its prerequisite is M20 *closed*, and M20 is
the current milestone. **Its one owed decision is closed** — the prices, below.
Reorder note and the costs accepted with it: `docs/milestones/README.md`,
2026-09-13. Kickoff plan for the pair:
`docs/plans/2026-09-13-M20-M21-commercial.md`.

**M20 built what a subscription grants. This one makes a subscription real.**
Stripe checkout, the webhook that is the only writer of subscription state, the
customer portal, and what happens when a payment fails. It adds **no new
entitlement and no new gate** — every gate in the product already exists and is
already proven by M20's gate. If this milestone's diff touches
`modelSelection.ts`, `quota.ts` or `members.ts`, the split has failed and the
gate that was supposed to be independent was not.

**It needs one migration** — `subscriptions`, plus `users.stripe_customer_id`.
Dispatch with `gh workflow run migrate-production.yml -f confirm=migrate` from
`main` and say so in the PR body.

**A design handoff now covers the paying surfaces** (2026-09-02):
`.design-sync/handoff/SPEC.md` §17, with `DRIFT.md` §2c for what it needs.
Two of its four surfaces are this milestone's — pricing on the landing page
(§17.1) and plan + usage in the account sheet (§17.4) — plus the revenue half
of the operator console M20 builds (§17.2). **Every number is fixture data and
the two prices are placeholders**: the design has not made the pricing
decision and nothing on those screens should be read as having made it.

**One designed surface belongs to no link here, and Mitchell ruled on
2026-09-02 that it is not to be minted as one** — the pricing section on the
landing page. See *An unowned surface* below, before the exit gate; its home is
still open.

## Why it is separate

Three reasons, in order of how much they cost if ignored.

1. **M20 is provable without an external service; this is not.** M20's admin
   grant UI walks the entire tier system end to end in CI and in a browser.
   Stripe brings webhooks, a signing secret, a test-mode/live-mode split, and
   an external service that cannot be driven from `test:e2e:ci-like`. Fused,
   an integration problem with a vendor blocks the tier substrate that AI
   gating, quotas and collaboration all read.
2. **A hand-grant path is not a stopgap, it is permanent infrastructure.**
   Comping an account, extending a trial, and fixing a billing dispute all need
   it after Stripe ships. Building it first means it is load-bearing rather
   than scaffolding.
3. **The blast radius is money.** Getting entitlement resolution wrong shows a
   403 to someone who paid. Getting webhook handling wrong charges someone
   twice, or grants access nobody paid for, silently.

## Scope

Seven links.

1. **The subscription table, pinned to a plan version.** `subscriptions` —
   user id, Stripe customer id, Stripe subscription id, **`plan_id` and
   `plan_version`**, `status`, current period end, `cancel_at_period_end`,
   timestamps. Plus `users.stripe_customer_id`. No foreign keys, per the
   schema's standing convention.

2. **Price on the plan version, and the Stripe Price it maps to.** M20's plan
   versions are immutable and carry entitlements and ceilings; this milestone
   adds `price_minor`, `currency` and **`stripe_price_id`** to the same entry.
   Publishing a priced version creates or links a Stripe Price; an existing
   version's price is never edited, because Stripe Prices are themselves
   immutable and the two would silently diverge.

   **Amended 2026-09-02, following M20's amendment**: plan versions are a
   **static file committed to the repo**, not a `plan_versions` table, so these
   three fields are added to a file entry and a price change is a commit and a
   deploy. Two consequences specific to this link, and the second is the one to
   watch:

   - **Committing a `stripe_price_id` is an improvement, not a compromise.**
     Stripe Prices are immutable and a plan version is now immutable in git;
     the pairing is reviewable in a diff, which is the only place anyone would
     notice a version pointing at the wrong Price.
   - **Creating the Stripe Price is still a runtime act against an external
     service, and it no longer has a publish step to hang off.** Whatever
     creates or links the Price must be idempotent and must run somewhere a
     deploy reaches — a committed `stripe_price_id` that names a Price nobody
     created is a checkout that fails at the till. The consistency check below
     (*every published priced version's `stripe_price_id` resolves to a Stripe
     Price with the same amount and currency*) is what catches it, and it
     matters more now than when publishing was a UI action that could do both
     at once.

   **Division of authority, stated once:** the plan version is the source of
   truth for **what is granted**; Stripe is the source of truth for **what is
   charged**. They must agree, and a check asserts that every published priced
   version's `stripe_price_id` resolves to a Stripe Price with the same amount
   and currency — a mismatch means the pricing page and the card statement
   disagree, which is the worst class of billing bug because nothing errors.

   **A price change is a new version and affects new purchases only.** An
   existing subscriber keeps paying what they agreed and keeps the terms they
   bought, because their subscription pins `v1`. ~~Moving them is M20 link 7's
   explicit migrate action~~ — **amended 2026-09-02: there is no migrate
   action.** It left M20 with the `plan_versions` table, so nothing in either
   milestone moves an existing subscriber onto a newer version. The rule is
   unchanged and in fact absolute now: **what you bought is what you get**,
   with no mechanism to change it. If widening a plan for existing subscribers
   is ever wanted — a price cut they should get, rather than a rise they should
   be spared — it returns as its own decision.
3. **Checkout.** A hosted Stripe Checkout session per plan. **The app never
   sees a card number** — no PAN, no CVC, no card field anywhere in this
   repo's DOM, which is the entire reason for hosted checkout and is a gate
   box below rather than an assumption.
4. **The webhook, as the sole writer.** One endpoint, and it is the **only**
   thing in the product that writes `subscriptions` or `users.plan`. A checkout
   redirect is a hint, never a grant — a client that returns from Stripe
   proves nothing, and deriving entitlement from a success URL is the classic
   way a paywall becomes free. Three properties are mandatory and each is a
   gate box: **signature verification** (an unsigned request is rejected before
   it is parsed), **idempotency** (Stripe retries, and a redelivered event must
   not double-apply), and **ordering tolerance** (events arrive out of order;
   state is reconciled from the event's own period data, never from arrival
   sequence).
5. **The billing surface.** Current plan, renewal date, and a link into
   Stripe's customer portal for payment method, invoices and cancellation.
   Cancelling sets `cancel_at_period_end` — access runs to the end of the paid
   period and then lapses through **M20's existing resolver**, with no separate
   downgrade path to keep in sync.

   **The design places this and widens it** (`SPEC.md` §17.4): not a route, but
   a **Plan section at the top of the existing account sheet** — above M17's
   preferences, and deliberately not a second place to see what a *trip* costs.
   Five things on it, three of which this link did not name:

   - Plan, version and state (`Active` / `Free week` / `Payment failed` /
     `Lapsed`).
   - **Two meters — questions and steps — against the pinned version's
     per-user ceilings**, with the copy saying that steps is what binds first
     on a heavy day. The environment's global ceiling is not shown, because it
     was never sold to anyone.
   - **Past due is told before anything is taken**: the decline date, the date
     the grace window ends, and what stops then — including the collaborators
     dropping to read-only. That is link 6's requirement expressed as copy,
     and it is the strongest form of it: naming the loss beats announcing it.
   - **A referral row** — a code, and one line saying it earns a month of
     whatever tier you hold. **A `free` or trial-only account has no referral
     row at all**, because it earns nothing. The data behind it is **M20 link
     8's**, not this milestone's; what is new here is the surface.
   - **An inline three-plan chooser in the same sheet**, so the collaboration
     gate's CTA has somewhere to land without a pricing route inside the app.
     Payment happens on Stripe and the copy says nothing changes here until it
     clears — which is link 4's *a redirect is a hint, never a grant*, said to
     the person rather than to the code.
6. **Failed payment.** A `past_due` subscription keeps its entitlements for a
   grace window and then lapses. The account is told, in the product,
   before anything is taken away — a capability that disappears silently is
   indistinguishable from a bug, and M20's collaborator cap means the owner's
   guests feel it too.

   **The grace window is 3 days** (Mitchell, 2026-09-13), measured from the
   decline, not from the period end. Four things follow:

   - **3 days is shorter than Stripe's own retry schedule**, which by default
     spreads several attempts over about two weeks. So the window is **not**
     "wait for Stripe to give up" — the account lapses while Stripe is still
     retrying, and a later successful retry restores it through the ordinary
     webhook path. That is the right way round: the lapse is reversible and
     the access is not free in the meantime.
   - **It is short enough that the copy has to be immediate**, which is what
     §17.4 already asks for: the decline date, the date the window ends, and
     what stops then — named, not announced. With 3 days there is no room for
     a gentle first notice followed by a firm one; the first notice is the
     only one that matters.
   - **A card fixed inside the window costs the account nothing** — no lapse,
     no collaborator cap, no re-invite. This is the case the window exists
     for, and it is the one to walk first.
   - **The number is a constant with one definition, not a literal in three
     branches.** The resolver reads it, the copy reads it, and the test reads
     it. Changing it is then a one-line change rather than a hunt, which
     matters because 3 days is a guess that first contact with real declines
     will want to revise.
7. **What M20 left standing for you, and exactly where to attach.** *(Added
   2026-09-14 while M20 was in review, on Mitchell's instruction: "I just want
   you to start setting it up in a way the next session builds it correctly.")*

   Four surfaces are already drawn, already fed by real data, and already
   inert. **None of them needs redesigning — each needs one thing supplied**,
   and in every case the thing missing is a price, a customer or a session,
   which are this milestone's to add.

   | Surface | Where | What is missing |
   |---|---|---|
   | Change plan | `components/account/PlanSection.tsx` → **`startPlanChange(planId)`** | Create a Checkout session and redirect. The function exists, is named, is a no-op, and is the ONLY thing to replace on that screen. |
   | Payment and invoices | same file, `<Preview id="account-plan-billing">` | A customer to open the Stripe portal for. |
   | The four-number strip | `app/admin/page.tsx` (absent by design) | MRR, ARPU ×2, median margin — all four need a subscription. M20's console deliberately has no strip; its `admin.console.test.ts` will fail the moment a revenue word appears, so **that test is the first thing to update when the strip lands**, not a wall to route around. |
   | `Pays` / `State` columns, red row highlight, the `Past due` and `Costs more than it pays` chips | `components/admin/AccountsPanel.tsx` | What an account pays. The filter ids are already semantic (`entitled`/`unentitled`) rather than plan names, so adding two is additive. |

   **The plan catalogue is not yours to invent.** `server/entitlements/planVersions.ts`
   is the committed, append-only definition of what each plan grants, and the
   account chooser and the operator console's tier panel both read it. M21 adds
   **price** to that record — as a new dated version, never an edit to a
   published one — and the two surfaces pick it up without changing shape.
   `lib/accountPlan.ts` and its server twin are pinned by a compile-time
   identity test, and a second test asserts no price-shaped word appears in
   either; **that second test is the one to delete in this milestone**, and
   deleting it deliberately is the point — it exists so the price arrives on
   purpose rather than by drift.

   Both shells are registered in `lib/preview-registry.ts` tagged `M21`. The
   registry's rule is that a tag is a claim that this milestone wires it up, so
   removing those two entries is part of this link's definition of done.

7. **The revenue half of the unit economics.** M20 link 9 builds the cost
   ledger — `ai_usage`, tokens not dollars, one row per AI request. This link
   adds what it has to be compared against, and the comparison itself. Four
   numbers on the admin surface:

   - **Revenue** — MRR from active subscriptions, and the movement in it.
   - **ARPU**, reported **twice and labelled**: across all accounts, and
     across paying accounts only. With founder, referral, trial and admin
     grants in the mix these differ a lot, and a single unlabelled "ARPU"
     will be quoted as whichever is convenient.
   - **Margin per account** — subscription revenue minus marginal AI cost
     over a **trailing 30 days**, never lifetime. Cost is spiky; one heavy
     month is not a signal.
   - **Accounts that cost more than they pay**, and this is the one that
     needs care. It must be **segmented by why**. An account on a founder,
     trial, referral or admin grant is underwater *by construction* — that is
     a decision already taken, not a finding, and if the list is not
     segmented those accounts will dominate it and make it useless. The
     alert-worthy row is a **paying** account whose trailing marginal cost
     exceeds what it pays.

   Both halves of every comparison come from data this pair of milestones
   owns: cost from `ai_usage`, revenue from `subscriptions`. Nothing here
   scrapes a log.

   **The design draws exactly this, and it lands on M20's console**
   (`SPEC.md` §17.2). What that means for the split, stated so an implementer
   reading the finished screen does not build it a milestone early:

   - **The four-number strip is this link's, not M20's.** MRR and its movement,
     ARPU twice and labelled, median margin per paying account over a trailing
     30 days. M20 ships the console without the strip; this link adds it.
   - **The per-tier panel is split down the middle.** Accounts per tier, each
     tier's version history and hold counts are M20's; MRR and median margin
     per tier are this link's.
   - **`webhooks-behind` is this link's state** — revenue numbers stamped
     stale, with grants still applying, because grants do not go through
     Stripe. There is no such state before a webhook exists.
   - **"Costs more than it pays" is segmented in the layout, not just in the
     query**: one count for paying-and-underwater with a button that filters
     the table, and grant-funded accounts counted by source and set aside.
     That is this link's hardest requirement expressed as a screen, and it is
     the shape the gate box below asks for.

   **`Money` must not appear on this surface's data path** — the console shows
   dollars derived at read time from tokens plus the dated rate table, per M20
   link 9. A request costing $0.0006 rounds to zero in `amountMinor`; that is
   the third recurrence of the defect class, and a revenue screen is where it
   would look most like a real number.

## An unowned surface — pricing on the landing page

**`SPEC.md` §17.1 designs a pricing section and a nav anchor (`#pricing`) on
the landing page, and no link in either commercial milestone owns it.** M20
forbids it outright — *"if a price string appears in this milestone's diff, the
split has failed"* — and this milestone's seven links cover checkout (3) and
the in-app billing surface (5) but nothing unauthenticated. The landing page
itself shipped in **M15** (`LandingScreen.tsx`, gate closed 2026-08-26,
PR #56), so this is a section on a real route, not a new one.

**Ruled out of both commercial milestones by Mitchell, 2026-09-02** — asked
whether to mint it as link 8 here, the answer was *own it somewhere else* —
and **parked the same day in `TODO.md`'s Candidate ideas, to be revisited when
this milestone opens.** So it has no owner by decision rather than by
oversight, and this section is the single copy of what it owes; the Candidate
ideas entry points here rather than restating it.

Two constraints on wherever it eventually lands. **It may name a price**, which
M20 forbids in its own diff and which nothing before M21 can honestly do — so
its home either sits at or after M21, or it ships with the prices left out. And
**it is a section on a route that already exists** (M15's landing page), not a
new surface, so it is small wherever it goes.

What it owes, whoever owns it — all from §17.1 and §14's standing copy rules:

- Three cards in display order, **each enumerating its own contents in full**.
  The nesting is copy; nothing may read the display order as authority (M20's
  most load-bearing rule, and a pricing page is where it dies quietly).
- **"The free week is Plus, not Premium."** M20 grants the trial `plus`, so
  nobody experiences collaboration before paying for it; the Premium card says
  so in as many words, because that gate is met cold.
- **"Prices can change. Yours doesn't."** A purchase pins a plan version and a
  republished price affects new purchases only — a promise the schema already
  keeps, so saying it out loud is free.
- **Cancelling runs to the end of the paid period**, then lapses through M20's
  resolver — link 5's behaviour, stated before the sale rather than after it.
- §14's copy rules still hold: no "free" as a positioning claim, no "no credit
  card". The `Free` **plan name** is not that claim.

## Exit gate

- [ ] **Republishing a plan at a new price leaves an existing subscriber's
      bill and entitlements untouched**, and the next purchase of that plan
      charges the new price and grants the new terms. Walked end to end, both
      halves.
- [ ] **No published plan version's price is ever edited**, and every priced
      version's `stripe_price_id` resolves to a Stripe Price with a matching
      amount and currency — checked, because a divergence errors nowhere.
      *(**Amended 2026-09-02**: was "no published `plan_versions` row's price".
      Versions are a committed file, so "never edited" is provable in a diff as
      well as in a test — but the `stripe_price_id` half gets harder, not
      easier, because committing an id is not the same act as creating the
      Price it names. See link 2.)*

      **Half proven 2026-09-16, and left unticked for the other half.** The live
      purchase resolved `plus@v1`'s lookup key to a real Stripe Price and
      charged $9 USD monthly, which is `assertPriceMatches` passing against
      Stripe rather than against a fixture — it throws `PriceMismatchError` on
      any disagreement in amount, currency OR interval, so a successful charge
      at the catalogue price IS the check for that version. `premium@v1` has
      never been purchased, so its Price has never been resolved. Buying and
      refunding one Premium subscription closes this box.
- [x] A free account subscribes through hosted checkout and its entitlements
      change **only after the webhook is processed** — a forged or replayed
      success redirect grants nothing. — **Walked against live Stripe in
      production, 2026-09-16 04:24 UTC.** `billing_events` carries the four
      deliveries in order, each with `applied_at` set:
      `customer.subscription.created` → `checkout.session.completed` →
      `invoice.payment_succeeded` → `customer.subscription.updated`, and
      `subscriptions` gained its row at 04:24:46 — the same instant the first
      event applied, not at the redirect.

      **The "only after" half is proven by `soleWriter.test.ts` rather than by
      exercising the redirect by hand, and that is the stronger proof.** The
      box asked for one walk in which the redirect fires and the webhook does
      not; the sweep asserts that **no code path anywhere** writes
      `subscriptions` or `users.plan` except the webhook, so there is nothing
      for a forged or replayed redirect to reach. A single walk shows one route
      did not grant; the sweep shows none can, and turns a future
      `/api/billing/success` that "just updates the row so the page has
      something to show" into a red build. Replay is the idempotency box
      above.
- [x] **A webhook with a bad signature is rejected before its body is
      parsed**, and a test asserts it. — `signature.test.ts`. The ordering is
      proven the only way it can be from outside: a body that is neither signed
      nor parseable raises the SIGNATURE's error, not JSON's. There is no second
      path from a body to an event in the app for an unverified body to reach.
- [x] **The same event delivered twice applies once.** Proven by replaying a
      real captured event, not by inspection. — `webhook.int.test.ts`, against a
      real database: the event is replayed byte for byte and the second delivery
      answers `replay` with one subscription row and one `billing_events` row.
      Red-first: defeating the claim turns it red.
- [x] Events applied out of order converge to the correct state. —
      `webhook.int.test.ts`, both orders. The comparison lives in the UPDATE's
      own WHERE clause; red-first on it found and removed a redundant in-memory
      guard that was doing nothing and could drift.
- [ ] **No card number, CVC or expiry is ever entered into, posted to, or
      logged by this application.** Walked, and the network log checked.

      **Walked 2026-09-16; the network log was not read, so this stays open.**
      The purchase went through Stripe's hosted page, which is the design that
      makes the claim true — the app renders no card field anywhere, and
      `checkout.ts:3` and `portal/route.ts:9` say so at both seams. But the box
      asks for two things and only one was done. What remains is small and
      should ride the next checkout: open DevTools → Network, buy, and confirm
      no request to our own origin carries a PAN, CVC or expiry. Until someone
      has looked, "the app has no card input" is an argument from the source
      rather than an observation of the wire, and this box wants the
      observation.
- [x] Cancelling keeps access to the end of the paid period, then lapses
      through **M20's resolver** — no second downgrade path exists. —
      `lapse.int.test.ts`. The strongest assertion in it is *"lapses with
      nothing written and no job run"*: the subscription row is byte-identical
      across the boundary and only the clock moved. **The Stripe-driven walk is
      no longer owed** — done in production 2026-09-16, and the row is the
      evidence: after the downgrade it reads `status: active`,
      `cancel_at_period_end: true`, `current_period_end: 2026-10-16`. Access
      runs to the period end rather than ending at the click, which is the
      behaviour this box exists to protect: an immediate flip would take back a
      month that was already paid for.
- [ ] A `past_due` account is told in the product before it loses anything, and
      lapses only after the grace window — **3 days from the decline**
      (decided 2026-09-13). Walked both ways: a card fixed on day 2 lapses
      nothing and caps no collaborator, and a card never fixed lapses on day 4
      and not on day 3.
- [ ] A lapse walks M20's collaborator cap: three collaborators drop to
      `viewer`, `trip_memberships` is unchanged, and paying again restores them.
- [x] **This milestone's diff touches no gate.** `modelSelection.ts`,
      `quota.ts` and `members.ts` are unmodified — checked, not assumed:
      `git diff --stat <base>...HEAD -- <the three paths>` is empty, and all
      three files exist, so the empty answer is an answer rather than a typo.
- [x] The admin surface reports **MRR**, **ARPU across all accounts and across
      paying accounts separately and labelled as such**, and **margin per
      account over a trailing 30 days**. — `RevenueStrip`, fed by
      `server/billing/revenue.ts`. `admin.console.test.ts` asserts both ARPU
      figures reach the wire AND that the screen labels them differently, since
      two identical labels would satisfy the first half alone.
- [x] **The "costs more than they pay" list is segmented by grant source**, and
      a founder, trial or referral account does not appear among the paying
      accounts that are underwater. A test seeds one comped account and one
      genuinely-underwater paying account and asserts they land in different
      buckets. — `revenue.int.test.ts`, the scenario this box describes, plus a
      third case the box does not: **an account that pays AND holds a grant is
      still a payer**, because being comped as well does not make its bill a
      decision somebody already took. Red-first: merging the buckets puts the
      comped account into the paying list.
- [x] Stripe keys are absent from the repo, present in `.env.example` as
      **names with the secret ones marked**, and test-mode and live-mode keys
      cannot be confused for one another. — the mode is read OUT OF the key
      (`sk_test_` / `sk_live_`), so there is no second variable to disagree with
      it; `config.test.ts` refuses a publishable key, a restricted key, a
      webhook secret and the two swapped round. `grep -r sk_live` is clean.
- [x] **The migration is written, applied locally**, and its production
      dispatch is called out in the PR body. — `0021_subscriptions_and_billing`,
      applied to the local database and exercised by every integration suite
      here. **Dispatched to production and verified there 2026-09-16**, against
      the database rather than against this file: `subscriptions` and
      `billing_events` both exist, `billing_events.applied_at` (0022) and
      `users.stripe_customer_id` are present, and the newest
      `drizzle.__drizzle_migrations` row is 2026-09-15T01:13:58Z. The live
      checkout above is the end-to-end confirmation — the webhook could not
      have written a subscription row into a table that was missing.
- [x] The full Definition of Done is green, including
      `pnpm --filter web test:e2e:ci-like`. — PR #181's `integration-e2e` and
      `static-and-unit` both `success` on the merged head. CI composes the
      ci-like lane rather than running the script by that name: `ci.yml:207-208`
      is `pnpm --filter web build` then `pnpm --filter web test:e2e` with
      `CI=true` set by the runner, which is what `test:e2e:ci-like` expands to.
      The distinction CLAUDE.md rule 1 exists to protect — never serving e2e
      from `pnpm dev` — is held: `ci.yml:68` records that CI serves `next start`.
- [ ] Retro appended at gate close.

## Deliberately not here

- **Any new entitlement, plan, gate or quota.** All M20's. This milestone
  changes who holds a plan, never what a plan means.
- **Tax, invoicing beyond Stripe's own, multi-currency, annual plans,
  proration edge cases, refund automation.** Stripe's portal covers what is
  needed at this size; each of these is a decision nobody has been asked for.
- **Usage-based or metered billing.** Plans are flat monthly. Link 7 answers
  whether the flat price is defensible — it does not make the price a function
  of usage.
- **Removing the admin grant path.** It stays, permanently. See "Why it is
  separate", reason 2.

## Prerequisites

**M20, and it must be closed.** Every entitlement, every gate and the resolver
this milestone drives are M20's. There is nothing here to build without them.

**A Stripe account with test mode**, and its keys set in Vercel Preview and
Production. Vercel injects environment variables at build, so **rotation needs
a redeploy** — the same trap `INVITE_SUPER_CODE` documents at `.env.example:29`.

**~~One decision is Mitchell's before this opens: the prices.~~ DECIDED
2026-09-13:**

| Plan | Price | What it is |
|---|---|---|
| `free` | **$0** | Trip planning, entire. No AI, no collaborators. |
| `plus` | **$9 / month** | The assistant. What the one-week trial grants, so the trial is a real sample of a real plan. |
| `premium` | **$19 / month** | Collaborators, and the entitlements M20's `premium` entry enumerates for itself. |

Flat monthly, USD, no annual plan and no metered billing — all three are in
*Deliberately not here*. M20 defines the three plans and what each grants; it
deliberately prices none of them, and a checkout session cannot ship without a
number, which is what this closes.

**Four things this decision is, and one it is not.**

- **It is a positioning call, not a margin one**, exactly as the paragraph
  below argues: a ceiling-consuming account costs ~$2-$14 a month, so `plus` at
  $9 covers a typical account comfortably and a genuinely heavy one thinly.
  **That thin case is the point of link 7's underwater list**, and the list is
  built to find it rather than to be reassured by it.
- **It prices `plus` where the trial lands.** M20 grants the trial `plus`, so
  the week someone samples is the plan they are then asked to buy. Pricing
  `plus` above what the trial demonstrates would make the trial an advert for a
  different product.
- **`premium` is a little over twice `plus` because it sells a different
  thing** — collaborators, not more assistant. The ladder a buyer reads is
  presentation; **nothing in code may treat $19 > $9 as meaning `premium` ⊇
  `plus`**, which is *a plan is a set, not a rank* meeting a price list, and
  the place it is most likely to die quietly.
- **It is versioned like everything else.** These are `v1` prices. Changing
  them publishes a new version and affects new purchases only; an existing
  subscriber pinned to `v1` keeps paying $9 forever unless they act. There is
  no mechanism to move them — see link 2.

**What it is not: a price string M20 may use.** M20's *Deliberately not here*
is explicit — *"if a price string appears in this milestone's diff, the split
has failed."* These numbers reach `price_minor`, `currency` and
`stripe_price_id` in **link 2 of this milestone**, added to plan-version entries
M20 publishes as free by construction. The decision being made early does not
move it earlier.

**~~Two numbers still owed~~ — both decided 2026-09-13.** The **grace window**
link 6 turns on is **3 days** from the decline (link 6, above). And the
trial's `plus` week is **one time ever per account** — which is **M20's**
decision to implement, not this milestone's, because the trial is a grant
issued at signup: see `M20-account-tiers-and-entitlements.md`, link 8's trial
paragraph, and the schema requirement it carries (an expired trial grant is
never deleted, or the rule silently stops holding). Nothing is owed on either
before this milestone opens.

**Cost is not the constraint on that decision.** M20 link 5 works it through
against the models actually configured — `deepseek/deepseek-v4-flash-0731` at
$0.13/$0.26 per MTok (US regional) and `zai/glm-4.7-flash` at $0.07/$0.40,
billed at provider list price because Vercel AI Gateway takes no markup. A
single live request cost **about six hundredths of a cent**, and an account
consuming the entire daily ceiling lands between **~$2 and ~$14 a month.**
(Both rates and both bounds corrected 2026-09-12 against the live catalogue;
this paragraph carried M20's stale $0.22/$0.66 and the ~$3-$25 band derived
from it.) Any plausible
subscription price clears that with room, so the prices are a positioning
question, not a margin one, and the quotas are an abuse bound rather than a
cost defence.

**What still argues for setting prices after M9 is evidence, not arithmetic.**
`AskAnalyticsRecord` already carries `usage{inputTokens, outputTokens}` and
`usageByStep` per call (`askAnalytics.ts:162-217`), and the `ai-usage` skill
reads those records out of Vercel runtime logs — so the instrumentation is
there. What is thin is **volume**: `ai-live` defaults off, and
`M16-assistant-read-agent.md` records that Vercel held exactly **one**
`ai.ask` entry across seven days, because local runs log to the local console
and never reach it. One record fixes the order of magnitude; it cannot tell
you what a *typical* turn costs, how many steps a real question takes, or
what the distribution's tail looks like. M9 turns `ai-live` on and link 7
attributes spend per account — together they turn one data point into a
distribution.

Link 7's per-account attribution and the `/ask` step-metering fix are what
make that measurement per-account rather than aggregate.

**M20 link 9, and it must be closed.** The `ai_usage` ledger and the `/ask`
step-metering fix both moved into M20 on 2026-09-01, when the financial
metrics were asked for. Link 7 here is only the revenue half — without the
cost half there is nothing to compare against, and no price can be defended.

## What was built — 2026-09-14/15

Four phases, four commits, on `claude/keen-darwin-qkkq41`. The scope is this
file's seven links (eight, counting the duplicated *7*). What follows is the
record of **where the build deviates from this file**, because every one of
those was a decision and each would otherwise be rediscovered as a discrepancy.

### Five deviations, and why each one

1. **The price went onto the v1 entries, not onto new versions.** This file's
   link 2 says *"adds `price_minor`, `currency` and `stripe_price_id` to the
   same entry"* and `planVersions.ts`'s own header says the same; link 7 says
   *"as a new dated version, never an edit to a published one"*. Those
   contradict, and the build followed the first.

   **Naming a price for the first time is not editing one.** The rule's reason
   is that a change must not retroactively rewrite what anyone was sold, and
   nothing had been sold — M21 is the milestone that creates the first
   subscription, and until it shipped there was no `price` field to hold a
   different value. From here the rule binds mechanically:
   `planVersions.noExtension.test.ts` pins every published v1 entry field by
   field, price included, so changing $9 to $10 in place fails a test in the
   same diff that does it.

2. **`price` is one nullable record, not three sibling fields.** The invariant
   between the three is all-or-none: a currency with no amount is a state no
   caller can act on. A nullable record makes that unrepresentable; three
   nullable fields make it a test. `null` means *not sold for money* (`studio`,
   which ships disabled) and is deliberately a different fact from `free`'s real
   zero.

3. **The committed Stripe pairing is a lookup key, not an id.** Link 2 asks for
   a committed `stripe_price_id` and names the hazard in the same breath — *"a
   committed `stripe_price_id` that names a Price nobody created is a checkout
   that fails at the till"* — because creating the Price is a runtime act and
   the publish step it used to hang off is gone. An id cannot honestly be
   committed before the Price exists.

   `priceLookupKey` is a pure function of plan, version, currency and amount, so
   the committed identifier cannot disagree with the price it names, and
   **changing the amount changes the key**, which resolves to a different Stripe
   Price rather than silently reusing an immutable old one. The field is still
   there (`stripePriceId`) and is still checked when present; it is simply
   `null` until somebody fills it in, which is an optimisation rather than a
   requirement.

4. **No Stripe SDK** — ADR-047 decision 2 carries the argument. The short
   version: six form-encoded calls, because the app never sees a card number;
   and the thing an SDK would really have bought is `constructEvent`, while the
   gate box asks for an *ordering* claim that is only provable if we control the
   order. The cost is ours and is stated: we own the response shapes we read and
   the API version we pin.

5. **`plans` is a route, and the sheet lost its chooser** — this is the design's
   deviation rather than the build's (SPEC §29, 2026-09-14), and it supersedes
   link 5's last bullet. It makes link 5's surface *smaller*: the sheet keeps
   plan, version, state, meters, past-due and referral, and the route holds what
   the sheet never had.

### One thing the design asks for that this build does not do

§29 asks that the assistant's floating dock be **hidden, not unmounted**, on
`plans` — `visibility: hidden; pointer-events: none`, so coming back does not
reset its thread, open state and dragged position.

**In this build there is no dock on that route to hide.** The dock is mounted by
`TripBoardScreen` and is trip-scoped; `plans` is account scope, so nothing is in
the tree and nothing is lost by its absence — which is the end state §29 is
protecting. Mounting a global dock in order to hide it would be building the
design's architecture to satisfy a rule about the design's architecture. Written
down in `app/(app)/plans/page.tsx` as well, where somebody comparing the screen
to the design would look.

### Two states the design does not draw, and both are built

§29 names them and says neither has a design yet.

- **Return-from-Stripe-before-webhook.** The result state §29 draws *"is faked
  in the design file — it is reached by a click"*. In the build, coming back
  from Checkout lands on a **pending** state that re-reads the account until the
  plan actually moves, says what is actually happening rather than implying it
  is nearly done, and after twenty attempts says *that* too. Not a spinner that
  lies. `m21-plans.spec.ts` drives the forged redirect by typing the URL.
- **A stale plan version at pay time is a conflict, not an error.** Applying a
  change carries the version the confirm step was rendered against; a mismatch
  is a 409 and the step re-renders with the new numbers and says nothing has
  been charged.

### What is still owed

**All of it needs a Stripe test-mode key**, which no lane in this repo has and
which the milestone's own *Why it is separate* predicted: *"Stripe brings an
external service that cannot be driven from `test:e2e:ci-like`."* The recipe for
every one of these, for $0.00, is
**`docs/guidelines/billing-without-spending-money.md`**.

- A free account buying `plus` on a hosted checkout, end to end.
- The **network log checked** for the no-card-number box. Structurally there is
  no card field in this repo's DOM to find, and the box asks for a walk.
- The `stripe_price_id` half of the consistency check — `checkPriceConsistency()`
  is written and reports `ok` / `missing` / `mismatch` / `unpriced`; nothing has
  run it against a real account.
- The grace window **walked** rather than unit-proven: Test Clocks, a
  `4000 0000 0000 0341`, day 2 and day 4. The guide has the commands.
- The collaborator cap walked with three real collaborators on a real trip.
- Republishing at a new price with a real subscriber on the old one.

### Verification actually performed

Tier 2 throughout, then the full lane at the end. `pnpm --filter web typecheck`,
`pnpm lint` (every wall, including the migration journal and the colour wall),
the unit suite, the integration lane against a local database with `0021`
applied, and `pnpm --filter web test:e2e:ci-like`.

**Red-first on five assertions**, per CLAUDE.md rule 3 — the grace boundary, the
price mismatch, webhook idempotency, ordering tolerance, and the underwater
segmentation. The ordering one **survived its first aim**, which is the finding
worth keeping: defeating the in-memory staleness check changed no test outcome
because the SQL WHERE clause was doing the work either way. Two guards where one
is load-bearing is one guard plus a thing that can drift, so the redundant one is
gone.

**Two of M20's own guards fired on this work and both were real**, not
allowlisted around: `planVersions.fourthPlan.test.ts` refused a `switch` over
plan ids in the plans route's copy and a `planId === "free"` in the plan-change
path. The first is now derived from what a plan grants (so the disabled fourth
plan gets a true line for free); the second asks the price (so a second
zero-priced plan behaves identically without anyone adding it to a list).

**`test:e2e:ci-like` caught a build failure `test:e2e` could not.** `/plans`
reads `useSearchParams()`, which fails the production build outright without a
Suspense boundary — and the dev lane compiles a route on first hit and never
prerenders it, so the route worked perfectly in `pnpm dev`. That is CLAUDE.md
rule 1 paying for itself in the same session it was read.


## What review found — 2026-09-15

PR #177 collected three independent reviews on the same head, and between them
they found **sixteen defects in code that passed every local lane.** That is the
number worth keeping: the branch had a full green suite, 131 e2e specs, five
red-first proofs and a written verification section, and none of it caught any
of these.

### The four that would have cost money or trust

1. **An existing subscriber could be charged twice.** `startCheckout` refused a
   second subscription *to the same plan* and let a live `plus` subscriber open
   a checkout for `premium`, which Stripe would happily create alongside the
   first. The UI never took that path — `applyPlanChange` routes a live
   subscription to a Stripe update — which is exactly why the guard failed: it
   was correct about its only caller and the endpoint is reachable without it.
   *This is the milestone's own stated blast radius.* (CodeRabbit)
2. **A failed webhook delivery lost its event permanently.** The claim was
   written before the work ran and nothing recorded that the work finished, so
   a throw anywhere after the claim meant Stripe's retry was answered `replay`
   and the effect was never applied. For `checkout.session.completed` that is
   terminal: the `client_reference_id` naming the account rides on that event
   and no other, so a paid account would sit on `free` with no path back.
   `webhook.int.test.ts` had a test *pinning this as an accepted trade-off*;
   it was not one. Fixed with `billing_events.applied_at` (migration 0022).
   (CodeRabbit)
3. **The confirm step promised a payment it did not take.**
   `proration_behavior: "create_prorations"` computes the adjustment and leaves
   it for the *next* invoice, under a button reading `Pay $11.47 with Stripe`.
   `always_invoice` is what collects it. (CodeRabbit)
4. **The pending screen claimed a payment had happened, on a forged URL.**
   *"Your payment has gone through"*, rendered on the presence of a query
   parameter alone — and on the preview, four inches below a banner saying
   nothing could be bought on that deployment. The e2e asserted the panel was
   VISIBLE and never read a word of it. (Browser walk.)

### What each review was uniquely able to see

- **CodeQL** found the one thing static analysis is for: a Stripe object id
  from a webhook body reaching a URL. Host injection was not possible — the
  authority is a constant — but "the attacker cannot reach another host" is a
  weaker guarantee than "the value is not attacker-shaped", and the second one
  costs a regex.
- **CodeRabbit** found the state machines: idempotency keys that named a target
  state rather than an operation (so cancel → resume → cancel replayed the first
  cancellation), a price check that would sell a `$9/year` Price under a
  `$9/month` label, a trial grant outranking a subscription so a paying customer
  read *Free week*, margins computed from costs we know are incomplete, and two
  "disjoint" segments that both counted the same account.
- **A browser walk** found the things only a person reads: two surfaces one
  click apart saying *"Questions 0 / 50"* and *"No assistant"* about the same
  account, a held line reading *"You are on free — Free week, free."*, a badge
  saying *Free week* with no date anywhere for when the week ends, and a
  pending screen with no way back to the plans it replaced.

### The lesson the verification section did not have

**Every one of the four expensive defects had a passing test over it.** Not a
missing test — a test that asserted presence, or state, or a substring, on the
exact path where the defect lived. `toContainText("free")` passes against *"You
are on free — Free, free."* A test that the pending panel is visible passes
against any words inside it. A test naming a trade-off documents a defect rather
than catching it.

`docs/guidelines/testing.md` §3 asks that a test be seen to fail for its own
reason. That was done here, five times, and it is necessary rather than
sufficient: a test can fail for its own reason and still be pointed at the wrong
question. **Where a screen's job is to say something true, the assertion has to
be on what it says.**

## What the preview walk found — 2026-09-15

Five threads on PR #177's Vercel preview, left by Mitchell between 01:23 and
01:27. They are a **fifth review surface** with its own mechanics
(`docs/guidelines/working-a-review.md`), and four of the five were design
decisions this build had got wrong rather than bugs.

### A rule stated twice, which reverses §17.3

Two of the threads say the same thing about two different gates:

> *"I thought the free tier shouldnt let me invite people? We should keep the ui
> but have it greyed out, and have a CTA to get people to upgrade."*

> *"Same thing here, the assistant should still be openable but the input should
> be disabled, and the text container above should be a CTA To upgrade"*

**M20 built the opposite, deliberately, and wrote down why.** `TravelersPanel`'s
comment read *"a disabled button beside an explanation would be the obvious move
and the worse one: it offers a control that can never work"*, and the rail's
read *"a 'See your plan' button here today would be a control that does nothing,
which is worse than a sentence that is true."* Both were correct **for M20**,
and both are now wrong, for one reason: **M20 had nowhere to send anybody.**
There was no chooser, no checkout and no route. The control genuinely could
never work, so hiding it was honest.

§29 gives plans a route and M21 gives it a checkout, so the same control is one
that works as soon as the CTA beside it is taken. The argument did not lose; its
premise expired. Recorded here because the old reasoning is written into three
comments and two test files, and a reader who finds it without this will
reasonably think the reversal was an accident.

The shape, now shared by both gates: **the affordance stays, every control in it
is disabled, and a CTA to `/plans` sits above it.** No price on either surface —
§29 keeps prices on the plans route and nowhere else, so both CTAs name the
destination instead of a number.

### The gate moved earlier, which needed data the rail did not have

`askUpgrade` only existed *after* the server refused a question with 402, so a
free account got a live-looking composer, typed a question, and was told
afterwards. Disabling it up front needs the answer before anything is typed —
`components/assistant/useAiEntitled.ts`, one cached read of
`GET /api/account/plan` (ADR-046), asking `entitlements.includes("ai.ask")`
rather than comparing a plan id (ADR-045 rule 4).

**`null` means entitled**, and that is the whole risk in the file. The hook
resolves `null` while loading and whenever the read fails, and treating either
as *not entitled* would flash a paywall at a paying subscriber on every open.
Being wrong the permissive way costs one refused request; being wrong the strict
way blocks a customer on a bad network. The rail only mounts while the assistant
is open, so nobody who never opens it pays for the read at all.

### The assertion that would have been decorative

Gating the composer's input and its Ask button is not the gate — the suggested
question chips call `onAsk` directly, and the Enter key reaches `submitAsk`
without passing the button. Three ways in, so the refusal is spelled on all
three plus inside `submitAsk` itself.

`AssistantRail.test.tsx`'s *"gates the suggested questions too"* is the one
assertion that catches this, and **every other test in that describe block
passes with the chips still live** — the same failure mode this milestone's
previous section is about, caught this time before it shipped rather than after.

### The one that is a design question, not a fix

> *"This Add Stop button i believe was added for mobile, it shouldnt show in
> desktop"*

It is not a phone control and it is not a duplicate: each day column has its own
`+ Add`, and the header's bare `openCreate()` is the only way to make a stop
belonging to **no** day — the Backlog column's old button, folded into the
header when that column became the Unscheduled drawer. The drawer moves existing
stops onto days and mints none. Hiding it on desktop removes a capability at
that width. Filed in `TODO.md` → *Candidate ideas* with the three real options,
and answered on the thread rather than guessed at.
