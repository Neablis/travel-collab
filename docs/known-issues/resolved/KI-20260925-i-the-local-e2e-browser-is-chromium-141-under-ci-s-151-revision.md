### KI-2026-09-25-i — the cloud container's e2e browser is Chromium 141 filed under the revision CI runs as Chromium 151, so a local e2e verdict can be wrong

- **Resolved 2026-10-06.** The skew had grown by then: `@playwright/test@1.63.0` pins Chrome Headless Shell `153.0.8010.12` (revision 1243), and the hook had linked `chromium_headless_shell-1243` at the image's Chromium `141.0.7390.37`. **Fix:** a new `scripts/e2e-browser.mjs` reads the pinned `browserVersion` through apps/web's own `@playwright/test` → `playwright` → `playwright-core` chain, runs the headless shell Playwright will launch with `--version`, and requires an exact match. With `--install` it downloads that exact build from Chrome for Testing (`storage.googleapis.com/chrome-for-testing-public/<version>/linux64/chrome-headless-shell-linux64.zip`, ~120 MB, about 1 s here). It checks the unpacked binary's `--version` before swapping it into the revision directory in place of the link. linux-arm64 has no Chrome for Testing build and gets the warning only. `link_playwright_shell` runs it (`--install --quiet`) after linking, so it says nothing once the build matches, warns when it cannot install, and never fails the session. `scripts/lane-probe.mjs`'s `browser` lane is now BLOCKED, with this KI cited, whenever the version is known and does not match. It stays OK when the version cannot be determined. Only the headless shell is checked: every project in `playwright.config.ts` is headless `Desktop Chrome`. **Proof:** before the fix, `pnpm lanes` → `XX browser e2e would launch 141.0.7390.37, CI launches 153.0.8010.12` (until now this read `OK browser`). After `link_playwright_shell`: `installed Chrome Headless Shell 153.0.8010.12 (revision 1243, was 141.0.7390.37)`, a second run printed nothing, `chromium.launch()` reports `153.0.8010.12`, and `pnpm lanes` → `OK browser`. **On the matched browser, KI-5's own spec shows the lane now catches what it hid:** with `TripProvider.tsx:464`'s `&& result.error.status !== 0` removed (the 2026-09-25 fix), `pnpm --filter web test:e2e:ci-like e2e/m6-unload-flush.spec.ts` → `m6-unload-flush.spec.ts:17` `Expected: 4 / Received: 1` on both attempts, CI's exact failure, which Chromium 141 never produced here. Restored: `test:e2e:ci-like e2e/m6-unload-flush.spec.ts e2e/m6-optimistic.spec.ts e2e/m2-history.spec.ts` → `6 passed`. Six new cases in `scripts/__tests__/lane-probe.test.mjs` (22/22). Each was first seen red: the probe's mismatch gate removed gave `actual: 'OK', expected: 'BLOCKED'`, and a major-only comparison gave `actual: 'match', expected: 'mismatch'`. The eleven existing `probeBrowser` location tests now stub the version check, so they still test only location. `docs/guidelines/cloud-agent-sessions.md` *Browsers* says what to do with a red `browser` lane. The candidate entry for this work in `docs/candidates.md` is removed. **Left as is:** headed `chromium-1243` is still linked at 141. Nothing in the suite launches it, and fetching it would add ~195 MB to every session start.

- **Severity:** reliability of verification — it made "passes locally every
  time" false for a real product bug on the night it was filed.
- **Area:** `.claude/hooks/session-start.sh` (`link_playwright_shell`), `/opt/pw-browsers`
  (the pre-installed browsers), `apps/web/node_modules/playwright-core/browsers.json`
  (`@playwright/test@1.62.1` → Chrome Headless Shell `151.0.7922.34`, revision 1234),
  CLAUDE.md rule 1 and `docs/guidelines/cloud-agent-sessions.md`.
- **Symptom:** in a cloud session, `chromium_headless_shell-1234` and
  `chromium-1234` under `/opt/pw-browsers` are symlinks to `chromium-1194`,
  i.e. **Chromium 141** — ten majors behind what CI installs for the same
  revision. On 2026-09-25 `m6-unload-flush.spec.ts:17` failed in CI three times
  identically (`Expected: 4 / Received: 1`) and passed locally every time,
  including the full `test:e2e:ci-like` run with 2 workers. The cause was a real
  product defect (KI-5's flush re-sending a head the server had applied) that
  only Chromium 151's `pagehide`/fetch-cancellation ordering exposes.
  Downloading CI's exact build from Chrome for Testing
  (`storage.googleapis.com` is reachable; `cdn.playwright.dev` returns 403) into
  a scratch `PLAYWRIGHT_BROWSERS_PATH` reproduced it at once.
- **Why not fixed here:** found by the overnight sweep's CI investigation;
  a change to the session hook / lane probe is its own reviewed step.
  Intended fix: `link_playwright_shell` compares the linked binary's
  `--version` with `browsers.json`'s `browserVersion` and either installs the
  matching build from Chrome for Testing or warns loudly, and `pnpm state`'s
  LANES line reports the mismatch instead of "OK browser".
- **Cross-reference:** KI-5 (the defect this hid), CLAUDE.md rule 1 (a local
  e2e verdict is only as good as its browser), KI-27.
- **First noted:** 2026-09-25, overnight KI sweep.
