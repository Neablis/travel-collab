import { expect, type Page } from "@playwright/test";

export async function signInAsDevUser(page: Page, username: string): Promise<void> {
  await page.goto("/");
  await page.getByRole("link", { name: "Sign in" }).click();
  await page.fill('input[name="username"]', username);
  // Wait for the post-sign-in page's first authenticated /api/trips fetch —
  // it only fires after React hydrates, so the form's onSubmit is attached.
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes("/api/trips") && r.request().method() === "GET" && r.ok(),
    ),
    page.getByRole("button", { name: /sign in with dev login/i }).click(),
  ]);
  await expect(page.getByRole("heading", { name: "Your trips" })).toBeVisible();
}
