### KI-2026-09-25-i — the cloud container's e2e browser is Chromium 141 filed under the revision CI runs as Chromium 151, so a local e2e verdict can be wrong

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
