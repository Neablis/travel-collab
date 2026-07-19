import { expect, test } from "@playwright/test";
import { dragCardTo, signInAsDevUser } from "./helpers";

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
  // P2 surface move (#15): TripDateControl moved into the Settings sheet —
  // open it via the header's gear button. The sheet is a full-height overlay
  // (RadixDialog.Overlay covers the viewport), so it has to be closed again
  // before interacting with anything behind it (tabs, board).
  // 2026-10-10 is a Saturday.
  await page.getByRole("button", { name: "Trip settings" }).click();
  await page.getByLabel("Start date").fill("2026-10-10");
  await page.getByRole("button", { name: "Close" }).click();
  // Task L1: Timeline/Calendar merged into a single "Schedule" lens with a
  // SegmentedControl toggle — click the Schedule tab, then the Calendar
  // option within it, instead of a standalone "Calendar" top-level tab.
  await page.getByRole("tab", { name: "Schedule" }).click();
  await page.getByRole("radio", { name: "Calendar" }).click();
  await expect(page.getByText("Day 1")).toBeVisible();
  await expect(page.getByText("Day 2")).toBeVisible();
  await page.getByRole("tab", { name: "Board" }).click();
  // LensRouter navigation (ADR-012, URL-as-truth) is a real client-side route
  // update, not instant — wait for Board's own content to mount before
  // interacting with it, so we're not still hitting the Schedule lens's own
  // per-day "+ Add activity" triggers (same accessible name, one per day).
  await expect(page.getByTestId("backlog-column")).toBeVisible();

  // -- add an activity, geocode a place, assert a map pin --
  await page.getByRole("button", { name: "+ Add activity" }).click();
  await page.getByLabel("Activity title").fill("Fushimi Inari");
  await page.getByLabel("Place name").fill("Kyoto");
  await page.getByRole("button", { name: "Search" }).click();
  // C1 (#5): search results are a listbox/option combobox now, not a plain
  // button list — the result's accessible role is "option" (its explicit
  // role="option" overrides the underlying <button>'s implicit role).
  await page.getByRole("option", { name: "Kyoto, Japan" }).click();
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
  await dragCardTo(fushimi, day1);
  await expect(day1.getByText("Fushimi Inari")).toBeVisible();

  // Assert the map pin.
  await page.getByRole("tab", { name: "Map" }).click();
  // LensRouter navigation (ADR-012, URL-as-truth) is a real client-side route
  // update, not instant — wait for the Map lens to mount before asserting.
  await expect(page.getByTestId("map-lens")).toBeVisible();
  // #26: the located-activities list was removed — a geocoded activity now
  // shows only as a map marker. The map canvas renders only when at least one
  // activity has a location (pins.length > 0); its presence (vs. the "No
  // located activities yet" empty state) confirms Fushimi Inari's geocode
  // landed.
  await expect(page.locator(".map-lens-canvas")).toBeVisible();
  await page.getByRole("tab", { name: "Board" }).click();

  // -- anchor-violation conflict badge (day 1 = Saturday, anchor excludes it) --
  await expect(day1.getByRole("img", { name: "conflict" })).toBeVisible();

  // -- shift the start date so the anchor is satisfied; badge clears --
  // 2026-10-12 is a Monday.
  await page.getByRole("button", { name: "Trip settings" }).click();
  await page.getByLabel("Start date").fill("2026-10-12");
  await page.getByRole("button", { name: "Close" }).click();
  await expect(day1.getByRole("img", { name: "conflict" })).not.toBeVisible();

  // -- clear the date: date-based anchors go dormant --
  // #19: a one-item "Date options" popover was replaced by a direct "Clear
  // date" X next to the date in Settings (only shown when a date is set), so
  // there's no popover to open first.
  await page.getByRole("button", { name: "Trip settings" }).click();
  await page.getByRole("button", { name: "Clear date" }).click();
  await page.getByRole("button", { name: "Close" }).click();
  await expect(day1.getByRole("img", { name: "conflict" })).not.toBeVisible();

  // -- undo the shift: dates and the conflict return --
  // The "Clear dates" click and the date shift are each their own change; two undos
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
  await page.getByRole("button", { name: "Trip settings" }).click();
  await expect(page.getByLabel("Start date")).toHaveValue("2026-10-12");
  await page.getByRole("button", { name: "Close" }).click();
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes("/commands") && r.request().method() === "POST" && r.ok(),
    ),
    page.getByRole("button", { name: "Undo" }).click(),
  ]);
  await page.getByRole("button", { name: "Trip settings" }).click();
  await expect(page.getByLabel("Start date")).toHaveValue("2026-10-10");
  await page.getByRole("button", { name: "Close" }).click();
  await expect(day1.getByRole("img", { name: "conflict" })).toBeVisible();
});
