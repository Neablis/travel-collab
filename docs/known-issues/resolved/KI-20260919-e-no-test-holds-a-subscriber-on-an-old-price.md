### KI-2026-09-19-e — no test holds an existing subscriber on an old price when a plan is republished at a new one — RESOLVED

- **Severity:** correctness, latent — nothing is known to be wrong, but a money
  invariant that M21's gate names in its first box is held by no automated test,
  and the repository has never contained the scenario that box describes.
- **Area:** `apps/web/src/server/entitlements/planVersions.ts` (the published
  versions), `apps/web/src/server/billing/prices.ts` (`stripePriceFor`,
  `priceLookupKey`), `apps/web/src/server/billing/checkout.ts`,
  `apps/web/src/server/billing/webhook.int.test.ts`,
  `apps/web/src/server/entitlements/resolver.int.test.ts`
- **Symptom / What happens:** M21's first exit-gate box says republishing a plan
  at a new price leaves an existing subscriber's bill and entitlements untouched,
  while the next purchase charges the new price and grants the new terms. The box
  was ticked 2026-09-19 on Mitchell's attestation. But:
  - the only republished version on `main`, `premium@v2`, has the **same** price
    as `premium@v1` ($19), so no published pair of versions differs in price;
  - `prices.test.ts` proves the lookup key changes when the amount changes, and
    that a Price with a different amount is refused — both unit-level, both
    against a mocked Stripe;
  - nothing seeds a subscriber pinned to version N, publishes N+1 at a different
    price, and asserts both that the subscriber's pinned version, Price and
    entitlements are unchanged **and** that a fresh checkout resolves N+1's
    Price.
  So a change that, say, made checkout or the webhook resolve a subscriber's
  Price from `livePlanVersion` instead of the pinned version would pass every
  test today, and would be caught only by the next real price change.
- **Why not fixed here:** found during the docs-only gate close of M21 on
  2026-09-19, which changed no code by instruction.
- **Fix sketch:** an integration test over a fixture version at a different
  price, supplied to the test rather than published in `planVersions.ts`: a
  subscriber pinned to the old version keeps its version ref and entitlements
  across the new version's appearance, and a new checkout resolves the new
  version's lookup key (`priceLookupKey`). Red-first: make checkout read
  `livePlanVersion` for an existing subscriber and watch it fail.
- **Cross-reference:** `docs/milestones/M21-subscriptions-and-billing.md`
  (exit-gate box 1 and the 2026-09-19 retro), `KI-20260916-c` (the price
  consistency sweep has no caller), `KI-20260916-b` (the plan-version
  immutability test the module header cites does not exist), ADR-045, ADR-047.
- **First noted:** 2026-09-19, the audit accompanying M21's gate close.
- **Fix.** Added `apps/web/src/server/entitlements/planVersions.republish.int.test.ts`,
  the integration test the fix sketch describes. The fixture `plus@v2` is $12,
  adds `trip.collaborators` and raises the ceilings. It exists only in the
  test, and `planVersions.ts` is untouched. Because `PLAN_VERSIONS` is frozen,
  the test cannot push the fixture onto it. It wraps the module instead: the
  four list lookups read `PLAN_VERSIONS ++ republished`, and a guard test pins
  that the wrapper agrees with the real module while nothing is republished.
  Stripe is mocked only at `stripeApi.ts`. The webhook, resolver,
  `startCheckout`, `stripePriceFor` and `revenue.ts` all run for real against
  the database. There are two scenarios. (1) A `plus@v1` subscriber, created
  through the real webhook, is still `plus@v1` after `plus@v2` is published
  and a renewal (`customer.subscription.updated` plus `invoice.payment_succeeded`)
  is applied. That holds on `users`, on `subscriptions`, and in
  `entitlementsFor`, including the entitlement set, the ceilings, the
  `monthlyMicroUsd` of 900 and the lookup key `plus_v1_usd_900`. (2) A fresh
  checkout pins `plus@v2`, creates its Price under `plus_v2_usd_1200` at 1200,
  and puts that Price and `plus@v2` on the session. The webhook then grants
  v2's terms. No code defect was found: every path already reads the pinned
  version.
- **Proven.** Reproduction: each of two regressions passed all four existing
  int suites that cover these paths (`webhook`, `lapse`, `revenue`,
  `resolver`), with `Test Files 4 passed (4)`, `Tests 47 passed (47)`.
  (A) is the webhook's `attribute()` returning `livePlanVersion(planId).version`
  instead of the pinned version. (B) is the resolver's `versionOf` returning
  `livePlanVersion(held.planId)`. The new file failed both. Under A it gave
  `expected { planId: 'plus', planVersion: 2 } to deeply equal { planId:
  'plus', planVersion: 1 }`. Under B it gave `expected 'plus@v2' to be
  'plus@v1'`. A third break, (C) `startCheckout` selling
  `versionsOf(planId)[0]`, failed the new-buyer test with `expected 'plus@v1'
  to be 'plus@v2'`. With the source restored the file passed:
  `Tests 3 passed (3)`. Checks (`minimal-check-subset`, `web` only):
  `pnpm --filter web typecheck` was clean, `eslint --max-warnings 0` on the new
  file was clean, and only this file was run with
  `node scripts/with-test-db.mjs vitest run`.
- **Resolved:** 2026-09-24.
