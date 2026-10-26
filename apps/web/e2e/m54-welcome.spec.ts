import { randomUUID } from "node:crypto";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures/test";

// M54 part 5, from Mitchell's walk: a sign-in's welcome is a splash that holds
// the page back, then hands it over, at every width. The page underneath must
// not show around or through it, the splash must not stay, and once it has gone
// the page answers.
//
// Signed out, so the sign-in below is the one that sets the welcome cue; with
// motion on, so the splash plays as most people see it.
test.use({ storageState: { cookies: [], origins: [] }, reducedMotion: "no-preference" });

// The longest a splash may stay once it says the name: the welcome's hold and
// its unlock, with room for a slow runner. A splash that never leaves fails here.
const LEAVES_WITHIN_MS = 2_500;

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

for (const [width, viewport] of [
  ["desktop", { width: 1280, height: 900 }],
  ["phone", { width: 411, height: 852 }],
] as const) {
  test.describe(`at ${width} width`, () => {
    test.use({ viewport });

    // A fresh account for the signup; alice has had a row since auth.setup.ts.
    for (const [kind, path, account] of [
      ["signup", "/signup", () => `welcome${randomUUID().replace(/-/g, "").slice(0, 10)}`],
      ["sign-in", "/signin", () => "alice"],
    ] as const) {
      test(`a ${kind} is welcomed by name on a splash, then the page is handed over`, async ({ page }) => {
        const username = account();
        await signInThroughTheForm(page, path, username);

        const moment = page.getByTestId("welcome-moment");
        await expect(moment.getByText(`Welcome, ${username}`)).toBeVisible();
        expect(await covering(moment)).toEqual({ spansViewport: true, opaque: true });

        await expect(moment).toBeHidden({ timeout: LEAVES_WITHIN_MS });
        await page.getByRole("button", { name: "New trip" }).click();
        await expect(page.getByLabel("Where are you going?")).toBeFocused();
      });
    }
  });
}
