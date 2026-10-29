### KI-2026-10-28-a — `responsive.spec.ts:358`, the hero's KI-56 guard, fails on a first attempt, passes on retry — RESOLVED

- **Severity:** reliability. A flake, not a known product defect: the test passed on retry both
  times it was seen.
- **Area:** `apps/web/e2e/responsive.spec.ts:358` ("a long money figure cannot change the hero's
  height at 360px (KI-56)"), whose `page.locator(".hero-grid")` assumes one match. Two components
  render that class: `apps/web/src/components/home/NextTripHero.tsx` and the hero skeleton in
  `apps/web/src/components/home/HomeSkeletons.tsx`.
- **Symptom / What happens:** the test fails on its first attempt and passes on retry. Seen in
  CI `test / e2e (2/2)` on PR 624 (M55 part 10) at heads bbfff2a and 7313215. That PR changes only the MCP route, so it is
  unrelated. The exact error text and run ids were not captured: a flake that passes on retry
  leaves a green job with no annotations. **Record them here on the next occurrence.**
- **Hypothesis, not verified:** the locator resolves to two `.hero-grid` elements, so a
  strict-mode assertion fails, because the skeleton and the real hero are both mounted for a
  moment while the home page swaps one for the other. A timeout, or a height delta at
  `responsive.spec.ts:386`, fits the evidence as well.
- **Why not fixed here:** found while reviewing PR 624, whose scope is the MCP SDK. Filed so the
  next occurrence is recorded against an entry rather than called flaky from memory.
- **Fix path:** confirm the hypothesis, then scope the locator to the real hero (a role or label
  on `NextTripHero`, per the locator ladder in `docs/guidelines/testing.md` §5) or wait for the
  skeleton to leave. Measure with `pnpm --filter web test:e2e:ci-like e2e/responsive.spec.ts -g
  "hero's height" --repeat-each=20 --retries=0`.
- **Cross-reference:** KI-056 (resolved; it added this guard and is the only entry that matches
  the symptom).
- **First noted:** 2026-10-28, review of PR 624 (M55 part 10).
- **Reproduced (2026-10-28, KI sweep, against a production build as `test:e2e:ci-like` serves
  it):** `e2e/responsive.spec.ts -g "hero's height" --repeat-each=20 --retries=0`, **3 failed of
  20**, at two different places. Twice at :369, `strict mode violation: locator('.hero-grid')
  resolved to 2 elements`, the first being the skeleton (only *Shape of the trip* in it), the
  second the real hero: `home/loading.tsx` streams `NextTripHeroSkeleton`, which carries the same
  class, and both are in the document for a moment while Next swaps one for the other. (Not the
  `HomeScreen` ternary, which never mounts both.) Once at :385, `the hero's cost-line slot was not
  found / Received: null`: on the shared account the hero was another worker's *Narrow hero*
  trip, and a newer one replaced it between the budget-line wait and the measurement, so the
  slot read was the new hero's, still empty (its error context shows the hero loading *Shape of
  the trip* with no budget line).
- **Fix:** the test runs on an account of its own (a fresh dev user, the next test's reasoning:
  one account, one trip, one hero) and measures `getByTestId("next-trip-hero").locator(".hero-grid")`
  only after the hero's heading names this trip. `e2e/responsive.spec.ts` only; no app change.
- **Proof:** the same command after the fix, **20 passed of 20**. Seen red for its own reason:
  with the slot's `min-h-10 … sm:min-h-5` reservation in `NextTripHero.tsx` cut to `min-h-5` and
  rebuilt, the test failed at :399, `Expected: < 1 / Received: 20.1875`; restored, rebuilt, green.
