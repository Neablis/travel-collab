import { test as base, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { WELCOME_COOKIE } from "../../src/lib/welcomeCue";
import { serveMapTiles, watchOffHostRequests } from "./mapTiles";

export { expect } from "@playwright/test";

/** The splash every sign-in lands behind (M54 part 5). */
export const welcomeSplash = (page: Page) => page.getByTestId("welcome-moment");

// The splash's 3s cap and its unlock, with room for a slow runner. Without a
// bound, a splash that never leaves fails as the test's own timeout at
// whichever action comes next, which reads as a flake.
const SPLASH_GONE_WITHIN_MS = 5_000;

/**
 * Whether the context being made keeps the sign-in's welcome cue. Set per test
 * from the `keepWelcomeCue` option, which only `m54-welcome.spec.ts` turns on.
 */
let keepWelcomeCueOnNewContexts = false;

/**
 * **A sign-in through the form does not play the welcome splash here**
 * (KI-2026-10-27-c). `recordSignIn` sets the `tc_welcome` cookie, and the
 * page after the sign-in shows the splash for about 1.6s because its head
 * script finds it. Every spec that signs in through the form used to wait
 * that out: at `origin/main` on 2026-10-28, 24 `signInAsDevUser` calls and 27
 * other clicks of *Sign in with dev login*, in 37 files, none about the splash.
 *
 * An init script runs in each document before any of the page's own scripts,
 * so clearing the cookie there means `LAUNCH_SCRIPT` and `LaunchOverlay` both
 * see no cue, which is what a reload after a sign-in sees. Nothing in the app
 * changes and there is no switch in production: the cookie is set exactly as
 * it is for a person, and only the test's browser drops it. `m54-welcome.spec.ts`
 * keeps it (`keepWelcomeCue`), because the splash is its subject.
 */
async function spendTheWelcomeCue(context: BrowserContext) {
  await context.addInitScript((name: string) => {
    // An opaque origin (`about:blank`) throws on `document.cookie`.
    try {
      document.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax`;
    } catch {}
  }, WELCOME_COOKIE);
}

/**
 * Every page waits out the welcome splash before it acts or asserts, as a
 * backstop to `spendTheWelcomeCue`: a context that keeps the cue still lands
 * behind it for a second or so, and it takes the pointer, so a spec that
 * signs in and clicks at once would otherwise race it. Playwright runs a
 * locator handler whenever the splash is up before an action or an
 * auto-waiting assertion; on any other load it is never shown.
 * `m54-welcome.spec.ts`, which is about the splash, removes it.
 */
function waitOutTheWelcomeSplash(context: BrowserContext) {
  const newPage = context.newPage.bind(context);
  context.newPage = async () => {
    const page = await newPage();
    await page.addLocatorHandler(welcomeSplash(page), () =>
      welcomeSplash(page)
        .waitFor({ state: "hidden", timeout: SPLASH_GONE_WITHIN_MS })
        .catch((cause: unknown) => {
          throw new Error(`welcome splash still up ${SPLASH_GONE_WITHIN_MS}ms after it showed`, { cause });
        }),
    );
    return page;
  };
}

/**
 * **The `test` every spec in this suite imports** — `@playwright/test`'s, plus
 * the map basemap served locally on every browser context. `eslint.config.mjs`
 * refuses `test` from `@playwright/test` in a spec, so a new spec cannot miss
 * it the way three did when it was a per-spec call.
 *
 * **Why the worker's `browser` and not the `context` fixture.** A `context`
 * override would cover `page` and nothing else, and a dozen specs open a
 * second actor with `browser.newContext()` — some of whom open a shared
 * Playbook day, which has a map. Playwright's own `context` fixture is itself
 * made by `browser.newContext()`, so wrapping that one method covers both,
 * and the route is registered before the context is handed to anybody: there
 * is no window in which a page could load a map unserved.
 *
 * `blockMapTiles(page)` remains the opt-out: a page route, which Playwright
 * consults before any context route (see its doc in `mapTiles.ts`).
 *
 * Each fixture's second parameter is `provide` rather than Playwright's
 * customary `use`: the React hooks lint rule reads any call to `use` as the
 * React hook and fails it.
 */
export const test = base.extend<
  { network: { offHostRequests: () => string[] }; keepWelcomeCue: boolean; welcomeCueForThisTest: void },
  { serveMapTilesOnEveryContext: void }
>({
  serveMapTilesOnEveryContext: [
    async ({ browser }, provide) => {
      const newContext = browser.newContext.bind(browser);
      const withMapTiles: Browser["newContext"] = async (options) => {
        const context = await newContext(options);
        await serveMapTiles(context);
        if (!keepWelcomeCueOnNewContexts) await spendTheWelcomeCue(context);
        waitOutTheWelcomeSplash(context);
        return context;
      };
      browser.newContext = withMapTiles;
      await provide();
      browser.newContext = newContext;
    },
    { scope: "worker", auto: true },
  ],

  /** `true` keeps the sign-in's welcome cue, so the splash plays: `m54-welcome.spec.ts` only. */
  keepWelcomeCue: [false, { option: true }],

  /**
   * Hands `keepWelcomeCue` to the worker's `newContext` above. Auto, so
   * Playwright sets it up before the test's own fixtures, `context` and `page`
   * among them, and every context the test makes sees this test's value.
   */
  welcomeCueForThisTest: [
    async ({ keepWelcomeCue }, provide) => {
      keepWelcomeCueOnNewContexts = keepWelcomeCue;
      await provide();
      keepWelcomeCueOnNewContexts = false;
    },
    { auto: true },
  ],

  /**
   * Requests from `page`'s context that left for a third party. Watching starts
   * when a test asks for this fixture — i.e. before its first line runs — so
   * every navigation the test makes is covered. See `watchOffHostRequests`.
   */
  network: async ({ context }, provide) => {
    await provide(watchOffHostRequests(context));
  },
});
