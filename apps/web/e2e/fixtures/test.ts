import { test as base, type Browser } from "@playwright/test";
import { serveMapTiles, watchOffHostRequests } from "./mapTiles";

export { expect } from "@playwright/test";

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
