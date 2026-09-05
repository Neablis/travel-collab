# F-A03 — Sentry wizard leftovers ship to production: an unauthenticated route that throws on every hit

- **Stream:** A Security · **Severity:** LOW · **Confidence:** CONFIRMED (verified)
- **Area:** `apps/web/src/app/api/sentry-example-api/route.ts:12-16` (no `auth()`, emits a Sentry log and throws `SentryExampleAPIError` on every GET); `apps/web/src/app/sentry-example-page/` (the matching page, which also contains one of the three raw `fetch` calls F-E03 lists).
- **What is wrong:** anyone can drive error volume into the Sentry project in a loop; there is no rate limit. It is the only route in the tree with no product purpose and no authz check.
- **Suggested fix:** delete both the route and the page.
- **Scope of the fix:** two deletions. Check subset: `pnpm --filter web typecheck lint`.
- **Do not:** gate it behind `isDevLoginEnabled()` — there is nothing to keep.
