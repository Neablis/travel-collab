import { expect, test } from "./fixtures/test";

// `/security` is read by a crawler and by a person who has not signed in. No JS
// at all is the honest stand-in: the server HTML is everything the page can say.
test.use({ javaScriptEnabled: false });
test.use({ storageState: { cookies: [], origins: [] } });

test("/security answers HTML with exactly one h1, signed out", async ({ page }) => {
  const response = await page.goto("/security");
  expect(response?.status()).toBe(200);
  expect(response?.headers()["content-type"]).toContain("text/html");

  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 1, name: "Security at Caesura" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Reporting a vulnerability" })).toBeVisible();
});
