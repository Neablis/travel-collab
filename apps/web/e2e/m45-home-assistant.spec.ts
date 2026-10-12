import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures/test";
import { createMappedTrip } from "./helpers";
import { e2eTripName } from "./tripNames";

// M45 D6 and D7, against the simulated model: Home has an assistant rail of
// its own, always on screen, answering across your trips through the account
// door (`POST /api/ask`), and ⌘K hands it text that matches no command. Its
// unsent draft survives a reload (KI-2026-10-12-g).

const ACCOUNT_ASK = /\/api\/ask$/;

function rail(page: Page) {
  return page.getByRole("complementary", { name: "Assistant" });
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  // A trip with places on it, so "which city" has one to name. Specs share
  // the dev user, so which city comes top is not this spec's to assert.
  await createMappedTrip(page, e2eTripName("Home ask"), 2);
  await page.goto("/");
});

test("Home's rail is there without opening, and asks across your trips", async ({ page }) => {
  await expect(rail(page)).toBeVisible();
  const composer = rail(page).getByPlaceholder("Ask about your trips…");

  const [request] = await Promise.all([
    page.waitForRequest((r) => ACCOUNT_ASK.test(new URL(r.url()).pathname)),
    composer.fill("which city have I been to most").then(() => composer.press("Enter")),
  ]);
  expect((JSON.parse(request.postData() ?? "{}") as { scope: unknown }).scope).toEqual({ kind: "account" });
  await expect(rail(page).getByRole("log", { name: "Conversation" })).toContainText("you've been to most is");
});

test("⌘K offers Ask: for text that matches nothing, and sends it to the rail", async ({ page }) => {
  await expect(rail(page)).toBeVisible();
  await page.keyboard.press("ControlOrMeta+KeyK");
  const palette = page.getByRole("dialog", { name: "Go to or do" });
  await expect(palette).toBeVisible();
  await page.keyboard.type("which country have I been to most");
  await expect(palette.getByRole("option", { name: "Ask: which country have I been to most" })).toBeVisible();

  await Promise.all([page.waitForRequest((r) => ACCOUNT_ASK.test(new URL(r.url()).pathname)), page.keyboard.press("Enter")]);
  await expect(palette).toBeHidden();
  const log = rail(page).getByRole("log", { name: "Conversation" });
  await expect(log).toContainText("which country have I been to most");
  await expect(log).toContainText("you've been to most is");
});

test("a question typed and not sent is still there after a reload", async ({ page }) => {
  const composer = rail(page).getByPlaceholder("Ask about your trips…");
  await composer.fill("where should I go next");
  // Stored a moment after the last keystroke; wait for it rather than a clock.
  // Under the signed-in user's id (`ownedAskName`), which this spec does not know.
  const draft = () =>
    page.evaluate(() => Object.entries(window.localStorage).find(([key]) => key.startsWith("ask_draft_v1:") && key.endsWith(":account"))?.[1] ?? null);
  await expect.poll(draft).toBe("where should I go next");

  await page.reload();
  await expect(rail(page).getByPlaceholder("Ask about your trips…")).toHaveValue("where should I go next");
});
