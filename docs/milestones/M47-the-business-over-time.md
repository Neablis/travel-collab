# M47 — The operator console shows tiers over time, and paid flows can be tested in production

**Status:** **Proposed 2026-10-06, placed after M46. Scoped 2026-10-17**: all four decisions
below were answered by Mitchell that day, after a code survey of billing, the webhook, the console
and the cron. Minted from `docs/candidates.md` (see `docs/milestones/README.md`, *2026-10-06 —
proposed: M37 to M47*). It is placed last because both halves pay off once there are paying users.
The workaround for testing (`entitlement_grants` for testers, and `stripe listen` locally for
checkout) covers the time before that. M46 stays the current milestone until its gate close merges.

**Built 2026-10-17.** All four parts merged that day: PR 474 (part 1, merge `9c0fed5`), PR 476
(part 2, `21c861e`), PR 477 (part 3, `4947aa0`), PR 475 (part 4, `b026115`). Production migrated
from `b026115` (`migrate-production` run 39048588747): `0055_mode_keyed_billing`,
`0056_admin_test_mode_switch`, `0057_tier_weekly`. **Gate closed 2026-10-18, 7 of 7**, on
Mitchell's production test-card walk.

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
- [x] **The rollup job is idempotent per week**: running it twice for one week writes one row,
      which an integration test shows. `apps/web/src/server/entitlements/tierRollup.int.test.ts`,
      *run twice in one week leaves one row per plan, holding the second run's count*; seen red
      on PR 475 with the upsert made a plain insert (`duplicate key value violates unique
      constraint "tier_weekly_week_plan"`) and with `.onConflictDoNothing()` (`expected +0 to be
      1`). Green in CI run 39047067614 (`test / integration`) on PR 475's head `bad34b9`, whose
      tree is `main` at `b026115`.
- [x] **A test-mode subscription adds nothing to MRR or the tier panels**, in an integration test
      seen red without the filter. That covers the tier panel and the weekly rollup excluding a
      test holding (`plan_livemode = false`) as well as the revenue reads.
      `revenue.int.test.ts` *a test-mode subscription* (MRR and paying count, underwater report,
      revenue by plan), seen red on PR 474 without `subscriptionsWithStatus`'s livemode filter
      (`expected 18000000 to be 9000000`); `admin.int.test.ts` *leaves a test-mode holding out of
      the tier panel*, seen red without `planPanel`'s filter (`expected 2 to be 1`);
      `tierRollup.int.test.ts` *does not count a plan held from a test-mode checkout*, seen red on
      PR 475 without its filter (`expected 2 to be 1`). Green in CI run 39021352293 (PR 474,
      `c85a266`) and run 39047067614 (PR 475, `bad34b9` = `main` at `b026115`).
- [x] **An event signed with the test secret but claiming `livemode: true` is refused** (400
      `mode-mismatch`), and nothing is written for it, `billing_events` included (decision 3;
      the earlier *"or is recorded as test"* is ruled out by ADR-076).
      `webhook.int.test.ts` *is refused 400 mode-mismatch, writing nothing, when it says livemode:
      true* and `signature.test.ts` *is refused when the test secret verified a body that says
      livemode: true*; seen red on PR 476 with the mismatch check disabled (`expected 200 to be
      400`; `expected function to throw an error, but it didn't`). Green in CI run 39020671334
      (PR 476, `0acee08`) and run 39047067614 (`main`'s tree at `b026115`).
- [x] **The switch cannot be read or set by a non-admin**: a route test checks both.
      `apps/web/src/app/api/admin/accounts/[accountId]/test-mode/route.int.test.ts`, *404s a
      signed-in non-admin's GET and PUT, and the column is unchanged*; seen red on PR 477 with
      `requireAdminApi` deleted from `PUT` (`expected 200 to be 404`, 3 failed). Green in CI run
      39020918905 (PR 477, `80d6892`) and run 39047067614 (`main`'s tree at `b026115`).
- [x] **[walk]** On production, an admin-switched account checks out with a test card, and MRR
      does not move. Walked by Mitchell. **Ticked on Mitchell's word, 2026-10-18** (*"I walked
      M47"*). The set-up it needed is in Vercel: `STRIPE_TEST_SECRET_KEY` and
      `STRIPE_TEST_WEBHOOK_SECRET` were added to the Production scope at 03:48 UTC, and production
      redeployed after them at 03:49 UTC (`dpl_Hkg9tdwiJZKXsYunEfMQpJ1mk2ab`, `main` at
      `47e8254`). The migrations were already done (run 39048588747). No part had a preview browser
      walk: the build ran unattended, so this walk is the only time the toggle and the charts
      have been seen outside component tests.
- [x] A retro is appended at gate close. Below, written before the [walk]; the close session's
      spend is added under *Spend*.

## Retro — written 2026-10-17 (6 of 7 boxes ticked)

Written before the gate closes: the [walk] box is Mitchell's production test-card walk, and
`pnpm milestone close M47` runs after it. Three orchestrator sessions built M47; the spend blocks of
the first two are below, and the third (the close) adds its own at hand-off.

### What went well

- **All four parts merged on the day they were planned.** PR 474 (`9c0fed5`), PR 476 (`21c861e`),
  PR 477 (`4947aa0`) and PR 475 (`b026115`), 2026-10-17 15:45–16:14 UTC, each with `ci-ok` green on
  its head (runs 39021352293, 39020671334, 39020918905, 39047067614). PR 475 merged last with
  parts 1–3 already in its head, so run 39047067614 tested exactly `main`'s tree at `b026115`.
- **Production migrated in one dispatch**: `migrate-production` run 39048588747 from `b026115`;
  on the Neon production branch `__drizzle_migrations` ids 56, 57 and 58 are
  `0055_mode_keyed_billing`, `0056_admin_test_mode_switch` and `0057_tier_weekly`, and
  `tier_weekly` exists.
- **Every gate test was seen red for its reason**, with the source edit and failure text in its
  PR body (the boxes above cite them). PR 474's body alone records 21 red-first edits.
- **Review found real defects before merge.** Part 2's rounds 1 to 4 produced ADR-076 §8 (a test
  event applies only where its checkout began; no delivery writes a row in the other mode; live
  drops alert); part 3's review made the referral reward a money read (ADR-076 §4) and fixed the
  portal's mode (three red-first cases in PR 477).
- **PR 474 made web unit failures annotate in CI** (the `dot` reporter had suppressed vitest's
  github-actions reporter), after a unit red that matched KI-2026-10-14-c could not be read from
  the cloud session.
- **The second session kept every agent's context small.** Its implementers averaged 54k (peak
  93k) and its reviewers 44k, against a worst implementer average of 148k in the first session
  (unverified: that figure comes only from the hand-off prompt that started `01CL1oeA`; no one
  ran session-metrics on the first session's transcript, which is gone, and 148k is also M45's
  worst builder, so it may have been copied from there).
  The first built the parts and the second ran fix rounds, so their totals (13.64M and 7.05M units)
  do not compare like for like; context per agent does. What held it down: review findings pasted
  inline in each brief, every implementer in its own isolated worktree, and re-reviews of a
  follow-up push that read only the delta (36–45k each). No PR was subscribed to, so there were 0
  GitHub wakes.

### What could be better

- **Renumbering part 4's migration broke every preview build.** Part 4's `0056_tier_weekly` had
  been applied to the shared `preview` Neon branch; regenerated as `0057` after part 3 took
  `0056`, its `CREATE TABLE` re-ran and failed, and `drizzle-kit migrate`'s spinner hid the
  Postgres error. Repaired by hand on the preview branch with Mitchell's approval (redeploy
  `dpl_EdknDNvmQD5p7zfDw3anh9ooBqLe` READY). The plan's *Migrations* rule ("the one that merges
  second regenerates") protects production's journal order but not a preview branch that already
  applied the old file. Filed as
  [KI-2026-10-17-c](../known-issues/open/KI-20261017-c-renumbering-a-migration-the-preview-branch-applied-breaks-every-preview-build.md),
  with the recovery and three fix directions.
- **The tracker's planned merge order was wrong about who would regenerate.** It expected part 3
  to regenerate as `0057`; part 3 merged first and part 4 regenerated. Nothing broke beyond the
  preview incident above, but the merge order should be decided when a second migration-bearing
  part opens, not assumed.
- **No part had a preview browser walk.** The build ran unattended; each PR body says *"Preview
  URL walked: none"*. The plan's per-part preview walks were not done, so the console's toggle and
  the tier charts have been seen only in component tests until Mitchell's walk.
- **The orchestrator's share missed its target badly: 31.6% in the second session** (target under
  15%; M45 19.8%), with a peak context of 260k. Its long review loops (part 2 to round 5, part 4
  through two review series) ran through one orchestrator context: 90 orchestrator calls averaged
  183k, so every subagent report it read re-read about 180k, and it ran past the 250k hand-off line.
  The change: batch the dispatches of one wake into one turn, and hand off at about 200k.
- **PR 476 took four fix rounds**, about 8 agents in all, and each round's minor findings were in
  the code the round before had added. Proposed rule, for Mitchell to accept: from round 3 on, a
  minor finding is answered in the PR body unless it is a real defect.
- **PR 475's unit red was called a flake and was not one.** It was deterministic:
  `chart.test.tsx:218` needed `TierGrowthCharts` in the `CHARTS` token registry. It passed for
  KI-2026-10-14-c because the web unit lane's `dot` reporter suppressed the annotations; once
  PR 474 restored them, the next run named the real failure. An unnamed red is not a flake until
  it has been named.
- **`implementer-brief-check` refused three dispatches over the brief's format**: a
  `Findings (…):` heading (twice) and a *Files* line with no repo path. Briefs also pointed
  `part-reviewer` at review files it cannot write.
- **Decisions were taken unattended.** ADR-076 §8 (the origin gate, no cross-mode writes, live
  drops alerting, production's test pair from a dedicated Stripe sandbox) was decided in part 2's
  review rounds 1 to 4 without Mitchell, as the safer fix, and is marked reversible by him.

### Leftovers

- ~~**The [walk] box**~~: walked by Mitchell, 2026-10-18.
- **Three extra Stripe variables in Vercel**, noticed at the close: `STRIPE_TEST_SECRET_KEY_STRIPE_SECRET_KEY`,
  `…_STRIPE_PUBLISHABLE_KEY` and `…_STRIPE_MCP_KEY`, in Preview and Production, added 2026-10-18
  at 03:42 UTC. Nothing in `apps/web/src` reads them; they look like a Stripe integration
  installed with `STRIPE_TEST_SECRET_KEY` as its prefix. Mitchell's to keep or remove.
- **ADR-076 §8's unattended decisions**: Mitchell's call to keep or reverse.
- **The proposed review-round rule** (minors answered in the PR body from round 3 on, above):
  Mitchell's call.
- **Two CodeQL "log injection" comments on PR 476** (`github-advanced-security`, review comments
  4302144874 and 4302173488 on `apps/web/src/server/billing/webhook.ts`, the second at line 362).
  Not a required check; left open for Mitchell to dismiss or fix. The check's own red on every
  part is KI-2026-10-17-b.
- **The preview-migration incident**: KI-2026-10-17-c.
- **Done at the close (2026-10-18):** the two absorbed candidates deleted by `pnpm milestone
  close`; the follow-up to drop `users.stripe_customer_id` (ADR-076 §2) and the gross
  *+N added / −N lost* tier charts (a per-account snapshot table; part 4 draws net change,
  Mitchell, 2026-10-17) filed as candidates in `docs/candidates.md`; the plan deleted (it is in
  git history).

## Spend
<!-- session-metrics:milestone v1 -->

Three sessions. Each line is that session's block as carried in its hand-off text, pasted
unchanged; the third is the close, measured in its own container.

- `session_01CL1oeAdnH4F2CurrqHaSQG`: 29 agents, 604 API calls, 7.05M units (phase-implementer 2.56M / 12 agents, orchestrator 2.23M, part-reviewer 1.14M / 11, general-purpose 1.12M / 5). Orchestrator peak context 260k, avg 183k; orchestrator share 31.6% (missed <15%). GitHub wakes 0.
- `session_015NsvHHKe5Z72VtnATvKbcV`: 21 agents, 911 calls, 13.64M units
- `session_01TJZ3eBijzp26EWvwgD5wYs` (the close): 3 agents, 106 API calls, 2.64M units (orchestrator 2.28M, peak context 317k, avg 186k; Explore 364k / 2). $7.89. It was mostly a roadmap clean-up (PR 478) before the close, so it overstates M47's own close.

### Spend against the last milestone

M46 has no spend block (its close is pending), so the comparison is with M45. Recorded costs, read
2026-10-17 with `get_session` (`external_metadata.usage.cost_usd`): `01CL1oeA` $29.22,
`015NsvHH` $48.71 (that session also ran M46's close, so it overstates M47). Lines added, by the
guideline's rule (`9c0fed5^1..b026115`, without `docs/`, `*.generated.json` and
`pnpm-lock.yaml`): 13,650, of which about 10,350 are Drizzle snapshots; 3,304 without
`apps/web/drizzle/meta/`.

- **Dollars per 1,000 lines added (under 20):** $5.7 by the rule, but $23.6 without the three
  migration snapshots, which inflate the denominator. Read as missed (M45: $24). With the close
  session's $7.89: $6.3 by the rule, $26.0 without the snapshots.
- **Orchestrator's share (under 15%):** missed, 31.6% in `01CL1oeA` and 17.8% in
  `015NsvHH` (M45: 19.8%). Cause above, under *What could be better*.
- **A builder's average context (none over 250k):** met, on `01CL1oeA`'s measured 54k average
  (peak 93k). `015NsvHH`'s worst implementer average is unverified: the 148k given for it comes
  only from the hand-off prompt that started `01CL1oeA` ("worst implementer avg 148k (met)"), no
  one ran session-metrics on that transcript, which is gone, and it matches M45's worst builder
  (148k), so it may have been copied from there. The orchestrator's own peak was 260k.
- **GitHub wakes per merged part (under 5):** met, 0 in `01CL1oeA` (M45: 0 of 7).
- **Cache re-writes after a coordinator message (2 or fewer):** not in the carried blocks.
