import { expect, test } from "@playwright/test";
import { e2eTripName } from "./tripNames";

// This is the one spec that still covers the login UI end to end — every
// other spec runs pre-authenticated via the "desktop"/"narrow" projects'
// shared storageState (Task 3.1). Override it here so this test starts
// genuinely signed out.
test.use({ storageState: { cookies: [], origins: [] } });

test("sign in, create a trip, see it in the list", async ({ page }) => {
  const tripName = e2eTripName("Rome");

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
  await page.getByRole("button", { name: "Create empty" }).click();

  await expect(page.getByRole("heading", { name: tripName, level: 3 })).toBeVisible();
});
