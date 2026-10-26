import { test as base, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { serveMapTiles, watchOffHostRequests } from "./mapTiles";

export { expect } from "@playwright/test";

/** The splash every sign-in lands behind (M54 part 5). */
export const welcomeSplash = (page: Page) => page.getByTestId("welcome-moment");

// The splash's 3s cap and its unlock, with room for a slow runner. Without a
// bound, a splash that never leaves fails as the test's own timeout at
// whichever action comes next, which reads as a flake.
const SPLASH_GONE_WITHIN_MS = 5_000;

/**
 * Every page waits out the welcome splash before it acts or asserts. Any
 * sign-in through the form lands behind it for a second or so, and it takes
 * the pointer, so a spec that signs in and clicks at once would otherwise race
 * it. Playwright runs a locator handler whenever the splash is up before an
 * action or an auto-waiting assertion; on any other load it is never shown.
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
  { network: { offHostRequests: () => string[] } },
  { serveMapTilesOnEveryContext: void }
>({
  serveMapTilesOnEveryContext: [
    async ({ browser }, provide) => {
      const newContext = browser.newContext.bind(browser);
      const withMapTiles: Browser["newContext"] = async (options) => {
        const context = await newContext(options);
        await serveMapTiles(context);
        waitOutTheWelcomeSplash(context);
        return context;
      };
      browser.newContext = withMapTiles;
      await provide();
      browser.newContext = newContext;
    },
    { scope: "worker", auto: true },
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
