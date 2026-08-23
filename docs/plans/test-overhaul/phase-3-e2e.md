# Phase 3 — E2E: make it fast, make it trustworthy

**Closes KI-19, KI-21, KI-25.**

**Start here:** the e2e layer is the *good* layer. 11 specs, 15 tests, 1,240
lines, already role-first (182 `getByRole` against 4 raw CSS locators), already
waiting on real responses rather than sleeping. Nothing here is a rewrite. The
problems are four mechanical ones: every test signs in through the real UI form,
every test builds its state by clicking, the whole suite runs at one viewport,
and one drag helper is responsible for the repo's longest-running flake.

Because Phase 5 deletes unit tests on the strength of this layer, **this layer
has to be trustworthy first.** That is why 3 precedes 5.

---

## Task 3.1 — Sign in once, not 24 times

`signInAsDevUser` is called 24 times across 15 tests. Each call is: navigate
home → click Sign in → fill a username → submit → wait for the authenticated
`/api/trips` fetch → assert the heading. That is a full page load, a hydration
wait and a round-trip, repeated 24 times for zero assertion value.

Use Playwright's [setup-project + `storageState`
pattern](https://playwright.dev/docs/auth): authenticate once, save cookies to
a JSON file, and have every spec start already signed in.

```ts
// apps/web/e2e/auth.setup.ts
setup("authenticate as alice", async ({ page }) => {
  await signInAsDevUser(page, "alice");
  await page.context().storageState({ path: ".auth/alice.json" });
});
```

```ts
// playwright.config.ts
projects: [
  { name: "setup", testMatch: /auth\.setup\.ts/ },
  {
    name: "desktop",
    use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 },
           storageState: ".auth/alice.json" },
    dependencies: ["setup"],
  },
],
```

Add `.auth/` to `.gitignore`. **Keep `signInAsDevUser` in `helpers.ts`** — the
setup project calls it, and one spec should still exercise sign-in as a real
flow. That spec is `smoke.spec.ts`; give it `storageState: { cookies: [], origins: [] }`
so it starts genuinely signed out, and let it be the only place the login UI
is covered.

**Watch for a shared-state regression.** Several specs comment that "parallel
workers share the alice dev user's trip list" and defensively suffix trip names
with `Date.now()`. Sharing one storageState makes that sharing universal rather
than incidental. Two acceptable answers, pick one and write it down:

- keep the unique-name convention and make it a helper (`uniqueTripName("Rome")`), or
- give each worker its own dev user (`alice-${workerIndex}`) via a per-worker
  setup — the [per-worker auth
  variant](https://playwright.dev/docs/auth#authenticate-with-api-request), which
  removes the shared list entirely.

The second is cleaner and `AUTH_DEV_LOGIN` mints a user for any string, so it
costs almost nothing here. Prefer it.

## Task 3.2 — Build state through the API, assert through the UI

Several specs spend 20–40 lines clicking a trip into existence before the thing
they actually test. `m8-make-it-real.spec.ts` is the legitimate exception — the
create/name/date/build/rename/delete sequence **is** its subject, and it must
keep clicking.

Everywhere else, build the starting state with Phase 2's `commandsFor` through
`page.request` (which shares the browser context's cookies), then drive only
the interaction under test through the UI.

Rule to write into the guidelines: **click what you are testing; POST
everything else.** A spec about the map rail should not be testing trip
creation as a side effect — if trip creation breaks, `m8` says so, and it says
so in one place instead of eleven.

## Task 3.3 — Fix `dragCardTo` properly (KI-21)

The cause is known at trace level and must not be re-derived: `dragCardTo`'s
post-move polling loop runs its full 5s budget without `inViewport(targetBox)`
ever becoming true, because day 2's column sits ~8px below the 720px fold and
`autoScrollWindowForElements` does not finish bringing it into view inside the
allotted window. Reproduced deterministically on this branch and on the
pre-merge branch, and on three consecutive real CI runs.

Fix in this order, stopping when the drag is deterministic:

1. **The taller default viewport from Phase 1** (`height: 900`) removes the
   specific trigger. Re-run `m1-board` 5× and see whether it is now
   deterministic. Necessary but probably not sufficient — it fixes this
   column's 8px, not the class.
2. **Scroll the target into view before starting the drag**, not during it.
   `await target.scrollIntoViewIfNeeded()` before `mouse.down()` means the
   helper never depends on drag-triggered auto-scroll completing inside a
   timing budget. This is the real fix: it removes the race rather than
   widening the window.
3. **Replace the polling loop with a web-first assertion** on an observable
   consequence. The loop exists because the helper cannot tell when the drop
   registered; the app can — assert the moved card is inside the target column
   (`expect(day2.getByText(title)).toBeVisible()`) and let Playwright's
   auto-waiting handle the retry. [Replacing hard waits with web-first
   assertions is the single largest reduction in Playwright
   flakiness](https://testquality.com/playwright-flaky-tests-diagnostic-playbook-2026/).

**Keep the mouse-sequence approach, and keep its header comment.** The comment
explains why `locator.dragTo()` is not used — pragmatic-drag-and-drop rides the
native HTML5 API, and [a mouse-only or wrong-technique drag gives you a green
test that never moved anything](https://scrolltest.com/playwright-drag-and-drop-testing/).
That reasoning is correct and hard-won; only the viewport handling changes.

**Delete the three `waitForTimeout` calls** in `helpers.ts` and the eight in
`m10-map-rail.spec.ts` as part of this task. Each is either replaceable by a
web-first assertion or is masking a missing one.

**Acceptance:** `m1-board` and `m4-money-and-lenses` pass **10 consecutive
runs** under `test:e2e:ci-like`, including one run with deliberate CPU load
(the KI-13/KI-21 reproduction condition). Anything less and KI-21 stays open —
this specific flake has been "probably fixed" before.

## Task 3.4 — A narrow-viewport project (KI-19)

The gate cannot see responsive defects because the whole suite runs at one
width. KI-19's own fix line says a narrow project must be a **gate condition,
not a nice-to-have**.

```ts
{
  name: "narrow",
  use: { ...devices["Desktop Chrome"], viewport: { width: 1100, height: 800 },
         storageState: ".auth/alice.json" },
  dependencies: ["setup"],
  testMatch: /responsive\.spec\.ts/,
},
```

Do **not** run all 15 specs at both widths — that doubles the slowest job to
catch a narrow class of bug. Write **one** `e2e/responsive.spec.ts` at 1100px
(below the 1179px breakpoint) covering exactly the breakpoint-dependent
behavior the app actually has:

1. The assistant rail is in overlay mode and its scrim **dismisses** it
   (the KI-16 regression guard — this is the test that would have caught a
   whole page being inert).
2. The trip page is interactive: a view tab click changes the lens.
3. A sheet opens above the rail and its Close button is reachable (KI-17).
4. The Playbooks strip reflows (its 1180px behavior).
5. The hero collapses (its 1040px behavior) — at 1000px, so add a second
   narrow project or a per-test `page.setViewportSize`.

Five assertions in one spec closes a blind spot that eleven specs at one width
could not see. That ratio is the whole argument of this plan.

## Task 3.5 — Make the simulated-AI guarantee unconditional (KI-25)

`playwright.config.ts` sets `AI_LIVE: "false"` in `webServer.env`, but
`reuseExistingServer: !process.env.CI` means that block is skipped when a
developer runs against an already-running dev server — so a local pass is not
proof no real model was called. `m10-simulated-ai.spec.ts` asserting
`body.simulated === true` makes it fail loudly rather than silently, which is a
real mitigation but not a fix.

Make the guarantee independent of how the server started: add a global setup
that **queries the running server** for its effective AI mode and fails the run
if it is live.

```ts
// e2e/global.setup.ts — runs before everything, including the auth setup
const res = await request.get(`${BASE_URL}/api/health/ai-mode`);
if ((await res.json()).live) {
  throw new Error("Refusing to run e2e against a live AI model. Set AI_LIVE=false.");
}
```

This needs a tiny read-only endpoint reporting the resolved mode from
`modelSelection.ts`. That endpoint is independently useful — it is also the
missing observability for **KI-24** (`AI_LIVE` on Vercel is warned about, not
prevented), since it makes the effective mode queryable rather than
inferable from a log line. Note that in the KI-24 entry; do not change
`AI_LIVE`'s override semantics here, which is an open product decision.

---

## Exit checklist

- [ ] One sign-in per run (plus `smoke.spec.ts`'s deliberate signed-out flow);
      `signInAsDevUser` call sites down from 24 to 2.
- [ ] Per-worker dev users, or a documented unique-name convention. Written
      down either way.
- [ ] Zero `waitForTimeout` anywhere in `e2e/`.
- [ ] `m1-board` + `m4-money-and-lenses` green 10 consecutive runs, one under
      load. **KI-21 closed.**
- [ ] `e2e/responsive.spec.ts` runs at 1100px in its own project and is part of
      the default run. **KI-19 closed.**
- [ ] An e2e run against a live-AI server fails at global setup with a clear
      message. **KI-25 closed.**
- [ ] Full `test:e2e:ci-like` green twice in a row, and measurably faster than
      the Phase 0 baseline.
- [ ] The three closed KIs moved to Resolved in `docs/known-issues.md`, each
      recording what the cause turned out to be.
