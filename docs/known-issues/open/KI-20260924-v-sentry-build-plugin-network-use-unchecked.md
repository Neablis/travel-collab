### KI-2026-09-24-v — nobody has checked whether the Sentry build plugin contacts Sentry during the build that e2e serves

- **Severity:** process, and low. This is build-time traffic, not test traffic.
- **Area:** `withSentryConfig` in `apps/web/next.config.ts`; the `pnpm build` inside `test:e2e:ci-like` and in the CI build step.
- **Symptom / what happens:** the e2e build now sets `NEXT_PUBLIC_SENTRY_DSN=""`, so the served app sends no events: no built chunk carries the ingest DSN (now checked on every e2e build by `pnpm --filter web check:build-sentry`, in `ci.yml` and `test:e2e:ci-like`), and a request-logging probe saw no `/monitoring` tunnel POSTs (2026-09-24). The Sentry webpack/Next plugin itself may still phone home at build time (release creation, source-map upload when `SENTRY_AUTH_TOKEN` is set, or its own telemetry). Nobody measured this.
- **Why not fixed here:** it was outside the e2e change. Checking it needs a build with egress observed, and without `SENTRY_AUTH_TOKEN` the upload path should already be a no-op.
- **What to do:** run one `pnpm build` with the token unset and network logging on. If the plugin makes a request, set its `telemetry: false` / skip-upload options for non-deploy builds.
- **First noted:** 2026-09-24, the no-third-party-in-tests change.
