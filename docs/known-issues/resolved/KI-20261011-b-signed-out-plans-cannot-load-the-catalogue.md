### KI-2026-10-11-b — `/plans` opened signed out says "Your plan could not be loaded just now" — RESOLVED

- **Severity:** minor. Nothing is wrong for a signed-in user; a signed-out visitor cannot compare
  plans.
- **Area:** `apps/web/src/components/plans/PlansScreen.tsx` (`load()`), `/api/account/plan`, and the
  proxy matcher (`apps/web/src/proxy.ts`), which does not cover `/plans`.
- **Symptom:** a signed-out visitor reaches `/plans` (the proxy does not redirect it), `load()` gets a
  401 from `/api/account/plan`, and the page shows "Your plan could not be loaded just now." M42
  part 7 (PR 405) works around it: the landing's "Compare plans" link goes to
  `/signin?callbackUrl=%2Fplans`.
- **Fix direction:** either let `/plans` render the public catalogue (from the generated landing
  snapshot or a public catalogue read) when there is no session, with "Sign up" in place of
  "Choose", or have the proxy send a signed-out `/plans` through sign-in. The first is better for a
  visitor comparing plans before signing up.
- **First noted:** 2026-10-11, M42 (found building PR 405; confirmed by its review).
- **Resolved, 2026-10-24 (KI sweep):** the second fix direction. `/plans` joins the proxy matcher,
  so a signed-out visitor is sent to `/signin?callbackUrl=%2Fplans` (a `?checkout=` rides the
  callback) and never reaches the 401 that drew the banner; signed in, the page is served as
  before. Reproduced first in `proxy.test.ts`: Next's own compiled matcher
  (`getMiddlewareMatchers`) did not match `/plans`, `AssertionError: expected false to be true`;
  green after the fix, with a signed-in `/plans` pinned as untouched. The landing's direct
  sign-in link (PR 405) stays, as a saved hop; its comment and `m15-front-door.spec.ts`'s now say
  so. The first direction, a public catalogue a visitor can compare before signing up, is a
  feature in its own right and was not built here. Not run locally: the e2e specs that open
  `/plans` (`m21-plans`, `m15-front-door`), left to CI.
