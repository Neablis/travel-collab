### KI-96 — `sentry.shared.test.ts`'s fixture stubs the variables it names and clears none of the others, so two of its cases read the ambient environment — RESOLVED
- **Severity:** reliability (environment-dependent test outcome; no product impact — the module under test is correct)
- **Area:** `apps/web/sentry.shared.test.ts` (`ratesWith`), reading `apps/web/sentry.shared.ts` (`tracesSampleRate`, `profileSessionSampleRate`)
- **What is wrong:** `ratesWith(env)` calls `vi.resetModules()` and then stubs **only the keys the caller passed**. `vi.stubEnv` sets a value; it does not clear the ones it was not given. So a case that names one variable, or none, imports `sentry.shared.ts` with whatever the surrounding environment already has for the other three — `NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE`, `SENTRY_TRACES_SAMPLE_RATE`, `NEXT_PUBLIC_SENTRY_PROFILE_SESSION_SAMPLE_RATE`, `SENTRY_PROFILE_SESSION_SAMPLE_RATE`.
- **Which cases are exposed, and which are not.** The two precedence cases stub *both* names and are unaffected. The exposed ones are `"%s still honours the server-only name when no public one is set"` (stubs the server name; an ambient **public** name outranks it and the assertion reads the wrong value) and `"%s defaults to 1 when neither is set"` (stubs nothing at all).
- **The symptom is a FALSE FAILURE, not a false pass, and that is worth stating precisely** — it would be easy to file this as "a test that silently verifies nothing", which is what the sibling finding on the same PR actually was. Here the fixture's expectations are specific values (`0.5`, `1`), so an ambient variable makes the test **fail** on that machine rather than pass hollowly. It is a test that does not control its own inputs, so its result depends on the shell it runs in: green in CI and on a clean checkout, red for whoever has one of these exported. Nothing is hidden; time is wasted, and the natural first suspicion would be the module rather than the fixture.
- **Not reachable through `.env.local`:** the unit lane's config (`vitest.unit.config.ts`) does not load it — only `vitest.config.ts`, the integration lane, calls `process.loadEnvFile`. The realistic trigger is an exported shell variable or a CI environment that sets one, which is exactly what `.env.example` now invites someone to do.
- **Fix, four lines (the reviewer's own diff):** clear all four names with `vi.stubEnv(key, undefined)` at the top of `ratesWith`, before applying `Object.entries(env)`. `afterEach`'s `vi.unstubAllEnvs()` already restores them. Worth doing at the same time: the same fixture shape would serve `SENTRY_DSN` and `SENTRY_ENVIRONMENT`, neither of which has a precedence test today.
- **Why not fixed on the branch that introduced it:** the finding arrived from CodeRabbit after PR #93 had already been merged, and Mitchell's call was to file rather than open a follow-up PR for a four-line test change. It should be folded into the next change that touches this file rather than carried alone.
- **Found by:** CodeRabbit, PR #93, reviewing the fix for the browser sample-rate bug that this test was written to pin.
- **Cross-reference:** ADR-032 (the Sentry telemetry setup, and why the `NEXT_PUBLIC_` pairs exist).
- **First noted:** 2026-08-30 (PR #93 review, post-merge).

- **RESOLVED 2026-08-30, by taking the reviewer's diff and extending the fixture as the entry suggested.**

  **Reproduced first, exactly as filed.** With one variable exported in the
  shell — `NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE=0.2 pnpm --filter web exec
  vitest run -c vitest.unit.config.ts sentry.shared.test.ts` — the two named
  cases went red on an otherwise clean checkout:

  ```
   FAIL  |node| sentry.shared.test.ts > the browser-visible sample rates >
     tracesSampleRate still honours the server-only name when no public one is set
  AssertionError: expected 0.2 to be 0.5 // Object.is equality
   FAIL  |node| sentry.shared.test.ts > the browser-visible sample rates >
     tracesSampleRate defaults to 1 when neither is set
  AssertionError: expected 0.2 to be 1 // Object.is equality
  Tests  2 failed | 25 passed (27)
  ```

  The server-only half of the pair leaks the same way:
  `SENTRY_PROFILE_SESSION_SAMPLE_RATE=0.4` alone reddens
  `profileSessionSampleRate defaults to 1 when neither is set`
  (`expected 0.4 to be 1`). A false failure, as the entry said — never a false pass.

  **Fix, in `apps/web/sentry.shared.test.ts` only.** `ratesWith` is now
  `moduleWith` (it no longer serves only the rates) and clears every name
  `sentry.shared.ts` reads before applying the case's own values:
  `for (const key of MODULE_ENV_NAMES) vi.stubEnv(key, undefined);`.
  `MODULE_ENV_NAMES` is the full read set, not just the four rate names —
  the DSN, the three environment names and the two commit-SHA names are in
  it too, so "the fixture controls the module's environment" is true rather
  than nearly true. `afterEach`'s `vi.unstubAllEnvs()` already restored them.

  **Extended as the entry suggested,** inside this one file: `SENTRY_DSN` and
  `SENTRY_ENVIRONMENT` now have the precedence cases neither had — public name
  over the built-in literal, the literal when unset (matched by shape, not
  hard-coded, so a project rename does not edit a test), `""` as the documented
  off switch driving `sentryEnabled` false; and
  `NEXT_PUBLIC_VERCEL_ENV > VERCEL_ENV > NODE_ENV > "development"`.

  **Regression test added** — `describe("the fixture controls the environment it
  does not name")` stubs a name the case does *not* pass to `moduleWith`, which
  is what an exported shell variable looks like from inside the run. Deleting
  the one clearing line makes 3 of the 36 cases fail (`expected 0.2 to be 0.5`,
  `expected 0.4 to be 1`, `expected 'test' to be 'development'` — the last from
  the vitest runner's own `NODE_ENV`), so the fixture defect cannot come back
  silently.

  **Proof.** Same reproduction command, same exported variable, after the fix:
  `Test Files 1 passed (1) / Tests 36 passed (36)`. Per `minimal-check-subset`
  (one changed file, `apps/web/**` → `web`, nothing under
  `packages/contracts/src`): `pnpm --filter web exec vitest run -c
  vitest.unit.config.ts sentry.shared.test.ts` 36/36, `pnpm --filter web
  typecheck` clean, `pnpm --filter web lint` clean. Not run, deliberately:
  `pnpm --filter web test:int` (claims the `postgres` lease, held by another
  unit of the same sweep), e2e, and the full `pnpm check` — no product file
  changed, so nothing outside this test file's own lane is at risk.

  **Noticed and left alone:** `web`'s `lint` script is `eslint src`, which does
  not cover the three test files that live at the app root
  (`sentry.shared.test.ts`, `next.config.test.ts`, and `next.config.ts` itself)
  — `vitest.unit.config.ts` names them explicitly for exactly that reason.
  `eslint sentry.shared.test.ts` run directly is clean, so nothing is wrong
  today; the lint lane simply has a blind spot at the app root.
