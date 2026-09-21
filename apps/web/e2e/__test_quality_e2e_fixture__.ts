import { test } from "@playwright/test";
test("fixture", async ({ page }) => {
  await page.goto("/");
});
