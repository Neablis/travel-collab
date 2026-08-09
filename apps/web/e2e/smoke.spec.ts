import { expect, test } from "@playwright/test";

test("sign in, create a trip, see it in the list", async ({ page }) => {
  const tripName = `Rome ${Date.now()}`;

  await page.goto("/");
  await page.getByRole("link", { name: "Sign in" }).click();

  // Auth.js built-in sign-in page: Dev Login credentials form.
  await page.fill('input[name="username"]', "alice");

  // Wait for the post-sign-in page's first authenticated /api/trips fetch to
  // resolve — that fetch only fires after React hydrates, so it's a reliable
  // signal the form's onSubmit handler is attached (avoids racing a native
  // form GET submit against hydration).
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes("/api/trips") && r.request().method() === "GET" && r.ok(),
    ),
    page.getByRole("button", { name: /sign in with dev login/i }).click(),
  ]);

  await expect(page.getByRole("heading", { name: "Your trips" })).toBeVisible();
  await page.getByRole("button", { name: "New trip" }).click();
  await page.getByLabel("Trip name").fill(tripName);
  await page.getByRole("button", { name: "Create trip" }).click();

  await expect(page.getByRole("listitem").filter({ hasText: tripName })).toBeVisible();
});
