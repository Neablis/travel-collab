### KI-2026-10-11-b — `/plans` opened signed out says "Your plan could not be loaded just now"

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
