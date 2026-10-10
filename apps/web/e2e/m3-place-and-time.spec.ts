import { expect, test } from "./fixtures/test";
import { dragCardTo, openHistory, openPlan, createEmptyTripViaWizard, openNewParkedStop, openRack } from "./helpers";
import { e2eTripName } from "./tripNames";

test("place & time: dates, geocoded pin, shift/clear/undo", async ({ page }) => {
  // Distinct prefix from other specs' trip names — parallel workers share the
  // "alice" dev user's trip list, and a same-millisecond Date.now() would
  // otherwise make specs' trip names collide.
  const tripName = e2eTripName("Kyoto");

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

  await createEmptyTripViaWizard(page, tripName);
  await page.getByRole("link", { name: tripName }).click();
  // level:1 disambiguates TripHeader's h1 from TripCard's own h3 heading.
  await expect(page.getByRole("heading", { name: tripName, level: 1 })).toBeVisible();
  await openPlan(page);

  await page.getByRole("button", { name: "Add a day", exact: true }).click();
  await expect(page.getByTestId("day-column")).toHaveCount(1);
  await page.getByRole("button", { name: "Add a day", exact: true }).click();
  await expect(page.getByTestId("day-column")).toHaveCount(2);

  // -- start date: calendar shows the derived dates --
  // P2 surface move (#15): TripDateControl moved into the Settings sheet —
  // open it via the header's gear button, then click the Dates row to expand
  // TripDateControl inline beneath it (M39 decision 8; a popover until then,
  // restored in M10 Phase 4). The
  // sheet is a full-height overlay (RadixDialog.Overlay covers the
  // viewport), so it has to be closed again before interacting with
  // anything behind it (tabs, board).
  // 2026-10-10 is a Saturday.
  await page.getByRole("button", { name: "Trip settings" }).click();
  // KI-048 item 5: the popover opened over "Total for the trip". Inline, the
  // editor takes its own space in the sheet's column, so opening it pushes the
  // total down by the editor's height. A popover moves nothing, which is the
  // property this pins: at 1280px the popover happened to miss the total (it
  // was right-aligned, ~300px above it), so "is the total covered?" alone
  // passes against the popover too, and was seen to.
  const datesRow = page.getByRole("button", { name: "Dates", exact: true });
  const total = page.getByLabel("Total for the trip");
  // Cover sits between Dates and the total and settles on its own reads (a
  // 132px skeleton, then the picker), so a "before" taken too early saw the
  // total 74px lower than after, with the editor open (ci-like, PR #363).
  // Measure once Cover's skeleton is gone and the total has stopped moving.
  const cover = page.getByRole("dialog", { name: "Trip settings" }).getByRole("region", { name: "Cover photo" });
  await expect(cover.locator("[data-sk]")).toHaveCount(0);
  let lastTop = Number.NaN;
  await expect
    .poll(async () => {
      const top = (await total.boundingBox())!.y;
      const still = top === lastTop;
      lastTop = top;
      return still;
    })
    .toBe(true);
  const totalTopBefore = lastTop;
  await datesRow.click();
  const editor = page.locator(`[id="${await datesRow.getAttribute("aria-controls")}"]`);
  await expect(editor.getByLabel("Trip start date")).toBeVisible();
  const editorBox = (await editor.boundingBox())!;
  const totalTopAfter = (await total.boundingBox())!.y;
  expect(totalTopAfter - totalTopBefore).toBeGreaterThanOrEqual(editorBox.height);
  expect(editorBox.y + editorBox.height).toBeLessThanOrEqual(totalTopAfter);
  // TripDateControl (Task 8b.6: the end is derived, never picked) commits
  // SetTripStartDate as soon as a complete date is selected (feedback fix,
  // 2026-08-24: "you shouldnt have to hit done") — fill() sets the whole
  // value in one go, same as a real picker selection. Wait for that
  // command's POST to resolve before closing the sheet — later assertions
  // (the day column's date label) depend on the commit having landed.
  // Filling also collapses the Dates editor itself (SettingsSheet's onCommand
  // wrapper), same as the Clear-date X below.
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes("/commands") && r.request().method() === "POST" && r.ok(),
    ),
    page.getByLabel("Trip start date").fill("2026-10-10"),
  ]);
  await expect(datesRow).toHaveAttribute("aria-expanded", "false");
  await page.getByRole("button", { name: "Close" }).click();
  // TripViewTabs.tsx (M10 redesign-feedback follow-up): Calendar is its own
  // top-level tab now, matching the design handoff's 3-tab strip — no more
  // Schedule->Calendar two-step through a nested SegmentedControl.
  await page.getByRole("tab", { name: "Calendar" }).click();
  await expect(page.getByText("Day 1", { exact: true })).toBeVisible();
  await expect(page.getByText("Day 2", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Plan" }).click();
  // LensRouter navigation (ADR-012, URL-as-truth) is a real client-side route
  // update, not instant — wait for Board's own content to mount before
  // interacting with it. (Task 3.3 deleted the Backlog column this used to
  // wait for; a day column is the equivalent proof the Board lens is up.)
  await expect(page.getByTestId("day-column").first()).toBeVisible();

  // -- add an activity, geocode a place, assert a map pin --
  // "Add stop" (TripHeader) is the create-with-no-dayId trigger now that the
  // Backlog column's "+ Add activity" is gone; the stop lands in the
  // Unscheduled drawer, which is collapsed until opened.
  await openNewParkedStop(page);
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
  await openRack(page);
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
  await page.getByRole("tab", { name: "Plan" }).click();

  // -- shift the start date; day 1's own date label reflects the change --
  // (D-1: this used to also assert an anchor-violation conflict badge
  // toggling off across the shift/clear/undo below — anchors have no UI to
  // author since Wave B, so there's no conflict to badge. The day column's
  // date label is still directly observable and still proves
  // SetTripStartDate commits/undoes correctly, which was always the actual
  // point of this section.)
  await expect(day1.getByText(/day 1.*oct 10/i)).toBeVisible();
  // 2026-10-12 is a Monday.
  await page.getByRole("button", { name: "Trip settings" }).click();
  // The Dates editor collapses itself after every committed change, and
  // SettingsSheet collapses it whenever the sheet closes (an inline editor has
  // no outside-click dismiss to do that for it) — so every visit below opens
  // it with a fresh click, and that click must expand rather than toggle a
  // stale-open editor shut.
  await page.getByRole("button", { name: "Dates", exact: true }).click();
  // Task 8b.6: there is no end field to race — the end is always derived
  // from the plan's own day count, so shifting the start alone can never
  // trip a shrink-confirmation (that dialog is gone with the field).
  // Same commit race as the initial date-set above — wait for the
  // selection's command POST before closing the sheet.
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes("/commands") && r.request().method() === "POST" && r.ok(),
    ),
    page.getByLabel("Trip start date").fill("2026-10-12"),
  ]);
  await page.getByRole("button", { name: "Close" }).click();
  await expect(day1.getByText(/day 1.*oct 12/i)).toBeVisible();

  // -- clear the date --
  // #19: a one-item "Date options" popover was replaced by a direct "Clear
  // date" X next to the date in Settings (only shown when a date is set) —
  // that's TripDateControl's own Clear-date X, not a second popover. It
  // lives inside the Dates row's inline editor, so that needs expanding
  // first, same as every other access below.
  await page.getByRole("button", { name: "Trip settings" }).click();
  await page.getByRole("button", { name: "Dates", exact: true }).click();
  await page.getByRole("button", { name: "Clear date" }).click();
  await page.getByRole("button", { name: "Close" }).click();
  await expect(day1.getByText("Day 1", { exact: true })).toBeVisible();

  // -- undo twice: back to the pre-shift start date --
  // The "Clear date" click and the date shift are each their own change; two
  // undos get back to the original 2026-10-10 state.
  // Wait for each undo's command POST to resolve before firing the next one —
  // undo is an ordinary optimistic-concurrency-checked command, and firing
  // both clicks back-to-back can race the trip's version and silently no-op.
  await openHistory(page);
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes("/commands") && r.request().method() === "POST" && r.ok(),
    ),
    page.getByRole("button", { name: "Undo" }).click(),
  ]);
  await page.getByRole("button", { name: "Trip settings" }).click();
  await page.getByRole("button", { name: "Dates", exact: true }).click();
  await expect(page.getByLabel("Trip start date")).toHaveValue("2026-10-12");
  await page.getByRole("button", { name: "Close" }).click();
  // Opening the settings sheet above closed the History popover, so it has to
  // be reopened before this second undo.
  await openHistory(page);
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes("/commands") && r.request().method() === "POST" && r.ok(),
    ),
    page.getByRole("button", { name: "Undo" }).click(),
  ]);
  await page.getByRole("button", { name: "Trip settings" }).click();
  await page.getByRole("button", { name: "Dates", exact: true }).click();
  await expect(page.getByLabel("Trip start date")).toHaveValue("2026-10-10");
  await page.getByRole("button", { name: "Close" }).click();
  await expect(day1.getByText(/day 1.*oct 10/i)).toBeVisible();
});
