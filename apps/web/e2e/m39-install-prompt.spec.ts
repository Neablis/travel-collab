import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures/test";
import { createMappedTrip } from "./helpers";
import { e2eTripName } from "./tripNames";

// **The in-app install entry points.** M39 shipped them as an *Install app*
// row in the account menu and one nudge under a returning phone's trip header
// (Mitchell's option B, 2026-10-09). On the 2026-10-10 preview he moved them:
// "Find a better place for install app … Maybe along the top on desktop next
// to 'Playbooks' and make it more clear its a app?" So now:
//
//   - desktop: *Get the app* in the top nav, beside Playbooks; no menu row;
//   - phone: the account menu's *Install app* row, plus a one-time card on
//     the trips list for a returning device; nothing on the trip page.
//
// The rules are held exhaustively by `InstallNudge.test.tsx`,
// `GetTheAppButton.test.tsx` and `installPrompt.test.ts`; this is the half only
// a browser can say — that the event reaches the app from a real page load,
// that each control shows at the width it is meant for, and that the installed
// app is left alone.
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

async function openHome(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Your trips" })).toBeVisible();
}

const card = (page: Page) => page.getByRole("region", { name: "Install Caesura" });
const getTheApp = (page: Page) => page.getByRole("button", { name: "Get the app" });

async function menuOffersInstall(page: Page): Promise<boolean> {
  await page.getByRole("button", { name: "Account menu" }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  const offered = await page.getByRole("button", { name: "Install app" }).isVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Sign out" })).toHaveCount(0);
  return offered;
}

test.describe("Install — desktop: Get the app, in the top nav", () => {
  test("sits beside Playbooks once the browser says it can install, and asks the browser", async ({ page }) => {
    await installable(page);
    await openHome(page);
    await expect(getTheApp(page)).toBeVisible();
    // Beside Playbooks: the same row, directly after it.
    const playbooks = (await page.getByRole("link", { name: "Playbooks", exact: true }).boundingBox())!;
    const button = (await getTheApp(page).boundingBox())!;
    expect(Math.abs(button.y + button.height / 2 - (playbooks.y + playbooks.height / 2))).toBeLessThanOrEqual(2);
    expect(button.x).toBeGreaterThan(playbooks.x);
    await getTheApp(page).click();
    await expect.poll(() => prompts(page)).toBe(1);
  });

  test("is not offered by a browser that cannot install", async ({ page }) => {
    await openHome(page);
    await expect(getTheApp(page)).toHaveCount(0);
  });

  test("the account menu no longer carries the row, and the trip page carries nothing", async ({ page }) => {
    await installable(page);
    await visitedBefore(page, true);
    const tripId = await createMappedTrip(page, e2eTripName("install-desktop"), 2);
    await page.goto(`/trips/${tripId}`);
    await expect(page.getByRole("button", { name: /Trip settings/ })).toBeVisible();
    expect(await menuOffersInstall(page)).toBe(false);
    await expect(getTheApp(page)).toBeVisible();
    await expect(card(page)).toHaveCount(0);
  });
});

test.describe("Install — phone: the menu row and the trips list card", () => {
  test.use({ viewport: PHONE });

  test("a returning phone gets the card on the trips list, and Install asks the browser", async ({ page }) => {
    await installable(page);
    await visitedBefore(page, true);
    await openHome(page);
    await expect(card(page)).toBeVisible();
    await expect(card(page)).toContainText("Keep Caesura on your home screen");
    // The desktop's button is not drawn here.
    await expect(getTheApp(page)).toBeHidden();
    for (const name of ["Install", "Not now"]) {
      const box = (await card(page).getByRole("button", { name, exact: true }).boundingBox())!;
      expect(box.height, name).toBeGreaterThanOrEqual(44);
    }
    await card(page).getByRole("button", { name: "Install", exact: true }).click();
    await expect.poll(() => prompts(page)).toBe(1);
    await expect(card(page)).toHaveCount(0);
  });

  test("never appears on a first visit; the menu row is there", async ({ page }) => {
    await installable(page);
    await visitedBefore(page, false);
    await openHome(page);
    // Installable all along — the menu says so — so the visit is the reason.
    expect(await menuOffersInstall(page)).toBe(true);
    await expect(card(page)).toHaveCount(0);
  });

  test("Not now is remembered across a reload; the menu row stays", async ({ page }) => {
    await installable(page);
    await visitedBefore(page, true);
    await openHome(page);
    await card(page).getByRole("button", { name: "Not now" }).click();
    await expect(card(page)).toHaveCount(0);

    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "Your trips" })).toBeVisible();
    expect(await menuOffersInstall(page)).toBe(true);
    await expect(card(page)).toHaveCount(0);
  });

  test("nothing on a trip page any more", async ({ page }) => {
    await installable(page);
    await visitedBefore(page, true);
    const tripId = await createMappedTrip(page, e2eTripName("install-trip"), 2);
    await page.goto(`/trips/${tripId}?view=Plan`);
    await expect(page.getByRole("button", { name: /Trip settings/ })).toBeVisible();
    await expect(card(page)).toHaveCount(0);
  });

  test("offers nothing inside the installed app", async ({ page }) => {
    await standalone(page);
    await installable(page);
    await visitedBefore(page, true);
    await openHome(page);
    expect(await page.evaluate(() => matchMedia("(display-mode: standalone)").matches)).toBe(true);
    expect(await menuOffersInstall(page)).toBe(false);
    await expect(card(page)).toHaveCount(0);
  });
});

test.describe("Install — Safari on an iPhone", () => {
  test.use({ viewport: PHONE, userAgent: IPHONE_UA });

  test("the card's Install shows Safari's two steps", async ({ page }) => {
    await visitedBefore(page, true);
    await openHome(page);
    await card(page).getByRole("button", { name: "Install", exact: true }).click();
    const steps = page.getByRole("dialog", { name: "Add Caesura to your Home Screen" });
    await expect(steps).toContainText("Tap Share in Safari's toolbar.");
    await expect(steps).toContainText("Choose Add to Home Screen.");
  });
});
