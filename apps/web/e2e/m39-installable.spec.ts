import { chromium, type Page } from "@playwright/test";
import { expect, test } from "./fixtures/test";
import { serveMapTiles } from "./fixtures/mapTiles";
import { createMappedTrip } from "./helpers";
import { e2eTripName } from "./tripNames";

// **M39 Part 4 — Caesura installs like an app** (D4, D10). Two exit-gate boxes
// are proven here: Chrome's own installability check passes, and the service
// worker answers static assets while every API call still reaches the server.
// The route matcher's exhaustive half is `src/lib/serviceWorker.test.ts`; this
// is the half only a browser can say — that the worker installs, and what it
// actually serves.
test.describe("M39 Part 4 — installable", () => {
  test("Chrome finds nothing stopping an install, and the worker leaves the API alone", async ({ baseURL }, testInfo) => {
    // Its own browser, for two reasons Chrome itself gives. The default
    // headless shell answers `getInstallabilityErrors` with [] for a page with
    // no manifest at all, so it can never fail; the full build in new headless
    // mode reports real errors. And a Playwright context is incognito, which
    // Chrome reports as `in-incognito` — a persistent profile is not.
    const context = await chromium.launchPersistentContext(testInfo.outputPath("profile"), {
      channel: "chromium",
      baseURL,
    });
    try {
      await serveMapTiles(context);
      const page = context.pages()[0] ?? (await context.newPage());
      await page.goto("/");
      // Registered after hydration, production builds only; `ready` resolves
      // once a worker is active for this page's scope.
      await page.evaluate(async () => {
        await navigator.serviceWorker.ready;
      });

      const cdp = await context.newCDPSession(page);
      const { installabilityErrors } = await cdp.send("Page.getInstallabilityErrors");
      expect(installabilityErrors).toEqual([]);

      // The icons the manifest names exist at the sizes it claims: Chrome only
      // needs one of them, so its check above does not prove the rest.
      const manifest = (await (await context.request.get("/manifest.webmanifest")).json()) as {
        icons: { src: string; sizes: string; purpose?: string }[];
      };
      expect(manifest.icons.map((i) => `${i.sizes} ${i.purpose ?? "any"}`).sort()).toEqual([
        "192x192 any",
        "512x512 any",
        "512x512 maskable",
      ]);
      for (const icon of manifest.icons) {
        const png = await (await context.request.get(icon.src)).body();
        // A PNG's IHDR chunk: width and height, big-endian, at bytes 16 and 20.
        expect(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`, icon.src).toBe(icon.sizes);
      }

      // An update check reads the worker script past any cache.
      const sw = await context.request.get("/sw.js");
      expect(sw.headers()["cache-control"]).toMatch(/max-age=0|no-cache/);

      // Controlled now: a reload sends requests through the worker. Static
      // chunks come back from it (the control — it proves `fromServiceWorker`
      // can say yes here; `some`, because Chrome's memory cache may answer a
      // chunk before the worker sees it), an API call does not.
      const answeredByWorker = new Map<string, boolean>();
      page.on("response", (r) => answeredByWorker.set(new URL(r.url()).pathname, r.fromServiceWorker()));
      await page.reload();
      await expect.poll(() => controlled(page)).toBe(true);
      const api = await page.evaluate(async () => (await fetch("/api/auth/session")).status);
      expect(api).toBe(200);
      const statics = [...answeredByWorker].filter(([path]) => path.startsWith("/_next/static/"));
      expect(statics.some(([, fromWorker]) => fromWorker)).toBe(true);
      expect(answeredByWorker.get("/api/auth/session")).toBe(false);
    } finally {
      await context.close();
    }
  });

  test("the headers clear the device's safe area once the page covers it", async ({ page }) => {
    // A notch on the left in landscape, a status bar on top: Chromium reports
    // these through `env(safe-area-inset-*)` exactly as a phone does.
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: { top: 40, left: 30 } });

    const tripId = await createMappedTrip(page, e2eTripName("SafeArea"), 1);
    await page.goto(`/trips/${tripId}`);
    await expect(page.locator('meta[name="viewport"]')).toHaveAttribute("content", /viewport-fit=cover/);

    // AppHeader's row starts below the status bar, and right of the notch.
    // Soft, so a regression names every inset it lost rather than the first.
    const home = (await page.getByRole("link", { name: /Caesura/ }).first().boundingBox())!;
    expect.soft(home.y).toBeGreaterThanOrEqual(40);
    expect.soft(home.x).toBeGreaterThanOrEqual(30);

    // The trip header pins under AppHeader's full height, inset included, and
    // the stack height the board's sticky offsets read says so too.
    const tripHeader = page.locator('header[aria-label="Trip"]');
    await tripHeader.waitFor();
    const top = await tripHeader.evaluate((el) => parseFloat(getComputedStyle(el).top));
    expect.soft(top).toBe(56 + 40);
    const box = (await tripHeader.boundingBox())!;
    const stack = await page.evaluate(() =>
      parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--sticky-stack-height")),
    );
    expect.soft(stack).toBeCloseTo(top + box.height, 0);
  });
});

async function controlled(page: Page): Promise<boolean> {
  return page.evaluate(() => navigator.serviceWorker.controller !== null);
}
