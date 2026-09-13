# M21 — An account can pay for itself

**Status:** Scoped and placed 2026-09-01, immediately after M20. **Reordered
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
- [ ] A free account subscribes through hosted checkout and its entitlements
      change **only after the webhook is processed** — a forged or replayed
      success redirect grants nothing. Proven by exercising the redirect
      without the webhook.
- [ ] **A webhook with a bad signature is rejected before its body is
      parsed**, and a test asserts it.
- [ ] **The same event delivered twice applies once.** Proven by replaying a
      real captured event, not by inspection.
- [ ] Events applied out of order converge to the correct state.
- [ ] **No card number, CVC or expiry is ever entered into, posted to, or
      logged by this application.** Walked, and the network log checked.
- [ ] Cancelling keeps access to the end of the paid period, then lapses
      through **M20's resolver** — no second downgrade path exists.
- [ ] A `past_due` account is told in the product before it loses anything, and
      lapses only after the grace window — **3 days from the decline**
      (decided 2026-09-13). Walked both ways: a card fixed on day 2 lapses
      nothing and caps no collaborator, and a card never fixed lapses on day 4
      and not on day 3.
- [ ] A lapse walks M20's collaborator cap: three collaborators drop to
      `viewer`, `trip_memberships` is unchanged, and paying again restores them.
- [ ] **This milestone's diff touches no gate.** `modelSelection.ts`,
      `quota.ts` and `members.ts` are unmodified — checked, not assumed.
- [ ] The admin surface reports **MRR**, **ARPU across all accounts and across
      paying accounts separately and labelled as such**, and **margin per
      account over a trailing 30 days**.
- [ ] **The "costs more than they pay" list is segmented by grant source**, and
      a founder, trial or referral account does not appear among the paying
      accounts that are underwater. A test seeds one comped account and one
      genuinely-underwater paying account and asserts they land in different
      buckets — unsegmented, the comped accounts swamp the list and the metric
      is worthless.
- [ ] Stripe keys are absent from the repo, present in `.env.example` as
      **names with the secret ones marked**, and test-mode and live-mode keys
      cannot be confused for one another.
- [ ] **The migration is written, applied locally, and its production dispatch
      is called out in the PR body.**
- [ ] The full Definition of Done is green, including
      `pnpm --filter web test:e2e:ci-like`.
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
