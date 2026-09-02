# M21 — An account can pay for itself

**Status:** Scoped and placed 2026-09-01, immediately after M20:
`M17 → M9 → M20 → M21 → M12 → M13 → M14 → M19`.

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

2. **Price on the plan version, and the Stripe Price it maps to.** M20's
   `plan_versions` rows are immutable and carry entitlements and ceilings;
   this milestone adds `price_minor`, `currency` and **`stripe_price_id`** to
   the same row. Publishing a priced version creates or links a Stripe Price;
   an existing version's price is never edited, because Stripe Prices are
   themselves immutable and the two would silently diverge.

   **Division of authority, stated once:** the plan version is the source of
   truth for **what is granted**; Stripe is the source of truth for **what is
   charged**. They must agree, and a check asserts that every published priced
   version's `stripe_price_id` resolves to a Stripe Price with the same amount
   and currency — a mismatch means the pricing page and the card statement
   disagree, which is the worst class of billing bug because nothing errors.

   **A price change is a new version and affects new purchases only.** An
   existing subscriber keeps paying what they agreed and keeps the terms they
   bought, because their subscription pins `v1`. Moving them is M20 link 7's
   explicit migrate action — the same single operation whether the change is a
   rise they should be spared or a cut they should get. This is Mitchell's
   requirement, 2026-09-01, and it is the reason plan contents became data in
   M20 rather than staying in code.
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
6. **Failed payment.** A `past_due` subscription keeps its entitlements for a
   defined grace window and then lapses. The account is told, in the product,
   before anything is taken away — a capability that disappears silently is
   indistinguishable from a bug, and M20's collaborator cap means the owner's
   guests feel it too.
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

## Exit gate

- [ ] **Republishing a plan at a new price leaves an existing subscriber's
      bill and entitlements untouched**, and the next purchase of that plan
      charges the new price and grants the new terms. Walked end to end, both
      halves.
- [ ] **No published `plan_versions` row's price is ever edited**, and every
      priced version's `stripe_price_id` resolves to a Stripe Price with a
      matching amount and currency — checked, because a divergence errors
      nowhere.
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
      lapses only after the grace window.
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

**One decision is Mitchell's before this opens: the prices.** M20 defines the
three plans and what each grants; it deliberately prices none of them, and a
checkout session cannot ship without a number.

**Cost is not the constraint on that decision.** M20 link 5 works it through
against the models actually configured — `deepseek/deepseek-v4-flash-0731` at
$0.22/$0.66 per MTok and `zai/glm-4.7-flash` at $0.06/$0.40, billed at
provider list price because Vercel AI Gateway takes no markup. A single live
request cost **about a ninth of a cent**, and an account consuming the entire
daily ceiling lands between **~$3 and ~$25 a month.** Any plausible
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
