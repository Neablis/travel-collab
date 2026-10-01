import { expect, test } from "./fixtures/test";

// **The demo trip on a phone: Plan and Map have to be reachable.**
//
// Below 768px the board hides its own Overview/Plan/Calendar/Map strip
// (`TripBoardScreen`, `hidden md:block`) because the phone tab bar carries
// Plan and Map. The bar was mounted only in `(app)/layout.tsx`, and `/demo`
// lives in `(front)` — so a phone visitor landed on Overview with no control
// anywhere on the page that led to either view (Mitchell, 2026-10-01, option
// B: give the demo the bar, pointed at the demo itself).
//
// An e2e and not only a unit test because the failure was a mount point, not a
// derivation: `PhoneTabBar.test.tsx` renders the bar directly and would have
// passed with the bar never appearing on `/demo` at all.
//
// Signed out, for the reason `m11-demo.spec.ts` gives: a demo that works only
// for someone who already has an account is not a demo.
test.describe("the demo trip on a phone", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("reaches Plan and Map from the tab bar, without leaving the demo", async ({ page }) => {
    await page.goto("/demo");
    await expect(page.getByRole("heading", { name: "Japan: Tokyo → Kyoto → Osaka" })).toBeVisible();

    const bar = page.getByRole("navigation", { name: "Phone navigation" });
    await expect(bar).toBeVisible();
    // Only the views the demo serves. Notebook, Trips and Playbooks all lead
    // to signed-in routes, which for this visitor is a sign-in wall.
    await expect(bar.getByRole("link")).toHaveText(["Overview", "Plan", "Map"]);
    // The demo lands on Overview (§24), and the bar says so.
    await expect(bar.getByRole("link", { name: "Overview" })).toHaveAttribute("aria-current", "page");

    await bar.getByRole("link", { name: "Plan" }).click();
    await expect(page).toHaveURL(/\/demo\?view=Plan$/);
    await expect(page.getByText("Land at Haneda").first()).toBeVisible();
    await expect(bar.getByRole("link", { name: "Plan" })).toHaveAttribute("aria-current", "page");

    await bar.getByRole("link", { name: "Map" }).click();
    await expect(page).toHaveURL(/\/demo\?view=Map$/);
    await expect(page.getByTestId("map-lens")).toBeVisible();
    await expect(bar.getByRole("link", { name: "Map" })).toHaveAttribute("aria-current", "page");

    // And back to where the demo opened — the tab Mitchell asked for on
    // 2026-10-01. Without it the only way back off Map was the browser's Back.
    // The witness is the Overview document's editor, the same one
    // `m14-mobile-notebook` uses for a phone's Overview.
    await bar.getByRole("link", { name: "Overview" }).click();
    await expect(page).toHaveURL(/\/demo\?view=Overview$/);
    await expect(page.locator(".tc-page-editor")).toBeVisible();
    await expect(page.getByTestId("map-lens")).toHaveCount(0);
    await expect(bar.getByRole("link", { name: "Overview" })).toHaveAttribute("aria-current", "page");

    // The bar is `position: fixed`, so the page has to reserve its height or
    // the board's last row ends up underneath it. Measured as rendered sizes —
    // the reservation the page actually applies against the bar's actual box.
    const barHeight = (await bar.boundingBox())!.height;
    const reserved = await page
      .getByRole("main")
      .evaluate((el) => parseFloat(getComputedStyle(el).paddingBottom));
    expect(reserved).toBeCloseTo(barHeight, 0);
  });
});
