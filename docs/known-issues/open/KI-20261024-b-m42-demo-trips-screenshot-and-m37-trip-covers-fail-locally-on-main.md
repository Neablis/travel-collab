### KI-2026-10-24-b — `m42-demo-trips` (a screenshot) and `m37-trip-covers` fail locally on `main` under ci-like

- **Severity:** reliability (local lane only). CI is green on the same `main`, so no product
  behaviour is known to be wrong. A session that runs either spec locally to check a change gets a
  red it did not cause.
- **Area:** `apps/web/e2e/m42-demo-trips.spec.ts` and its `*-snapshots/*-desktop-linux.png`;
  `apps/web/e2e/m37-trip-covers.spec.ts`.
- **Symptom / What happens:** on an unmodified `main` during M52 (2026-10-23 to 24),
  `pnpm --filter web test:e2e:ci-like e2e/m42-demo-trips.spec.ts` failed a screenshot comparison,
  and `e2e/m37-trip-covers.spec.ts` failed too. The failing assertions were not recorded.
- **Why not fixed here:** prose-only part 0. Next step: run each spec once on a clean `main`
  under ci-like, record the failing test and its message here, and compare the local Chromium
  revision and fonts with CI's (the screenshot is the likelier environmental one; see the
  resolved KI-2026-09-25-i for the last browser-revision gap). Do not regenerate the snapshot
  locally: CI's is the reference.
- **Cross-reference:** KI-027 (only ci-like or CI counts); KI-2026-10-22-b (the m42 screenshot
  that replaced the overflow sweep); CLAUDE.md rules 1 and 2.
- **First noted:** 2026-10-24, M52's build sessions.
