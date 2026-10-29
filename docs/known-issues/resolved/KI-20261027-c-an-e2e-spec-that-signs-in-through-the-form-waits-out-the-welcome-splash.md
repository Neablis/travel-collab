### KI-2026-10-27-c — An e2e spec that signs in through the form waits out the ~1.6 s welcome splash, and nothing in the suite can switch it off — RESOLVED

- **Severity:** cleanup (suite time, no user impact). About 1.2–1.6 s of real time per form
  sign-in, bounded at 5 s; never a failure unless the splash sticks.
- **Area:** `apps/web/e2e/fixtures/test.ts` (`waitOutTheWelcomeSplash`, :22-35; the 5 s bound
  `SPLASH_GONE_WITHIN_MS`, :12; wired on every context at :68), `apps/web/e2e/helpers.ts`
  (`signInAsDevUser`, :202), `apps/web/src/server/users.ts` (`cookieWelcome`, :392-401, which sets
  `tc_welcome`), `apps/web/src/components/welcome/WelcomeMoment.tsx` (:166-195, which reads and
  spends the cue).
- **What the fixture does (read 2026-10-27 at `e9a46b0f`):** it is a Playwright
  `page.addLocatorHandler` on `welcome-moment`, installed on every page of every context
  (`test.ts:26-32`). It runs only when the splash is visible before an action or an auto-waiting
  assertion, and then waits for it to hide; on a page with no splash it does nothing. So it is
  not a wait on every page.
- **When the splash shows in e2e:** only after a sign-in through the form, because that is the
  only thing that sets the `tc_welcome` cookie (the other trigger, a standalone launch in
  `LAUNCH_SCRIPT`, never matches in Playwright). Specs that start from the shared
  `.auth/alice.json` storage state never see it: `auth.setup.ts` saves that state after
  "Your trips" is visible, and `WelcomeMoment.tsx:174` has spent the cookie at hydration by then.
  Specs that sign in themselves do see it: at `e9a46b0f`, 14 spec files call `signInAsDevUser`
  20 times, specs click *Sign in with dev login* directly 29 more times, and
  `adminBootstrap.ts` signs an operator in through the form.
- **Symptom / What happens:** the first action or auto-waiting assertion after each of those
  sign-ins (for `signInAsDevUser`, its `toBeVisible()` at `helpers.ts:215`) fires the handler,
  which waits out the whole splash.
  There is **no** flag, cookie, storage key or env var that suppresses the splash in tests:
  `playwright.config.ts:88` sets `reducedMotion: "reduce"`, but reduced motion skips only a cue-less
  launch (`WelcomeMoment.tsx:179`, `kind === null`), not a sign-in's welcome, which holds the same
  or shorter by decision 4.
- **Why not fixed here:** the M54 close is prose only. Mitchell, 2026-10-27, about 02:00Z: *"I
  thought the test runner had a way to prevent this? Record as a ki if this isn't true"*. It is
  half true (the handler waits only when the splash is up), and the wait it takes is real.
- **Fix path / Tripwire:** have `signInAsDevUser` (and the other form sign-ins) delete the
  `tc_welcome` cookie from the context right after the sign-in response, before the landing page
  hydrates; or set `tc_welcome` to nothing via `context.addCookies` once the sign-in redirects.
  Keep `m54-welcome.spec.ts` as the one spec that sees it. Do not add a production switch that
  turns the splash off. Measure one shard's time before and after.
- **Cross-reference:** M54's *touched e2e specs* box; decision 4 (amended); ADR-082 §4; part 5
  (PR 607).
- **First noted:** 2026-10-26 at the gate tick on PR 593; answered and filed 2026-10-27 at the
  close.
- **Fix (2026-10-28, KI sweep):** every context made through the worker's `browser.newContext` now drops the cue
  before the page can read it: `e2e/fixtures/test.ts` adds an init script on each context that
  clears `tc_welcome`, which runs before `LAUNCH_SCRIPT` and `LaunchOverlay` in every document. So
  `signInAsDevUser`, `adminBootstrap`'s operator sign-in and the 27 direct *Sign in with dev login*
  clicks all skip the splash with no edit of their own, and a new spec gets it by default. The
  cookie is still set by the server exactly as for a person; there is no production switch.
  `m54-welcome.spec.ts` opts back in with the new `keepWelcomeCue: true` option (read by an auto
  fixture before `context`/`page` are made). The locator handler stays as the backstop.
  Two contexts are outside it, harmlessly: `auth.setup.ts` (base `@playwright/test`, which never
  shows the splash because it waits for *Your trips*) and `m39-installable.spec.ts`'s
  `launchPersistentContext`.
- **What this gives up:** before this fix, the 5 s handler in every signing-in spec would have
  caught a splash that never leaves. Now `m54-welcome.spec.ts` is the only guard, and it signs in
  only to `/home`. A splash that sticks only after a sign-in that lands elsewhere (an invite claim,
  a slow-hydrating trip page) would stay green; if that case matters, give m54 a second landing.
- **Proof:** with `keepWelcomeCue: true` taken out of `m54-welcome.spec.ts`, all 4 of its tests
  failed at `expect(getByTestId('welcome-moment')).toBeVisible()`, `element(s) not found` (the
  cue is dropped); restored, 4 of 4 pass (it is kept).
- **Time saved, measured:** one fresh sign-in through `signInAsDevUser` and the first action after
  it, 10 runs each at one worker against a production build: **2331 ms with the cue kept, 968 ms
  dropped, 1.36 s saved per sign-in**. There are about 50 form sign-ins in the suite, so up to
  about 70 s of worker time a full run (shared by the shards' workers, so less wall-clock). Over
  13 spec files that sign in (38 tests, one worker), the summed test time went 122.9 s to
  110.4 s (-12.4 s; noisy run to run).
