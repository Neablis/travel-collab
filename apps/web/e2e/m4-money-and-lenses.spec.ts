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
  await expect(page.getByRole("heading", { name: tripName })).toBeVisible();

  // -- set the trip currency to EUR --
  // P2 surface move (#12b): currency/budget moved from the always-visible
  // header into the Settings sheet, opened via the header's gear button. The
  // sheet is a modal overlay (RadixDialog.Overlay covers the viewport), so
  // it's closed again before interacting with anything behind it.
  await page.getByRole("button", { name: "Trip settings" }).click();
  await page.getByLabel("currency").selectOption("EUR");
  await expect(page.getByLabel("cost (EUR)").first()).toBeVisible();
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
  await page.getByRole("tab", { name: "Itinerary" }).click();
  await expect(page.getByText("420.00 EUR").first()).toBeVisible();
  await expect(page.getByText("Unscheduled")).toBeVisible();
  await expect(page.getByText("99.00 EUR").first()).toBeVisible();

  // -- Daily lens: per-day count/subtotal --
  // LensRouter navigation (ADR-012, URL-as-truth) is a real client-side route
  // update, not instant — right after the click the previous lens (Itinerary)
  // is still mounted. Itinerary's own markup coincidentally also renders
  // "420.00 EUR" twice for this fixture (a single $420 activity means its
  // per-activity cost cell equals the day subtotal), so asserting on that text
  // alone can hit a strict-mode violation mid-transition. Wait for the Daily
  // lens's own container to mount first, disambiguating which lens is live.
  await page.getByRole("tab", { name: "Daily" }).click();
  await expect(page.getByTestId("daily-overview-lens")).toBeVisible();
  await expect(page.getByText("420.00 EUR")).toBeVisible();

  // -- Trip lens: total renders --
  await page.getByRole("tab", { name: "Trip" }).click();
  await expect(page.getByText("519.00 EUR")).toBeVisible();

  // The conflict banner only renders on the Board lens; switch there for the
  // budget-conflict assertions below.
  await page.getByRole("tab", { name: "Board" }).click();

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
  const budgetInput = page.getByLabel("cost (EUR)").first();
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
