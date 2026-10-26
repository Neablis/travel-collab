import { randomUUID } from "node:crypto";
import type { Locator, Page } from "@playwright/test";
import { expect, test, welcomeSplash } from "./fixtures/test";

// M54 part 5, from Mitchell's walk: a sign-in's welcome is a splash that holds
// the page back, then hands it over, at every width. The page underneath must
// not show around or through it, nor take a tap meant for the splash, the
// splash must not stay, and once it has gone the page answers.
//
// Signed out, so the sign-in below is the one that sets the welcome cue; with
// motion on, so the splash plays as most people see it.
test.use({ storageState: { cookies: [], origins: [] }, reducedMotion: "no-preference" });

// The longest a splash may stay once it says the name: the welcome's hold and
// its unlock, with room for a slow runner. A splash that never leaves fails here.
const LEAVES_WITHIN_MS = 2_500;

const LOADED = { waitUntil: "domcontentloaded" } as const;

async function signInThroughTheForm(page: Page, path: "/signup" | "/signin", username: string) {
  await page.goto(path);
  const field = page.getByLabel(/username/i);
  await field.fill(username);
  await expect(field).toHaveValue(username);
  await page.getByRole("button", { name: /sign in with dev login/i }).click();
  await expect(page).toHaveURL(/\/home$/);
}

// Read off the node: whether it spans the viewport on an opaque surface. A
// mark alone over the page passes neither.
async function covering(moment: Locator) {
  return moment.evaluate((node) => {
    const box = node.getBoundingClientRect();
    const fill = getComputedStyle(node).backgroundColor;
    return {
      spansViewport: box.width >= window.innerWidth && box.height >= window.innerHeight,
      opaque: fill !== "transparent" && !/(?:rgba\(.*,\s*0\)|\/\s*0\))$/.test(fill),
    };
  });
}

// Read once, not retried: a splash a plain load drew would be gone a second
// later, and a retrying assertion would wait for that.
async function notMarkedNorDrawn(page: Page) {
  return page.evaluate(() => ({
    marked: document.documentElement.hasAttribute("data-launch"),
    drawn: [...document.querySelectorAll("[data-testid=welcome-moment]")].some((node) => node.getClientRects().length > 0),
  }));
}

async function centreOf(target: Locator) {
  const box = await target.boundingBox();
  if (!box) throw new Error("no box: the target is not laid out");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

for (const [width, viewport] of [
  ["desktop", { width: 1280, height: 900 }],
  ["phone", { width: 411, height: 852 }],
] as const) {
  test.describe(`at ${width} width`, () => {
    test.use({ viewport });

    // A fresh account every time, so Home is the empty one whatever trips
    // other specs left alice: its "New trip" focuses the inline composer. The
    // sign-in is that account coming back, signed up and signed out first.
    for (const [kind, arrive] of [
      ["signup", (page: Page, username: string) => signInThroughTheForm(page, "/signup", username)],
      [
        "sign-in",
        async (page: Page, username: string) => {
          await signInThroughTheForm(page, "/signup", username);
          await page.context().clearCookies();
          await signInThroughTheForm(page, "/signin", username);
        },
      ],
    ] as const) {
      test(`a ${kind} is welcomed by name on a splash, then the page is handed over`, async ({ page }) => {
        // This spec is about the splash, so it does not wait it out.
        await page.removeLocatorHandler(welcomeSplash(page));
        const username = `welcome${randomUUID().replace(/-/g, "").slice(0, 10)}`;
        await arrive(page, username);

        const moment = welcomeSplash(page);
        await expect(moment).toBeVisible();
        expect(await covering(moment)).toEqual({ spansViewport: true, opaque: true });

        // A tap on the blank splash lands on the splash, not on the hidden
        // page: here, where "New trip" sits under it. A plain mouse click,
        // since a locator click would wait for the button to be uncovered.
        // Taken first, while the splash is surely up, rather than after a
        // wait for the name that a slow runner could spend the splash on.
        const newTrip = page.getByRole("button", { name: "New trip" });
        const under = await centreOf(newTrip);
        await page.mouse.click(under.x, under.y);

        await expect(moment.getByText(`Welcome, ${username}`)).toBeVisible();
        await expect(moment).toBeHidden({ timeout: LEAVES_WITHIN_MS });
        const composer = page.getByLabel("Where are you going?");
        await expect(composer).not.toBeFocused();
        await newTrip.click();
        await expect(composer).toBeFocused();

        // Every other spec waits the splash out, so one that showed on a plain
        // load would only make them slower. Here it must not show at all: the
        // cue is spent, and a reload or a navigation is not a sign-in. At
        // DOMContentLoaded the head script has run, and a mark it made would
        // still be there.
        for (const load of [() => page.reload(LOADED), () => page.goto("/home", LOADED)]) {
          await load();
          expect(await notMarkedNorDrawn(page)).toEqual({ marked: false, drawn: false });
        }
      });
    }
  });
}
