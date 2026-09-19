### KI-2026-09-19-e — no test holds an existing subscriber on an old price when a plan is republished at a new one

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
