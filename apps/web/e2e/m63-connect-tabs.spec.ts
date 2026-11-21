import { expect, test } from "./fixtures/test";

test.use({ storageState: { cookies: [], origins: [] } });

// `/ai`, `/llms.txt` and `/agents.md` link `/developers#connect-chatgpt` and the
// like, and the section they name sits in a tab panel that is hidden until its
// tab is open.
test.describe("with JavaScript", () => {
  test("a link to a hidden client's section opens its tab and scrolls to it", async ({ page }) => {
    await page.goto("/developers#connect-chatgpt");
    await expect(page.getByRole("tab", { name: "ChatGPT" })).toHaveAttribute("aria-selected", "true");
    const section = page.getByRole("region", { name: "Connect ChatGPT" });
    await expect(section).toBeVisible();
    await expect(section).toBeInViewport();
  });

  test("a click on a link to the hash already in the URL opens its tab again", async ({ page }) => {
    await page.goto("/developers#connect-chatgpt");
    await page.getByRole("tab", { name: "Gemini" }).click();
    await expect(page.getByRole("region", { name: "Connect ChatGPT" })).toBeHidden();
    await page.evaluate(() => {
      const a = document.createElement("a");
      a.href = "#connect-chatgpt";
      a.textContent = "to ChatGPT";
      document.body.prepend(a);
    });
    await page.getByRole("link", { name: "to ChatGPT" }).click();
    await expect(page.getByRole("region", { name: "Connect ChatGPT" })).toBeInViewport();
  });
});

// A reader with no JavaScript has inert tab buttons: every client's steps must
// be readable anyway, though the server renders two panels `hidden`.
test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("every client's steps are visible", async ({ page }) => {
    await page.goto("/developers");
    for (const name of ["Connect Claude", "Connect ChatGPT", "Connect Gemini"]) {
      await expect(page.getByRole("region", { name })).toBeVisible();
    }
    await expect(page.getByText("Import the OpenAPI document as an Action")).toBeVisible();
    await expect(page.getByText("Declare functions from the OpenAPI document")).toBeVisible();
  });
});
