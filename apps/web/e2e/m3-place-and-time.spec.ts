import { expect, test } from "@playwright/test";
import { signInAsDevUser } from "./helpers";

test("place & time: dates, geocoded pin, anchor violation, shift/clear/undo", async ({ page }) => {
  // Distinct prefix from other specs' trip names — parallel workers share the
  // "alice" dev user's trip list, and a same-millisecond Date.now() would
  // otherwise make specs' trip names collide.
  const tripName = `Kyoto ${Date.now()}`;

  // Stub the geocoder: e2e has no real LOCATIONIQ_API_KEY, so intercept the
  // app's own /api/geocode route before it reaches the Next.js server (which
  // would otherwise throw for a missing key). One canned result is enough to
  // drive the map-pin assertion deterministically.
  await page.route("**/api/geocode**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        results: [{ lat: 35.0116, lng: 135.7681, canonicalName: "Kyoto, Japan", countryCode: "JP" }],
      }),
    });
  });

  await signInAsDevUser(page, "alice");

  await page.getByLabel("Trip name").fill(tripName);
  await page.getByRole("button", { name: "Create trip" }).click();
  await page.getByRole("link", { name: tripName }).click();
  await expect(page.getByRole("heading", { name: tripName })).toBeVisible();

  await page.getByRole("button", { name: "+ Add day" }).click();
  await expect(page.getByTestId("day-column")).toHaveCount(1);
  await page.getByRole("button", { name: "+ Add day" }).click();
  await expect(page.getByTestId("day-column")).toHaveCount(2);

  // -- start date: calendar shows the derived dates --
  // 2026-10-10 is a Saturday.
  await page.getByLabel("Start date").fill("2026-10-10");
  await page.getByRole("tab", { name: "Calendar" }).click();
  await expect(page.getByText("Day 1")).toBeVisible();
  await expect(page.getByText("Day 2")).toBeVisible();
  await page.getByRole("tab", { name: "Board" }).click();

  // -- add an activity, geocode a place, assert a map pin --
  await page.getByRole("button", { name: "+ Add activity" }).click();
  await page.getByLabel("Activity title").fill("Fushimi Inari");
  await page.getByLabel("Place name").fill("Kyoto");
  await page.getByRole("button", { name: "Search" }).click();
  await page.getByRole("button", { name: "Kyoto, Japan" }).click();
  await expect(page.getByText("Kyoto, Japan")).toBeVisible();

  // -- add a dayOfWeek anchor (default: weekdays mon-fri) that day 1's
  // Saturday violates --
  await page.getByLabel("anchor kind").selectOption("dayOfWeek");
  await page.getByRole("button", { name: "Add anchor" }).click();
  await expect(page.getByText("Days: mon, tue, wed, thu, fri")).toBeVisible();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Fushimi Inari")).toBeVisible();

  const fushimi = page.getByTestId(/activity-card-/).filter({ hasText: "Fushimi Inari" });
  const day1 = page.getByTestId("day-column").nth(0);
  await fushimi.dragTo(day1);
  await expect(day1.getByText("Fushimi Inari")).toBeVisible();

  // Assert the map pin.
  await page.getByRole("tab", { name: "Map" }).click();
  await expect(page.getByRole("button", { name: "Fushimi Inari" })).toBeVisible();
  await page.getByRole("tab", { name: "Board" }).click();

  // -- anchor-violation conflict badge (day 1 = Saturday, anchor excludes it) --
  await expect(day1.getByRole("img", { name: "conflict" })).toBeVisible();

  // -- shift the start date so the anchor is satisfied; badge clears --
  // 2026-10-12 is a Monday.
  await page.getByLabel("Start date").fill("2026-10-12");
  await expect(day1.getByRole("img", { name: "conflict" })).not.toBeVisible();

  // -- clear the date: date-based anchors go dormant --
  await page.getByRole("button", { name: "Clear" }).click();
  await expect(day1.getByRole("img", { name: "conflict" })).not.toBeVisible();

  // -- undo the shift: dates and the conflict return --
  // The "Clear" click and the date shift are each their own change; two undos
  // get back to the pre-shift (Saturday) state where the anchor is violated.
  // Wait for each undo's command POST to resolve before firing the next one —
  // undo is an ordinary optimistic-concurrency-checked command, and firing
  // both clicks back-to-back can race the trip's version and silently no-op.
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes("/commands") && r.request().method() === "POST" && r.ok(),
    ),
    page.getByRole("button", { name: "Undo" }).click(),
  ]);
  await expect(page.getByLabel("Start date")).toHaveValue("2026-10-12");
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes("/commands") && r.request().method() === "POST" && r.ok(),
    ),
    page.getByRole("button", { name: "Undo" }).click(),
  ]);
  await expect(page.getByLabel("Start date")).toHaveValue("2026-10-10");
  await expect(day1.getByRole("img", { name: "conflict" })).toBeVisible();
});
