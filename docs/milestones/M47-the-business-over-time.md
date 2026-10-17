# M47 — The operator console shows tiers over time, and paid flows can be tested in production

**Status:** **Proposed 2026-10-06, placed after M46. Scoped 2026-10-17**: all four decisions
below were answered by Mitchell that day, after a code survey of billing, the webhook, the console
and the cron. Minted from `docs/candidates.md` (see `docs/milestones/README.md`, *2026-10-06 —
proposed: M37 to M47*). It is placed last because both halves pay off once there are paying users.
The workaround for testing (`entitlement_grants` for testers, and `stripe listen` locally for
checkout) covers the time before that. M46 stays the current milestone until its gate close merges.

ADR: `docs/architecture/ADR-076-stripe-test-mode-runs-beside-live.md` (amends ADR-047). Plan:
`docs/plans/2026-10-17-M47-the-business-over-time.md` (deleted at the close).

## Why this exists

Both entries concern billing data that cannot answer a question about time or mode.

- **Tier history.** The 2026-10-05 operator handoff draws one area chart per tier: accounts per
  tier at the end of each of 26 weeks, with *+N added* and *−N lost*. M36 decision 4 moved it out
  of M36, because nothing stores what was held last week.
- **Test mode beside live.** 2026-09-16: *"i would like to be able to use test card without needing
  to take down prod with new ENV variables."* There is no `livemode` column, so a test subscription
  would count as revenue. `users.stripe_customer_id` is a single column, so a test customer and a
  live customer collide.

Candidates absorbed (each deleted by this gate):
- *Accounts by tier, week by week, on the operator console* (2026-10-06)
- *Stripe test mode alongside live, without a redeploy to switch* (2026-09-16)

## Decisions (answered by Mitchell, 2026-10-17)

1. **Tier history is a weekly rollup table written by a Vercel cron.** `tier_weekly(week_start,
   plan_id)` is unique, holds the count of accounts holding that tier, and is written by an
   idempotent upsert from a new route, `/api/cron/tier-rollup`, which reuses `server/cronAuth.ts`
   (Bearer `CRON_SECRET`, fail closed). It counts **live holdings only** (decision 2's
   `users.plan_livemode`), the same population the console's tier panel counts, so the chart's
   *now* equals the panel. It is exact from the day it ships, the chart says *"since <date>"*, and
   **nothing is back-filled**. *As recommended.* Why: deriving history from `entitlement_grants`
   and `billing_events` has never been checked against Stripe's own record, and `billing_events`
   carries no account or plan (`server/db/schema.ts:1571-1597`), so a back-fill would be a guess
   drawn as a fact.
2. **`livemode` goes on `subscriptions` and `billing_events`, the Stripe customer id moves to a
   `stripe_customers(user_id, livemode, customer_id)` table, and `users.plan_livemode` records
   the mode of the held plan.** Existing rows are back-filled as live: production has only ever
   had a live key. `users.plan_livemode` is set by the webhook from the verified event, because
   the console's tier panel counts `users.plan_id` (`server/entitlements/admin.ts:211-219`), which
   a test checkout also sets (`syncHeldPlan`, `server/billing/webhook.ts:295-311`). **Every money
   read filters on it**: `subscriptionsWithStatus` (`server/billing/subscriptions.ts:56`) and its
   callers in `revenue.ts` (MRR, underwater, revenue by plan) and the console (`admin.ts`,
   `adminAccount.ts`), the accounts table's *paying* filter, and the tier panel. Price lookup is
   per mode too, because a Price id differs between Stripe's two accounts. *Recommended, with the
   customer table and `plan_livemode` added.* Why a table rather than a second column: a customer
   is per account **per mode**, and a table keyed on the pair is the shape of that fact; a second
   column would be the third place a mode is spelled.
3. **The webhook tries both secrets** (`STRIPE_WEBHOOK_SECRET`, and a new
   `STRIPE_TEST_WEBHOOK_SECRET`, with `STRIPE_TEST_SECRET_KEY` beside `STRIPE_SECRET_KEY`). **The
   secret that verifies decides the mode.** An event whose verified `livemode` field disagrees
   with it is refused (400) and nothing is written. *Recommended, with the refusal made the rule.*
   Why: the mode is then a fact about which key Stripe signed with, never about what an
   unverified payload says (ADR-047); and refusing a disagreement, rather than recording it as
   test, means no row is ever written whose mode two sources disagree about. Recorded as
   **ADR-076**, amending ADR-047.
4. **The test-mode switch is `users.stripe_test_mode`, per account, server-only and
   admin-only.** It is set by GET/PUT `/api/admin/accounts/[accountId]/test-mode` behind
   `requireAdminApi` (404 for a non-admin, `server/entitlements/requireAdmin.ts:20-26`) and a
   toggle on the console's account page. It is never in any payload the account itself can
   read. Checkout, the portal and a plan change pick the mode's key, customer and prices from it.
   **A test checkout confers the plan like a real one**, with `plan_livemode = false`, so the
   tester sees the paid product and the business sees nothing. *As recommended.* Why: a
   client-readable or client-settable flag that confers a plan for a test card would be a
   free-premium switch.

KI-2026-10-17-a (trip planning imports the AI embed queue) does not reach this milestone: nothing
in `server/billing/`, `server/entitlements/`, `app/api/stripe/`, `app/api/admin/` or `app/admin/`
imports `server/commands.ts` or `server/ai/`. The one overlap is the cron folder:
`app/api/cron/embed-days/route.ts:8` imports `server/ai/sweep`, so the tier rollup is **its own
route** importing nothing from `server/ai/`, never a step added to the embed route.

## Scope

- The rollup table, its job, and the Users tab chart.
- The `livemode` migration, the per-mode customer id, the filtered reads, the dual-secret webhook,
  and the admin switch.

Four parts, each its own PR on `main` (plan: `docs/plans/2026-10-17-M47-the-business-over-time.md`):

| Part | Branch | Theme | Depends on |
|---|---|---|---|
| 1 | `claude/m47-part1-mode-keyed-data` | migration `0055` (`livemode` on `subscriptions` and `billing_events`, `stripe_customers`, `users.plan_livemode`), `stripeCustomerFor` by mode, the livemode filter on every money read and the tier panel | — |
| 2 | `claude/m47-part2-dual-secret-webhook` | config per mode, the signature tried against both secrets, a mode mismatch refused, the webhook writing `livemode` and `plan_livemode`, the Stripe key and prices per mode, the billing guideline | 1 |
| 3 | `claude/m47-part3-admin-test-mode-switch` | `users.stripe_test_mode` (migration), the admin route, the account page toggle, checkout, portal and plan change choosing the mode | 1, 2 |
| 4 | `claude/m47-part4-tier-rollup` | `tier_weekly` (migration), the rollup and its cron route, `vercel.json`, the Users tab's per-tier charts | 1 |

## Out of scope

- Back-filling tier history from before the job ships.

## Exit gate

- [x] **Decisions 1–4 are answered and recorded here.** Mitchell, 2026-10-17; ADR-076.
- [ ] **The rollup job is idempotent per week**: running it twice for one week writes one row,
      which an integration test shows.
- [ ] **A test-mode subscription adds nothing to MRR or the tier panels**, in an integration test
      seen red without the filter. That covers the tier panel and the weekly rollup excluding a
      test holding (`plan_livemode = false`) as well as the revenue reads.
- [ ] **An event signed with the test secret but claiming `livemode: true` is refused** (400
      `mode-mismatch`), and nothing is written for it, `billing_events` included (decision 3;
      the earlier *"or is recorded as test"* is ruled out by ADR-076).
- [ ] **The switch cannot be read or set by a non-admin**: a route test checks both.
- [ ] **[walk]** On production, an admin-switched account checks out with a test card, and MRR
      does not move. Walked by Mitchell.
- [ ] A retro is appended at gate close.
