### KI-2026-10-28-a — `responsive.spec.ts:358`, the hero's KI-56 guard, fails on a first attempt, passes on retry

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
