import { fileURLToPath } from "node:url";
import type { BrowserContext, Page, Request } from "@playwright/test";
import { STYLE_URL } from "../../src/components/lenses/mapBootstrap";
import { BASE_URL } from "../../src/config";

// **No automated test talks to a real third party** (Mitchell, 2026-09-24).
// The map is the one place this suite's pages used to: both maps load their
// basemap style from `tiles.openfreemap.org`, and the style names the tile,
// glyph and sprite URLs that follow it. Whether the REAL service renders is
// checked by hand on a Vercel preview — `docs/guidelines/
// third-party-services-on-a-preview.md` — and not here.
//
// **On by default, for every context.** `e2e/fixtures/test.ts` calls
// `serveMapTiles` on every browser context the suite creates — the one behind
// `page`, and any a spec opens itself with `browser.newContext()` for a second
// actor. It used to be a call each map spec had to remember; three forgot, and
// the lane's resolver backstop (playwright.config.ts) turned that into the
// map's offline panel over the chrome those specs clicked.
//
// **Same URL, intercepted; not a localhost style URL.** The CSP's
// `connect-src` names the tile host, and a route fulfilled by Playwright still
// has to satisfy it, so serving the style at its real address keeps the CSP in
// the path this suite exercises. Repointing the app at localhost would test a
// policy production never runs.
//
// **Why a background-only style is enough.** Neither map depends on anything
// the real style carries: `MapLens` and `SharedDayMap` add their own GeoJSON
// sources and `line` layers after `load`, never `before` a named basemap layer,
// and neither adds a `symbol` layer, so there are no glyphs to serve. Pins and
// city discs are DOM markers. A style with no sources fires `load` at once and
// asks for nothing else, which is also why nothing else on the host is served:
// a request for anything but the style means the fixture no longer matches
// what the app needs, and it is aborted and reported rather than quietly
// answered.

/** The basemap host, derived from the URL the app loads so the two cannot drift. */
export const MAP_TILE_HOST = new URL(STYLE_URL).host;

const STYLE_FIXTURE = fileURLToPath(new URL("./map-style.json", import.meta.url));

/**
 * `withSentryConfig`'s `tunnelRoute` (next.config.ts): the browser posts Sentry
 * envelopes to THIS origin, and the Next server forwards them to Sentry's
 * ingest host. So a live client DSN never shows up as a request to
 * `*.sentry.io` from the page — it shows up here, which is why a same-origin
 * path counts as third-party traffic below.
 */
const SENTRY_TUNNEL_PATH = "/monitoring";

/**
 * The app's own host, from the same `BASE_URL` the config's `baseURL` and its
 * `--host-resolver-rules` exclusion read — so a `WEB_BASE_URL` pointing at
 * another host moves all three together.
 */
const APP_HOSTNAME = new URL(BASE_URL).hostname;

function isAppUnderTest(url: URL): boolean {
  return url.hostname === APP_HOSTNAME;
}

/** What the tile route did, per context, for `watchOffHostRequests` to read. */
type TileRouteRecord = {
  /** Requests the route answered with the fixture. */
  fulfilled: WeakSet<Request>;
  /** Requests the route refused because the fixture does not cover them. */
  refused: Map<Request, string>;
};

const tileRoutes = new WeakMap<BrowserContext, TileRouteRecord>();

/**
 * Serve the map's basemap from a committed fixture, for every page in
 * `context`. Called by `e2e/fixtures/test.ts` on every context; a spec does not
 * call it.
 *
 * **Every mark is made before the first `await`.** The callback runs while the
 * request is still in flight, and `requestfinished` cannot fire for it until
 * `route.fulfill` has answered — so by the time `watchOffHostRequests` judges a
 * settled request, the route's verdict on it is already recorded.
 */
export async function serveMapTiles(context: BrowserContext): Promise<void> {
  const record: TileRouteRecord = { fulfilled: new WeakSet(), refused: new Map() };
  tileRoutes.set(context, record);

  await context.route(`https://${MAP_TILE_HOST}/**`, async (route) => {
    const request = route.request();
    if (!new URL(request.url()).pathname.startsWith("/styles/")) {
      record.refused.set(request, `${request.url()} (on the tile host, but not the style — the fixture needs updating)`);
      await route.abort();
      return;
    }
    record.fulfilled.add(request);
    await route.fulfill({
      path: STYLE_FIXTURE,
      contentType: "application/json",
      // The style is fetched cross-origin, so CORS applies to a fulfilled
      // response exactly as it does to a real one.
      headers: { "access-control-allow-origin": "*" },
    });
  });
}

/**
 * Watch `context` for requests that left for a third party.
 *
 * `offHostRequests()` lists every settled http(s) request bound for somewhere
 * other than the app under test that the tile route did NOT answer with the
 * fixture — including Sentry envelopes through the tunnel, though only those
 * sent before the assertion: the SDK batches for a few seconds, so this is not
 * the proof that Sentry is off in e2e (the build is — `pnpm check:build-sentry`
 * and `NEXT_PUBLIC_SENTRY_DSN` in playwright.config.ts). A spec asserts it is
 * empty, after the map has loaded.
 *
 * **Settled requests only, and that is what makes it race-free.** A request is
 * judged on `requestfinished` or `requestfailed`, never on `request`: at
 * `request` time the route may not have run yet, and an assertion made while
 * the style was in flight used to list it as third-party traffic. A request
 * still in flight at the assertion is not listed; off-host requests fail fast
 * here (the resolver backstop answers NOTFOUND), so that window is short.
 */
export function watchOffHostRequests(context: BrowserContext): { offHostRequests: () => string[] } {
  const offHost: string[] = [];

  const judge = (request: Request) => {
    const url = new URL(request.url());
    if (url.protocol !== "http:" && url.protocol !== "https:") return;
    if (isAppUnderTest(url) && !url.pathname.startsWith(SENTRY_TUNNEL_PATH)) return;
    const route = tileRoutes.get(context);
    if (route?.fulfilled.has(request)) return;
    offHost.push(route?.refused.get(request) ?? request.url());
  };
  context.on("requestfinished", judge);
  context.on("requestfailed", judge);

  return { offHostRequests: () => [...offHost] };
}

/**
 * Make the basemap host unreachable, as it is on a train. Returns how many
 * requests were refused, so a spec can prove its offline state was caused by
 * the block and not by something else going wrong first.
 *
 * **This wins over the default route, whatever the order.** Playwright
 * consults a PAGE's routes before its context's, and `serveMapTiles` is a
 * context route — so a page route registered here refuses the style before the
 * fixture is ever asked. The offline spec in `m10-map-rail.spec.ts` is the
 * proof: if the fixture answered instead, the map would load and its panel
 * would never appear.
 */
export async function blockMapTiles(page: Page): Promise<{ refused: () => number }> {
  let refused = 0;
  await page.route(`https://${MAP_TILE_HOST}/**`, async (route) => {
    refused += 1;
    await route.abort("internetdisconnected");
  });
  return { refused: () => refused };
}
