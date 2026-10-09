import { chromium, type Locator, type Page } from "@playwright/test";
import { newPageDoc } from "@tc/contracts";
import { expect, test } from "./fixtures/test";
import { serveMapTiles } from "./fixtures/mapTiles";
import { createMappedTrip, homeTrip, openAssistantRail } from "./helpers";
import { e2eTripName, escapeForRegExp } from "./tripNames";

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

  // The phone's tab bar is `position: fixed`, which `body`'s inset padding does
  // not reach (CodeRabbit, PR #366). Landscape on a notched phone puts the
  // notch on a side: the bar still runs edge to edge — a gap there would show
  // the page behind it — and its tabs clear both insets.
  test("the phone tab bar keeps its tabs clear of a side notch", async ({ page }) => {
    await page.setViewportSize({ width: 600, height: 400 });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: { left: 30, right: 20 } });
    await page.goto("/");

    const bar = page.getByRole("navigation", { name: "Phone navigation" });
    const barBox = (await bar.boundingBox())!;
    expect.soft(barBox.x).toBe(0);
    expect.soft(barBox.width).toBe(600);
    const tabs = bar.getByRole("link");
    const first = (await tabs.first().boundingBox())!;
    const last = (await tabs.last().boundingBox())!;
    expect.soft(first.x).toBeGreaterThanOrEqual(30);
    expect.soft(last.x + last.width).toBeLessThanOrEqual(600 - 20);
  });
});

// **M39 Part 7 — the pinned and fixed layers clear the safe area**
// (KI-2026-10-09-a). Part 4's `viewport-fit=cover` let the page draw under a
// status bar, a notch and a home indicator, and only AppHeader, the body's
// gutters and the phone tab bar moved out of their way.
//
// Each walk runs twice, and the assertions are written as "the number the
// layer had before, plus the inset". With no insets that is the old geometry
// exactly — `cover` must not move anything on a device with no safe area — and
// with insets it is the fix.
type Insets = { top: number; right: number; bottom: number; left: number };
const NONE: Insets = { top: 0, right: 0, bottom: 0, left: 0 };
// A phone held upright: a status bar above, a home indicator below.
const PORTRAIT: Insets = { top: 47, right: 0, bottom: 34, left: 0 };
// Every edge at once, for the layers that only exist from 768px up: a phone in
// landscape has a notch at a side, an iPad a status bar and a home indicator.
const ALL_FOUR: Insets = { top: 47, right: 44, bottom: 34, left: 44 };

async function emulateInsets(page: Page, insets: Insets): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets });
}

type Px = "top" | "maxHeight" | "paddingTop" | "paddingRight" | "paddingBottom" | "paddingLeft";
async function px(locator: Locator, property: Px): Promise<number> {
  return locator.evaluate((el, p) => parseFloat(getComputedStyle(el)[p]), property);
}

test.describe("M39 Part 7 — the pinned and fixed layers clear the safe area", () => {
  for (const [label, wide] of [["no insets", NONE], ["insets", ALL_FOUR]] as const) {
    test(`a notebook's pinned bars, Ask's bubble and its card (${label})`, async ({ page }) => {
      await emulateInsets(page, wide);
      const trip = await page.request.post("/api/trips", { data: { name: e2eTripName("Insets") } }).then((r) => r.json());
      const tripId = trip.tripId as string;
      const created = await page.request
        .post(`/api/trips/${tripId}/pages`, {
          data: { title: "Under the notch", context: { tripId }, content: newPageDoc([]) },
        })
        .then((r) => r.json());
      await page.goto(`/trips/${tripId}/pages/${created.page.id as string}`);
      await page.getByRole("button", { name: "Edit page" }).click();

      // The toolbar pins under AppHeader's whole height, the widget rail under
      // the toolbar's 60px, and the rail's list is bounded by both.
      const toolbar = page
        .getByRole("button", { name: "Done editing" })
        .locator("xpath=ancestor::div[contains(@class,'md:sticky')][1]");
      expect.soft(await px(toolbar, "top"), "toolbar top").toBe(56 + wide.top);
      const rail = page.locator("aside[data-widget-panel]");
      expect.soft(await px(rail, "top"), "widget rail top").toBe(116 + wide.top);
      expect.soft(await px(rail.locator(".tc-widget-rail"), "maxHeight"), "widget list").toBe(900 - 120 - wide.top);

      // §9's 16px pad, measured from the safe area's corner.
      const launcher = page.getByTestId("assistant-launcher");
      const bubble = (await launcher.boundingBox())!;
      expect.soft(bubble.x + bubble.width, "bubble right").toBe(1280 - 16 - wide.right);
      expect.soft(bubble.y + bubble.height, "bubble bottom").toBe(900 - 16 - wide.bottom);
      await launcher.click();
      const card = (await page.getByRole("complementary", { name: "Assistant" }).boundingBox())!;
      expect.soft(card.x + card.width, "card right").toBe(1280 - 16 - wide.right);
      expect.soft(card.y + card.height, "card bottom").toBe(900 - 16 - wide.bottom);
    });

    test(`the Unscheduled rack, and the side sheet (${label})`, async ({ page }) => {
      await emulateInsets(page, wide);
      const tripId = await createMappedTrip(page, e2eTripName("InsetsRack"), 1);
      await page.goto(`/trips/${tripId}?view=Plan`);

      // Edge to edge, so nothing shows beneath it, with its row clear of a
      // notch at either side and of the home indicator.
      const rack = page.getByTestId("unscheduled-rack");
      const rackBox = (await rack.boundingBox())!;
      expect.soft(rackBox.x, "rack left").toBe(0);
      expect.soft(rackBox.y + rackBox.height, "rack bottom").toBe(900);
      const row = (await rack.getByRole("button").first().boundingBox())!;
      expect.soft(row.x, "rack row left").toBe(wide.left);
      expect.soft(row.x + row.width, "rack row right").toBe(1280 - wide.right);
      expect.soft(row.y + row.height, "rack row bottom").toBe(900 - wide.bottom);

      // The rail sheet touches the top, the right and the bottom; not the left.
      await page.goto("/");
      await page.getByRole("button", { name: "New trip" }).click();
      const sheet = page.getByRole("dialog", { name: "New trip" });
      await expect(sheet).toBeVisible();
      expect.soft(await px(sheet, "paddingTop"), "rail sheet top").toBe(20 + wide.top);
      expect.soft(await px(sheet, "paddingRight"), "rail sheet right").toBe(20 + wide.right);
      expect.soft(await px(sheet, "paddingBottom"), "rail sheet bottom").toBe(20 + wide.bottom);
      expect.soft(await px(sheet, "paddingLeft"), "rail sheet left").toBe(20);
    });

    test(`a toast with nothing else at the bottom (${label})`, async ({ page }) => {
      await emulateInsets(page, wide);
      const tripName = e2eTripName("InsetsToast");
      expect((await page.request.post("/api/trips", { data: { name: tripName } })).ok()).toBe(true);
      await page.goto("/");
      // An empty trip draws its unplanned state at its final height, so its
      // actions menu's anchor does not move under the click (KI-28).
      await expect(homeTrip(page, tripName)).toBeVisible();
      await page.getByRole("button", { name: new RegExp(`trip actions for ${escapeForRegExp(tripName)}`, "i") }).click();
      await page.getByRole("menuitem", { name: /delete/i }).click();
      const toast = (await page.getByTestId("toast").boundingBox())!;
      expect.soft(toast.y + toast.height, "toast bottom").toBe(900 - 16 - wide.bottom);
    });
  }

  for (const [label, tall] of [["no insets", NONE], ["insets", PORTRAIT]] as const) {
    test.describe(`on a phone (${label})`, () => {
      test.beforeEach(async ({ page }) => {
        await page.setViewportSize({ width: 411, height: 852 });
        await emulateInsets(page, tall);
      });

      test("the front door's header and headline sit below the status bar", async ({ page }) => {
        await page.goto("/welcome");
        const header = page.getByTestId("phone-front-door").locator("header").first();
        expect.soft(await px(header, "paddingTop"), "header").toBe(24 + tall.top);
        const headline = page.getByTestId("front-door-pin").locator(".relative.px-6").first();
        expect.soft(await px(headline, "paddingTop"), "headline").toBe(64 + tall.top);
      });

      test("Ask's sheet keeps its composer above the home indicator", async ({ page }) => {
        const tripId = await createMappedTrip(page, e2eTripName("InsetsAsk"), 1);
        await page.goto(`/trips/${tripId}`);
        await openAssistantRail(page);
        const sheet = page.getByRole("complementary", { name: "Assistant" });
        const box = (await sheet.boundingBox())!;
        expect.soft(box.y + box.height, "sheet bottom").toBe(852);
        expect.soft(await px(sheet, "paddingBottom"), "sheet inset").toBe(tall.bottom);

        // `.assistant-rail`'s full-screen phone form has no caller that reaches
        // it after hydration any more — every phone surface asks for the sheet
        // — so its rule is read off a probe rather than a real panel.
        const fullScreen = await page.evaluate(() => {
          const el = document.createElement("aside");
          el.className = "assistant-rail";
          document.body.append(el);
          const s = getComputedStyle(el);
          const padding = [s.paddingTop, s.paddingRight, s.paddingBottom, s.paddingLeft].map(parseFloat);
          el.remove();
          return padding;
        });
        expect.soft(fullScreen, "full-screen Ask").toEqual([tall.top, tall.right, tall.bottom, tall.left]);
      });

      test("a bottom sheet and a full-screen sheet clear the edges they touch", async ({ page }) => {
        await page.goto("/playbooks");
        await page.getByTestId("discover-phone-filters").click();
        const filters = page.getByRole("dialog", { name: "Filters" });
        await expect(filters).toBeVisible();
        expect.soft(await px(filters, "paddingTop"), "bottom sheet top").toBe(20);
        expect.soft(await px(filters, "paddingBottom"), "bottom sheet bottom").toBe(20 + tall.bottom);
        await page.keyboard.press("Escape");

        await page.goto("/");
        await page.getByRole("button", { name: "New trip" }).click();
        const full = page.getByRole("dialog", { name: "New trip" });
        await expect(full).toBeVisible();
        expect.soft(await px(full, "paddingTop"), "full sheet top").toBe(20 + tall.top);
        expect.soft(await px(full, "paddingBottom"), "full sheet bottom").toBe(20 + tall.bottom);
      });
    });
  }
});

async function controlled(page: Page): Promise<boolean> {
  return page.evaluate(() => navigator.serviceWorker.controller !== null);
}
