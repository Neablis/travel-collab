import { fileURLToPath } from "node:url";
import type { Page, Request } from "@playwright/test";
import { STYLE_URL } from "../../src/components/lenses/mapBootstrap";

// **No automated test talks to a real third party** (Mitchell, 2026-09-24).
// The map is the one place this suite's pages used to: both maps load their
// basemap style from `tiles.openfreemap.org`, and the style names the tile,
// glyph and sprite URLs that follow it. Whether the REAL service renders is
// checked by hand on a Vercel preview — `docs/guidelines/
// third-party-services-on-a-preview.md` — and not here.
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

function isAppUnderTest(url: URL): boolean {
  return url.hostname === "localhost" || url.hostname === "127.0.0.1";
}

/**
 * Serve the map's basemap from a committed fixture, and watch for anything
 * else leaving for a third party.
 *
 * Call it before the navigation that loads a map. `offHostRequests()` lists
 * every http(s) request the page made that was bound for somewhere other than
 * the app under test and was NOT answered by the fixture — including Sentry
 * envelopes through the tunnel, though only those sent before the assertion:
 * the SDK batches for a few seconds, so this is not the proof that Sentry is
 * off in e2e (the build is — see `NEXT_PUBLIC_SENTRY_DSN` in
 * playwright.config.ts). A spec asserts it is empty.
 */
export async function serveMapTilesLocally(page: Page): Promise<{ offHostRequests: () => string[] }> {
  const seen: Request[] = [];
  const fulfilled = new Set<Request>();
  const unexpected: string[] = [];

  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.protocol !== "http:" && url.protocol !== "https:") return;
    if (isAppUnderTest(url) && !url.pathname.startsWith(SENTRY_TUNNEL_PATH)) return;
    seen.push(request);
  });

  await page.route(`https://${MAP_TILE_HOST}/**`, async (route) => {
    const request = route.request();
    if (!new URL(request.url()).pathname.startsWith("/styles/")) {
      unexpected.push(`${request.url()} (on the tile host, but not the style — the fixture needs updating)`);
      await route.abort();
      return;
    }
    fulfilled.add(request);
    await route.fulfill({
      path: STYLE_FIXTURE,
      contentType: "application/json",
      // The style is fetched cross-origin, so CORS applies to a fulfilled
      // response exactly as it does to a real one.
      headers: { "access-control-allow-origin": "*" },
    });
  });

  return {
    offHostRequests: () => [...unexpected, ...seen.filter((r) => !fulfilled.has(r)).map((r) => r.url())],
  };
}

/**
 * Make the basemap host unreachable, as it is on a train. Returns how many
 * requests were refused, so a spec can prove its offline state was caused by
 * the block and not by something else going wrong first.
 */
export async function blockMapTiles(page: Page): Promise<{ refused: () => number }> {
  let refused = 0;
  await page.route(`https://${MAP_TILE_HOST}/**`, async (route) => {
    refused += 1;
    await route.abort("internetdisconnected");
  });
  return { refused: () => refused };
}
