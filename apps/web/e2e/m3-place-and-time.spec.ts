import { expect, test } from "@playwright/test";
import { dragCardTo } from "./helpers";

test("place & time: dates, geocoded pin, shift/clear/undo", async ({ page }) => {
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

  await page.goto("/");

  await page.getByRole("button", { name: "New trip" }).click();
  await page.getByLabel("Trip name").fill(tripName);
  await page.getByRole("button", { name: "Create empty" }).click();
  await page.getByRole("link", { name: tripName }).click();
  // level:2 disambiguates TripHeader's h2 from TripCard's own h3 heading.
  await expect(page.getByRole("heading", { name: tripName, level: 2 })).toBeVisible();

  await page.getByRole("button", { name: "Add a day", exact: true }).click();
  await expect(page.getByTestId("day-column")).toHaveCount(1);
  await page.getByRole("button", { name: "Add a day", exact: true }).click();
  await expect(page.getByTestId("day-column")).toHaveCount(2);

  // -- start date: calendar shows the derived dates --
  // P2 surface move (#15): TripDateControl moved into the Settings sheet —
  // open it via the header's gear button, then click the Dates row to open
  // the popover that mounts TripDateControl (restored, M10 Phase 4). The
  // sheet is a full-height overlay (RadixDialog.Overlay covers the
  // viewport), so it has to be closed again before interacting with
  // anything behind it (tabs, board).
  // 2026-10-10 is a Saturday.
  await page.getByRole("button", { name: "Trip settings" }).click();
  await page.getByRole("button", { name: "Dates" }).click();
  await page.getByLabel("Start date").fill("2026-10-10");
  // TripDateControl (M8/A14) stages date fields locally and only commits via
  // an explicit "Set dates" click, dispatching SetTripDates. Wait for that
  // command's POST to resolve before closing the sheet — later assertions
  // (the day column's date label) depend on the commit having landed.
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes("/commands") && r.request().method() === "POST" && r.ok(),
    ),
    page.getByRole("button", { name: "Set dates" }).click(),
  ]);
  await page.getByRole("button", { name: "Close" }).click();
  // TripViewTabs.tsx (M10 redesign-feedback follow-up): Calendar is its own
  // top-level tab now, matching the design handoff's 3-tab strip — no more
  // Schedule->Calendar two-step through a nested SegmentedControl.
  await page.getByRole("tab", { name: "Calendar" }).click();
  await expect(page.getByText("Day 1", { exact: true })).toBeVisible();
  await expect(page.getByText("Day 2", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Day columns" }).click();
  // LensRouter navigation (ADR-012, URL-as-truth) is a real client-side route
  // update, not instant — wait for Board's own content to mount before
  // interacting with it. (Task 3.3 deleted the Backlog column this used to
  // wait for; a day column is the equivalent proof the Board lens is up.)
  await expect(page.getByTestId("day-column").first()).toBeVisible();

  // -- add an activity, geocode a place, assert a map pin --
  // "Add stop" (TripHeader) is the create-with-no-dayId trigger now that the
  // Backlog column's "+ Add activity" is gone; the stop lands in the
  // Unscheduled drawer, which is collapsed until opened.
  await page.getByRole("button", { name: "Add stop" }).click();
  await page.getByLabel("What or where").fill("Fushimi Inari");
  await page.getByLabel("Place name").fill("Kyoto");
  await page.getByRole("button", { name: "Search" }).click();
  // C1 (#5): search results are a listbox/option combobox now, not a plain
  // button list — the result's accessible role is "option" (its explicit
  // role="option" overrides the underlying <button>'s implicit role).
  await page.getByRole("option", { name: "Kyoto, Japan" }).click();
  await expect(page.getByText("Kyoto, Japan")).toBeVisible();

  // D-1 (Wave B, commit 7ff1a40): the anchor-editing UI was retired
  // (AnchorEditor.tsx deleted) — anchor rules stay dormant with no UI left
  // to author them, so there's no "add an anchor" step here anymore. Save
  // directly (create mode's submit is "Add stop", not "Save" — Phase 7;
  // `.last()` disambiguates it from the header's own "Add stop" trigger,
  // still visible behind the open sheet).
  await page.getByRole("button", { name: "Add stop" }).last().click();

  const rack = page.getByTestId("unscheduled-rack");
  await rack.getByRole("button", { name: /unscheduled/i }).click();
  const fushimi = rack.getByTestId("rack-card").filter({ hasText: "Fushimi Inari" });
  await expect(fushimi).toBeVisible();

  const day1 = page.getByTestId("day-column").nth(0);
  await dragCardTo(fushimi, day1);
  await expect(day1.getByText("Fushimi Inari")).toBeVisible();

  // Assert the map pin. Map is one of the four peer view tabs (M10 Wave 2,
  // Task 1.2) — no longer behind a "More" menu.
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
  await page.getByRole("tab", { name: "Day columns" }).click();

  // -- shift the start date; day 1's own date label reflects the change --
  // (D-1: this used to also assert an anchor-violation conflict badge
  // toggling off across the shift/clear/undo below — anchors have no UI to
  // author since Wave B, so there's no conflict to badge. The day column's
  // date label is still directly observable and still proves SetTripDates
  // commits/undoes correctly, which was always the actual point of this
  // section.)
  await expect(day1.getByText(/day 1.*oct 10/i)).toBeVisible();
  // 2026-10-12 is a Monday.
  await page.getByRole("button", { name: "Trip settings" }).click();
  // The Dates popover closes itself after every committed change (see
  // SettingsSheet.tsx) and that closed state survives the Sheet's own
  // close/reopen (the popover's open/closed state lives in SettingsSheet,
  // which stays mounted) — so it needs a fresh click here too, not just
  // before the very first date set above.
  await page.getByRole("button", { name: "Dates" }).click();
  await page.getByLabel("Start date").fill("2026-10-12");
  // By this point the trip already has dated days (from the first "Set
  // dates" commit), so TripDateControl's End date field is pre-staged with
  // the trip's last day's date (TripHeader.tsx derives it from
  // trip.days[days.length - 1].date), not empty. Clear it so this commit
  // dispatches endDate: null — a start-only shift with dayCount untouched —
  // instead of racing a stale end date behind the new start date, which
  // trips the shrink-confirmation dialog.
  await page.getByLabel("End date").fill("");
  // Same commit race as the initial date-set above — wait for the "Set
  // dates" command's POST before closing the sheet.
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes("/commands") && r.request().method() === "POST" && r.ok(),
    ),
    page.getByRole("button", { name: "Set dates" }).click(),
  ]);
  await page.getByRole("button", { name: "Close" }).click();
  await expect(day1.getByText(/day 1.*oct 12/i)).toBeVisible();

  // -- clear the date --
  // #19: a one-item "Date options" popover was replaced by a direct "Clear
  // date" X next to the date in Settings (only shown when a date is set) —
  // that's TripDateControl's own Clear-date X, not a second popover. It
  // still lives inside the Dates row's popover (restored, M10 Phase 4), so
  // that popover needs opening first, same as every other access below.
  await page.getByRole("button", { name: "Trip settings" }).click();
  await page.getByRole("button", { name: "Dates" }).click();
  await page.getByRole("button", { name: "Clear date" }).click();
  await page.getByRole("button", { name: "Close" }).click();
  await expect(day1.getByText("Day 1", { exact: true })).toBeVisible();

  // -- undo twice: back to the pre-shift start date --
  // The "Clear date" click and the date shift are each their own change; two
  // undos get back to the original 2026-10-10 state.
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
  await page.getByRole("button", { name: "Dates" }).click();
  await expect(page.getByLabel("Start date")).toHaveValue("2026-10-12");
  await page.getByRole("button", { name: "Close" }).click();
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes("/commands") && r.request().method() === "POST" && r.ok(),
    ),
    page.getByRole("button", { name: "Undo" }).click(),
  ]);
  await page.getByRole("button", { name: "Trip settings" }).click();
  await page.getByRole("button", { name: "Dates" }).click();
  await expect(page.getByLabel("Start date")).toHaveValue("2026-10-10");
  await page.getByRole("button", { name: "Close" }).click();
  await expect(day1.getByText(/day 1.*oct 10/i)).toBeVisible();
});
