### KI-2026-11-21 — React logs "Encountered a script tag while rendering React component" in development on every client navigation into `(app)`
- **Severity:** dev noise only. Production builds strip the warning, and the script correctly does not run on a client navigation.
- **Area:** `apps/web/src/app/(app)/layout.tsx` (the `EARLY_LOCK_SCRIPT` `<script>`), `apps/web/src/lib/pwaLock.ts`.
- **Symptom / What happens:**
  - `(front)/signin/verify` ends with `router.replace(callbackUrl)` (`VerifyScreen.goOn`), and `/home` is under `(app)`, so the `(app)` layout renders on the client. Any `Link` from `(front)` into `(app)` does the same.
  - React then creates the inline `<script>` and calls `console.error("Encountered a script tag while rendering React component…")` (react-dom 19 dev build). The dev overlay shows an issue after every two-step sign-in.
- **Why not fixed here:** the script needs the request's session (no cookie, no gate to show the page again), which only the `(app)` layout reads. Moving it to the root layout's `<head>`, which never re-renders on the client, needs a guard there that acts only on `(app)` routes with a session; that is more than the M62 review-3 fix should carry. The script's own fail-safe (`EARLY_LOCK_FAILSAFE_MS`) bounds the cost of a wrong guard, which makes the move safer to try.
- **Cross-reference:** M62 part 5 (PR 778), final review finding 7; ADR-092 Decision 8.
- **First noted:** 2026-11-21, M62 final review.
