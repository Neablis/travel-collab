### KI-2026-10-24-b — `m42-demo-trips` (a screenshot) and `m37-trip-covers` fail locally on `main` under ci-like — RESOLVED

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
- **Resolved:** 2026-10-25, KI sweep 2. **m42, reproduced and environmental.** On a clean `main`
  under `test:e2e:ci-like`, all seven `toHaveScreenshot` tests failed, on the run and the retry,
  with identical counts (49,377 pixels at 1440, 137,473 at 3440, 42,177, 11,440, 3,477): a fixed
  difference, not a timeout. The diff images show the same layout with every glyph's edges
  different. The Chromium revision is CI's (1248 for Playwright 1.64.1, Ubuntu 24.04 like
  `ubuntu-latest`); the difference is fontconfig. The cloud image adds
  `/etc/fonts/conf.d/12-unhinted-grayscale.conf` (dated 2026-10-22), which *assigns* `hintnone`,
  `rgba none`, `lcdnone` over Ubuntu's stock `10-hinting-slight`, `10-sub-pixel-rgb` and
  `11-lcdfilter-default`, and Chromium on Linux takes its text rendering from fontconfig even for
  web fonts. With a fontconfig minus that one file, the same build passed all 21 m42 tests against
  CI's baselines; reassigning hinting alone did not (6 failed), so the sub-pixel settings matter
  too. Fix: `e2e/fonts/ci-hinting.conf` includes the host's `/etc/fonts/fonts.conf` and reassigns
  the stock values, and `m42-demo-trips.spec.ts` (the only spec that compares pixels) launches its
  browser with `FONTCONFIG_FILE` pointing at it, keeping `playwright.config.ts`'s launch args. On
  CI it restates what is already set. No baseline was regenerated. **m37, not reproduced:**
  `e2e/m37-trip-covers.spec.ts` passed 2 of 2 on unmodified code in two separate ci-like runs; its
  failing assertion was never recorded, so there is nothing to act on. Proof:
  `pnpm --filter web test:e2e:ci-like e2e/m42-demo-trips.spec.ts e2e/m37-trip-covers.spec.ts
  e2e/m46-trip-chat.spec.ts e2e/m14-notebook-widgets.spec.ts e2e/responsive.spec.ts`, 104 passed,
  none flaky (the m42 shots all green against the committed baselines). Not checked: CI on the PR,
  which is the run that shows the override is a no-op there.
