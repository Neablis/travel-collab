import { expect, test } from "@playwright/test";
import { dragCardTo, openHistory } from "./helpers";
import { e2eTripName } from "./tripNames";

test("money & lenses: currency, costs, rollups, budget conflict, dismiss, undo", async ({ page }) => {
  // Distinct prefix from other specs' trip names — see m3-place-and-time.spec.ts's
  // comment for why parallel workers need this.
  const tripName = e2eTripName("Porto");
  await page.goto("/");

  await page.getByRole("button", { name: "New trip" }).click();
  await page.getByLabel("Trip name").fill(tripName);
  await page.getByRole("button", { name: "Create empty" }).click();
  await page.getByRole("link", { name: tripName }).click();
  // level:2 disambiguates TripHeader's h2 from TripCard's own h3 heading.
  await expect(page.getByRole("heading", { name: tripName, level: 2 })).toBeVisible();

  // -- set the trip currency to EUR --
  // P2 surface move (#12b): currency/budget moved from the always-visible
  // header into the Settings sheet, opened via the header's gear button. The
  // sheet is a modal overlay (RadixDialog.Overlay covers the viewport), so
  // it's closed again before interacting with anything behind it.
  await page.getByRole("button", { name: "Trip settings" }).click();
  await page.getByLabel("currency").selectOption("EUR");
  await expect(page.getByLabel("Total for the trip")).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();

  // -- add a day, and a costed activity on it --
  await page.getByRole("button", { name: "Add a day", exact: true }).click();
  await expect(page.getByTestId("day-column")).toHaveCount(1);

  // "Add stop" (TripHeader) creates with no dayId — the Backlog column and its
  // "+ Add activity" button were deleted in Task 3.3, so a stop created this
  // way is parked in the Unscheduled drawer until it is dragged onto a day.
  await page.getByRole("button", { name: "Add stop" }).click();
  await page.getByLabel("What or where").fill("Flight to Rome");
  await page.getByLabel("Cost").fill("420.00");
  await page.getByRole("button", { name: "Add stop" }).last().click();

  const rack = page.getByTestId("unscheduled-rack");
  await rack.getByRole("button", { name: /unscheduled/i }).click();
  const flight = rack.getByTestId("rack-card").filter({ hasText: "Flight to Rome" });
  await expect(flight).toBeVisible();

  const day1 = page.getByTestId("day-column").nth(0);
  await dragCardTo(flight, day1);
  await expect(day1.getByText("Flight to Rome")).toBeVisible();

  // -- add an unscheduled (trip-level) costed activity: stays parked --
  await page.getByRole("button", { name: "Add stop" }).click();
  await page.getByLabel("What or where").fill("Travel insurance");
  await page.getByLabel("Cost").fill("99.00");
  await page.getByRole("button", { name: "Add stop" }).last().click();
  await expect(rack.getByTestId("rack-card").filter({ hasText: "Travel insurance" })).toBeVisible();

  // -- per-day subtotal on the Timeline lens --
  // This used to read the same rollup off the Itinerary, Daily-overview and
  // Full-trip lenses via `?lens=`; KI-20 retired all three (they had no nav
  // entry and the M10 redesign never contemplated them), so the money
  // assertions now run against the surfaces that survived. Timeline's per-day
  // cost pill is the day subtotal.
  await page.getByRole("tab", { name: "Timeline" }).click();
  await expect(page.locator('[data-testid^="day-cost-"]').first()).toHaveText("€420.00");

  // The unscheduled (trip-level) 99.00 EUR stop stays parked in the rack — see
  // its rack-card assertion above; the trip total that rolls both together is
  // asserted through the over-budget conflict text below.

  // The conflict banner only renders on the Board lens; switch there for the
  // budget-conflict assertions below.
  await page.getByRole("tab", { name: "Day columns" }).click();

  // -- set a budget below the total: over-budget warning appears --
  // MoneyInput debounces/commits on blur (avoids firing one SetTripBudget
  // command per keystroke) — press Tab to flush immediately rather than
  // waiting out the debounce window.
  // P2 surface move (#12b): the budget field now lives in the Settings sheet;
  // reopen it (the earlier open closed once a lens tab was clicked, since
  // it's a plain click outside the sheet's content, which Radix Dialog
  // treats as a dismiss). The sheet is a modal overlay, so it's closed again
  // before asserting on / interacting with the Board's conflict banner below.
  await page.getByRole("button", { name: "Trip settings" }).click();
  const budgetInput = page.getByLabel("Total for the trip");
  await budgetInput.fill("100.00");
  await Promise.all([
    page.waitForResponse((r) => r.url().includes("/commands") && r.request().method() === "POST" && r.ok()),
    budgetInput.press("Tab"),
  ]);
  await page.getByRole("button", { name: "Close" }).click();
  // The conflict description carries the trip-wide rollup (420.00 scheduled +
  // 99.00 unscheduled) — the assertion the retired Full-trip lens used to make.
  await expect(page.getByText(/Trip total \(519\.00 EUR\) exceeds the budget/)).toBeVisible();

  // -- raise the budget above the total: warning clears --
  await page.getByRole("button", { name: "Trip settings" }).click();
  await budgetInput.fill("1000.00");
  await Promise.all([
    page.waitForResponse((r) => r.url().includes("/commands") && r.request().method() === "POST" && r.ok()),
    budgetInput.press("Tab"),
  ]);
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.getByText(/exceeds the budget/)).not.toBeVisible();

  // -- undo the last cost edit: the budget field and the warning both revert --
  await openHistory(page);
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes("/commands") && r.request().method() === "POST" && r.ok(),
    ),
    page.getByRole("button", { name: "Undo" }).click(),
  ]);
  await page.getByRole("button", { name: "Trip settings" }).click();
  await expect(budgetInput).toHaveValue("100.00");
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.getByText(/exceeds the budget/)).toBeVisible();

  // -- dismiss the (now-restored) warning: it stays dismissed --
  await page.getByRole("button", { name: /^Dismiss:/ }).click();
  await expect(page.getByText(/exceeds the budget/)).not.toBeVisible();
});
