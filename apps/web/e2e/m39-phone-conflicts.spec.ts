import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures/test";
import { createMappedTrip } from "./helpers";
import { e2eTripName } from "./tripNames";

// **M39 D9 — the phone shows a conflict state**: a count in the pinned row that
// opens a sheet, plus the marker on the stop's card. Before this a phone saw a
// conflict only as a banner over Plan's one day, so a conflict on any other
// day, or on any other tab, was not on screen at all. Runs in the `phone`
// project, at Mitchell's 411×852; the last test opens a 1280px desktop beside
// it, where the banner is still the surface and there is no chip.

const STOPS = ["Museum", "Lunch"];

// Two days, each with two stops at 09:00–10:00 and 09:30–10:30: one
// `time-overlap` conflict per day, so one of them is always on a day the phone
// is not showing.
async function overlappingTrip(page: Page, label: string): Promise<string> {
  return createMappedTrip(page, e2eTripName(label), 2, {
    activitiesPerDay: 2,
    timeWindows: [
      { start: "09:00", end: "10:00" },
      { start: "09:30", end: "10:30" },
    ],
    title: (day, i) => `${STOPS[i]} on day ${day + 1}`,
  });
}

const chip = (page: Page) => page.locator('header[aria-label="Trip"]').getByRole("button", { name: /^\d+ things? to look at$/ });

test.describe("M39 D9 — the phone's conflict state", () => {
  test("counts the trip's conflicts from every tab, and jumps to the stop on Plan", async ({ page }) => {
    const tripId = await overlappingTrip(page, "PhoneConflicts");

    // A trip opens on Overview, and the count is there already.
    await page.goto(`/trips/${tripId}`);
    await expect(page.getByTestId("itinerary-day")).toHaveCount(2);
    await expect(chip(page)).toHaveAccessibleName("2 things to look at");

    // Plan: the same count, and no banner over the day. The chip's sheet is
    // the phone's one list.
    await page.getByRole("navigation", { name: "Phone navigation" }).getByRole("link", { name: "Plan" }).click();
    await expect(page.getByTestId(/^activity-card-/).first()).toBeVisible();
    await expect(chip(page)).toHaveAccessibleName("2 things to look at");
    await expect(page.getByText(/overlap in time/).filter({ visible: true })).toHaveCount(0);

    // The stop's card carries the marker: drawn as an overlap, and saying so.
    const day1Card = page.getByTestId(/^activity-card-/).filter({ hasText: "Museum on day 1" });
    await expect(day1Card.getByRole("button", { name: /^Edit Museum on day 1, .*overlaps Lunch on day 1/ })).toBeAttached();
    await expect(day1Card.getByText("Overlap", { exact: true })).toBeVisible();

    // The sheet lists both, including the one on the day not on screen.
    await chip(page).click();
    const sheet = page.getByRole("dialog", { name: "Things to look at" });
    await expect(sheet.getByText(/overlap in time/)).toHaveCount(2);

    // Jump to day 2's: the sheet closes, the day rail moves to day 2, and the
    // stop's editor is open on Plan.
    await sheet.getByRole("button", { name: /^Jump to \w+ on day 2$/ }).click();
    await expect(sheet).toBeHidden();
    const editor = page.getByRole("dialog", { name: "Edit activity" });
    await expect(editor).toBeVisible();
    await expect(editor.getByLabel("What or where")).toHaveValue(/on day 2$/);
    await expect(page).toHaveURL(/view=Plan/);
    await page.keyboard.press("Escape");
    await expect(editor).toBeHidden();
    await expect(page.getByRole("group", { name: "Days" }).getByRole("button", { pressed: true })).toHaveAttribute("data-day-index", "1");
    const day2Card = page.getByTestId(/^activity-card-/).filter({ hasText: "on day 2" }).first();
    await expect(day2Card).toBeInViewport();
    await expect(page.getByTestId(/^activity-card-/).filter({ hasText: "on day 1" })).toHaveCount(0);
  });

  test("dismisses from the sheet until the chip is gone", async ({ page }) => {
    const tripId = await overlappingTrip(page, "PhoneDismiss");
    await page.goto(`/trips/${tripId}?view=Plan`);
    await expect(chip(page)).toHaveAccessibleName("2 things to look at");

    await chip(page).click();
    const sheet = page.getByRole("dialog", { name: "Things to look at" });
    await sheet.getByRole("button", { name: /^Dismiss: .*on day 1.* overlap in time/ }).click();
    await expect(sheet.getByText(/overlap in time/)).toHaveCount(1);
    // The sheet is modal, so the header is out of reach until it closes.
    await page.keyboard.press("Escape");
    await expect(chip(page)).toHaveAccessibleName("1 thing to look at");

    await chip(page).click();
    await sheet.getByRole("button", { name: /^Dismiss: / }).click();
    await expect(sheet).toBeHidden();
    await expect(chip(page)).toHaveCount(0);

    // A command, so it persists: still gone after a reload.
    await page.reload();
    await expect(page.getByTestId(/^activity-card-/).first()).toBeVisible();
    await expect(chip(page)).toHaveCount(0);
  });

  test("leaves the desktop as it was: the banner over the columns, no chip", async ({ page, browser }) => {
    const tripId = await overlappingTrip(page, "DesktopConflicts");
    const desktop = await browser.newContext({ viewport: { width: 1280, height: 900 }, storageState: ".auth/alice.json" });
    try {
      const wide = await desktop.newPage();
      await wide.goto(`/trips/${tripId}?view=Plan`);
      await expect(wide.getByRole("button", { name: /^Jump to \w+ on day 1$/ })).toBeVisible();
      await expect(wide.getByRole("button", { name: /^Jump to \w+ on day 2$/ })).toBeVisible();
      await expect(chip(wide)).toBeHidden();
    } finally {
      await desktop.close();
    }
  });
});
