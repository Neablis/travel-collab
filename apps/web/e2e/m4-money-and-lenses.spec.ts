import { expect, test } from "@playwright/test";
import { dragCardTo, signInAsDevUser } from "./helpers";

test("money & lenses: currency, costs, rollups, budget conflict, dismiss, undo", async ({ page }) => {
  // Distinct prefix from other specs' trip names — see m3-place-and-time.spec.ts's
  // comment for why parallel workers need this.
  const tripName = `Porto ${Date.now()}`;
  await signInAsDevUser(page, "alice");

  await page.getByRole("button", { name: "New trip" }).click();
  await page.getByLabel("Trip name").fill(tripName);
  await page.getByRole("button", { name: "Create trip" }).click();
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
  await page.getByRole("button", { name: "+ Add day" }).click();
  await expect(page.getByTestId("day-column")).toHaveCount(1);

  await page.getByRole("button", { name: "+ Add activity" }).click();
  await page.getByLabel("Activity title").fill("Flight to Rome");
  await page.getByLabel("cost (EUR)").last().fill("420.00");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Flight to Rome")).toBeVisible();

  const flight = page.getByTestId(/activity-card-/).filter({ hasText: "Flight to Rome" });
  const day1 = page.getByTestId("day-column").nth(0);
  await dragCardTo(flight, day1);
  await expect(day1.getByText("Flight to Rome")).toBeVisible();

  // -- add an unscheduled (trip-level) costed activity: stays in the backlog --
  await page.getByRole("button", { name: "+ Add activity" }).click();
  await page.getByLabel("Activity title").fill("Travel insurance");
  await page.getByLabel("cost (EUR)").last().fill("99.00");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Travel insurance")).toBeVisible();

  // -- Itinerary lens: per-day subtotal and unscheduled section --
  // Itinerary/Daily/Trip have no nav entry at all as of M10 Wave 2's four-tab
  // strip (KI-20) — they kept their LensRouter entries and `?lens=` URLs, so
  // that's how the e2e suite reaches them too.
  const gotoLens = (lens: string) => {
    const url = new URL(page.url());
    url.searchParams.set("lens", lens);
    return page.goto(url.toString());
  };
  await gotoLens("Itinerary");
  await expect(page.getByText("420.00 EUR").first()).toBeVisible();
  await expect(page.getByText("Unscheduled")).toBeVisible();
  await expect(page.getByText("99.00 EUR").first()).toBeVisible();

  // -- Daily lens: per-day count/subtotal --
  await gotoLens("Daily");
  await expect(page.getByTestId("daily-overview-lens")).toBeVisible();
  await expect(page.getByText("420.00 EUR")).toBeVisible();

  // -- Trip lens: total renders --
  await gotoLens("Trip");
  await expect(page.getByText("519.00 EUR")).toBeVisible();

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
  await expect(page.getByText(/exceeds the budget/)).toBeVisible();

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
