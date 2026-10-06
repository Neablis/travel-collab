# M47 — The operator console shows tiers over time, and paid flows can be tested in production

**Status:** **Proposed 2026-10-06, placed after M46. Not scoped yet**: the decisions below are
recommendations and none has been answered. Minted from `docs/candidates.md` (see
`docs/milestones/README.md`, *2026-10-06 — proposed: M37 to M47*). It is placed last because both
halves pay off once there are paying users. The workaround for testing (`entitlement_grants` for
testers, and `stripe listen` locally for checkout) covers the time before that.

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

## Decisions it needs (recommendations; none answered)

1. **Tier history is a weekly rollup table written by a scheduled job.** *Recommended:* it is
   exact from the day it ships, and the chart says *"since <date>"*. Deriving history from
   `entitlement_grants` and `billing_events` back-fills it, but has never been checked against
   Stripe's own record.
2. **`livemode` goes on `subscriptions` and `billing_events`, and the Stripe customer id is keyed
   by mode.** Every read that treats a subscription as money filters on it: `revenue.ts` and the
   console's tier and underwater panels.
3. **The webhook verifies against both secrets**, and reads the mode only from the verified event,
   never from the unverified payload (ADR-047).
4. **The test-mode switch is per account, server-side and admin-only.** It is never readable by
   the client, because a client-readable flag that grants entitlements for a test card would be a
   free-premium switch.

## Scope

- The rollup table, its job, and the Users tab chart.
- The `livemode` migration, the per-mode customer id, the filtered reads, the dual-secret webhook,
  and the admin switch.

## Out of scope

- Back-filling tier history from before the job ships.

## Exit gate

- [ ] **Decisions 1–4 are answered and recorded here.**
- [ ] **The rollup job is idempotent per week**: running it twice for one week writes one row,
      which an integration test shows.
- [ ] **A test-mode subscription adds nothing to MRR or the tier panels**, in an integration test
      seen red without the filter.
- [ ] **An event signed with the test secret but claiming `livemode: true` is refused**, or is
      recorded as test, never as live.
- [ ] **The switch cannot be read or set by a non-admin**: a route test checks both.
- [ ] **[walk]** On production, an admin-switched account checks out with a test card, and MRR
      does not move. Walked by Mitchell.
- [ ] A retro is appended at gate close.
