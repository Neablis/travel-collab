import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures/test";
import { createMappedTrip } from "./helpers";
import { e2eTripName } from "./tripNames";

// **M39 — the in-app install entry points** (Mitchell chose option B,
// 2026-10-09): an *Install app* row in the account menu wherever installing
// would work, and one nudge on a returning phone's trip. The rules are held
// exhaustively by `InstallNudge.test.tsx` and `installPrompt.test.ts`; this is
// the half only a browser can say — that the event reaches the app from a real
// page load, that the row sits where the pinned stack says it does, and that
// the installed app is left alone.
//
// No browser here will fire `beforeinstallprompt` on its own (a Playwright
// context is incognito, which Chrome refuses to install from — see
// m39-installable), so `installable()` fires the event Chromium would, at
// `DOMContentLoaded` — before any of the app's code has run. Only the root
// layout's inline head script hears it that early (`EARLY_INSTALL_LISTENER`);
// without it every positive case here fails, which is how it was found.

const PHONE = { width: 411, height: 852 };
const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

/**
 * What the installed app answers. Chromium's CDP `display-mode` media feature
 * is accepted and ignored by this browser (probed 2026-10-09: `browser` still
 * matched), so the query itself is answered here, before any script asks.
 */
async function standalone(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const real = window.matchMedia.bind(window);
    window.matchMedia = (query: string) => (query.includes("display-mode: standalone") ? real("all") : real(query));
  });
}

/** Fires a stub `beforeinstallprompt` on every load; `prompts(page)` counts its `prompt()` calls. */
async function installable(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.addEventListener("DOMContentLoaded", () => {
      const event = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
        prompt: async () => {
          document.documentElement.dataset.installPrompts = String(Number(document.documentElement.dataset.installPrompts ?? 0) + 1);
        },
        userChoice: Promise.resolve({ outcome: "dismissed", platform: "web" }),
      });
      window.dispatchEvent(event);
    });
  });
}

const prompts = (page: Page) => page.evaluate(() => Number(document.documentElement.dataset.installPrompts ?? 0));

/**
 * This device's record of the days the app was opened, set before every load:
 * one earlier day makes today's load a return; none makes it a first visit.
 * The app adds today's itself.
 */
async function visitedBefore(page: Page, returning: boolean): Promise<void> {
  await page.addInitScript((days) => window.localStorage.setItem("caesura_visit_days", days), JSON.stringify(returning ? ["2000-1-1"] : []));
}

async function openTrip(page: Page, label: string, query = ""): Promise<void> {
  const tripId = await createMappedTrip(page, e2eTripName(label), 2);
  await page.goto(`/trips/${tripId}${query}`);
  await expect(page.getByRole("button", { name: /Trip settings/ })).toBeVisible();
}

const nudge = (page: Page) => page.getByRole("region", { name: "Install Caesura" });

async function menuOffersInstall(page: Page): Promise<boolean> {
  await page.getByRole("button", { name: "Account menu" }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  const offered = await page.getByRole("button", { name: "Install app" }).isVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Sign out" })).toHaveCount(0);
  return offered;
}

test.describe("M39 — Install app, in the account menu", () => {
  test("is offered once the browser says it can install, and asks the browser", async ({ page }) => {
    await installable(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("button", { name: "Install app" }).click();
    await expect.poll(() => prompts(page)).toBe(1);
  });

  test("is not offered by a browser that cannot install", async ({ page }) => {
    await page.goto("/");
    expect(await menuOffersInstall(page)).toBe(false);
  });

  test("a returning desktop gets the row and never the nudge", async ({ page }) => {
    await page.clock.install();
    await installable(page);
    await visitedBefore(page, true);
    await openTrip(page, "install-desktop");
    await page.clock.fastForward(10_000);
    expect(await menuOffersInstall(page)).toBe(true);
    await expect(nudge(page)).toHaveCount(0);
  });
});

test.describe("M39 — the install nudge on a phone", () => {
  test.use({ viewport: PHONE });

  test("appears under the pinned header on a return visit, after the delay", async ({ page }) => {
    await page.clock.install();
    await installable(page);
    await visitedBefore(page, true);
    await openTrip(page, "install-nudge");
    await expect(nudge(page)).toHaveCount(0);
    await page.clock.fastForward(4_000);
    await expect(nudge(page)).toBeVisible();
    await expect(nudge(page)).toContainText("Keep Caesura on your home screen");

    // Directly under the sticky header, and not counted in the pinned stack:
    // the board's scroll offsets still clear exactly the header.
    const geometry = await page.evaluate(() => {
      const header = document.querySelector('header[aria-label="Trip"]')!.getBoundingClientRect();
      const row = document.querySelector('section[aria-label="Install Caesura"]')!.getBoundingClientRect();
      const stack = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--sticky-stack-height"));
      return { gap: Math.round(row.top - header.bottom), stackMinusHeader: Math.round(stack - header.bottom) };
    });
    expect(geometry).toEqual({ gap: 0, stackMinusHeader: 0 });
    for (const name of ["Install", "Not now"]) {
      const box = (await nudge(page).getByRole("button", { name, exact: true }).boundingBox())!;
      expect(box.height, name).toBeGreaterThanOrEqual(44);
    }

    await nudge(page).getByRole("button", { name: "Install", exact: true }).click();
    await expect.poll(() => prompts(page)).toBe(1);
    await expect(nudge(page)).toHaveCount(0);
  });

  test("never appears on a first visit", async ({ page }) => {
    await page.clock.install();
    await installable(page);
    await visitedBefore(page, false);
    await openTrip(page, "install-first");
    await page.clock.fastForward(10_000);
    // Installable all along — the menu says so — so the visit is the reason.
    expect(await menuOffersInstall(page)).toBe(true);
    await expect(nudge(page)).toHaveCount(0);
  });

  test("Not now is remembered across a reload; the menu row stays", async ({ page }) => {
    await page.clock.install();
    await installable(page);
    await visitedBefore(page, true);
    await openTrip(page, "install-not-now");
    await page.clock.fastForward(4_000);
    await nudge(page).getByRole("button", { name: "Not now" }).click();
    await expect(nudge(page)).toHaveCount(0);

    await page.reload();
    await expect(page.getByRole("button", { name: /Trip settings/ })).toBeVisible();
    await page.clock.fastForward(10_000);
    expect(await menuOffersInstall(page)).toBe(true);
    await expect(nudge(page)).toHaveCount(0);
  });

  test("waits for Overview or Plan: not on the Map", async ({ page }) => {
    await page.clock.install();
    await installable(page);
    await visitedBefore(page, true);
    await openTrip(page, "install-map", "?view=Map");
    await page.clock.fastForward(10_000);
    await expect(nudge(page)).toHaveCount(0);
    await page.getByRole("navigation", { name: "Phone navigation" }).getByRole("link", { name: "Plan" }).click();
    await expect(nudge(page)).toBeVisible();
  });

  test("offers nothing inside the installed app", async ({ page }) => {
    await standalone(page);
    await page.clock.install();
    await installable(page);
    await visitedBefore(page, true);
    await openTrip(page, "install-standalone");
    expect(await page.evaluate(() => matchMedia("(display-mode: standalone)").matches)).toBe(true);
    await page.clock.fastForward(10_000);
    expect(await menuOffersInstall(page)).toBe(false);
    await expect(nudge(page)).toHaveCount(0);
  });
});

test.describe("M39 — Safari on an iPhone", () => {
  test.use({ viewport: PHONE, userAgent: IPHONE_UA });

  test("the nudge's Install shows Safari's two steps", async ({ page }) => {
    await page.clock.install();
    await visitedBefore(page, true);
    await openTrip(page, "install-ios");
    await page.clock.fastForward(4_000);
    await nudge(page).getByRole("button", { name: "Install", exact: true }).click();
    const steps = page.getByRole("dialog", { name: "Add Caesura to your Home Screen" });
    await expect(steps).toContainText("Tap Share in Safari's toolbar.");
    await expect(steps).toContainText("Choose Add to Home Screen.");
  });
});
