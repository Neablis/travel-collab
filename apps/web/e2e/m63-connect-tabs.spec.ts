import { expect, test } from "./fixtures/test";

test.use({ storageState: { cookies: [], origins: [] } });

// `/ai` links `/developers#connect-gemini` and the like, and the section it
// names sits in a tab panel that is hidden until its tab is open.
test.describe("with JavaScript", () => {
  test("a link to a hidden client's section opens its tab and scrolls to it", async ({ page }) => {
    await page.goto("/developers#connect-gemini");
    await expect(page.getByRole("tab", { name: "Gemini CLI" })).toHaveAttribute("aria-selected", "true");
    const section = page.getByRole("region", { name: "Connect the Gemini CLI" });
    await expect(section).toBeVisible();
    await expect(section).toBeInViewport();
  });

  test("a link to Muse's or the script's section opens its tab", async ({ page }) => {
    await page.goto("/developers#connect-poppy");
    await expect(page.getByRole("tab", { name: "Muse" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("region", { name: "Connect Meta’s Muse" })).toBeInViewport();
    await page.goto("/developers#connect-script");
    await expect(page.getByRole("tab", { name: "Script" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("region", { name: "Connect a script" })).toBeInViewport();
  });

  test("a click on a link to the hash already in the URL opens its tab again", async ({ page }) => {
    await page.goto("/developers#connect-gemini");
    await page.getByRole("tab", { name: "Muse" }).click();
    await expect(page.getByRole("region", { name: "Connect the Gemini CLI" })).toBeHidden();
    await page.evaluate(() => {
      const a = document.createElement("a");
      a.href = "#connect-gemini";
      a.textContent = "to the Gemini CLI";
      document.body.prepend(a);
    });
    await page.getByRole("link", { name: "to the Gemini CLI" }).click();
    await expect(page.getByRole("region", { name: "Connect the Gemini CLI" })).toBeInViewport();
  });
});

// A reader with no JavaScript has inert tab buttons: every client's steps must
// be readable anyway, though the server renders three panels `hidden`.
test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("every client's steps are visible", async ({ page }) => {
    await page.goto("/developers");
    for (const name of ["Connect Claude", "Connect the Gemini CLI", "Connect Meta’s Muse", "Connect a script"]) {
      await expect(page.getByRole("region", { name })).toBeVisible();
    }
    await expect(page.getByText("/mcp auth caesura")).toBeVisible();
  });
});
