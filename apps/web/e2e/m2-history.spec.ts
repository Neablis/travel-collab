import { expect, test } from "@playwright/test";
import { dragCardTo, signInAsDevUser } from "./helpers";

test("history: dismiss persists, undo/redo, preview, revert", async ({ page }) => {
  // Distinct prefix from smoke.spec.ts's "Rome ..." — parallel workers share
  // the "alice" dev user's trip list, and a same-millisecond Date.now() would
  // otherwise make both specs' trip names collide.
  const tripName = `Venice ${Date.now()}`;
  await signInAsDevUser(page, "alice");

  // -- setup: a day with an overlap conflict (M1 vocabulary) --
  await page.getByLabel("Trip name").fill(tripName);
  await page.getByRole("button", { name: "Create trip" }).click();
  await page.getByRole("link", { name: tripName }).click();
  await expect(page.getByRole("heading", { name: tripName })).toBeVisible();
  await page.getByRole("button", { name: "+ Add day" }).click();
  await expect(page.getByTestId("day-column")).toHaveCount(1);

  await page.getByRole("button", { name: "+ Add activity" }).click();
  await page.getByLabel("Activity title").fill("Colosseum");
  await page.getByLabel("Start time").fill("09:00");
  await page.getByLabel("End time").fill("11:00");
  await page.getByRole("button", { name: "Save" }).click();
  await page.getByRole("button", { name: "+ Add activity" }).click();
  await page.getByLabel("Activity title").fill("Vatican Museums");
  await page.getByLabel("Start time").fill("10:00");
  await page.getByLabel("End time").fill("12:00");
  await page.getByRole("button", { name: "Save" }).click();

  const colosseum = page.getByTestId(/activity-card-/).filter({ hasText: "Colosseum" });
  const vatican = page.getByTestId(/activity-card-/).filter({ hasText: "Vatican Museums" });
  const day1 = page.getByTestId("day-column").nth(0);
  await dragCardTo(colosseum, day1);
  await expect(day1.getByText("Colosseum")).toBeVisible();
  await dragCardTo(vatican, day1);
  await expect(day1.getByText("Vatican Museums")).toBeVisible();
  await expect(page.getByText(/overlap in time/)).toBeVisible();

  // -- persistent dismissal --
  await page.getByRole("button", { name: /^Dismiss:/ }).click();
  await expect(page.getByText(/overlap in time/)).not.toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: tripName })).toBeVisible();
  await expect(page.getByText(/overlap in time/)).not.toBeVisible(); // survived the reload

  // -- undo / redo (dismissal is an ordinary change) --
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText(/overlap in time/)).toBeVisible();
  await page.getByRole("button", { name: "Redo" }).click();
  await expect(page.getByText(/overlap in time/)).not.toBeVisible();

  // -- history + read-only preview + revert --
  // P2 surface move (#13): History is now a Popover trigger in the trip
  // header, and its entries render inside the popover instead of an inline
  // panel pushing page content down.
  await page.getByRole("button", { name: "History" }).click();
  await expect(page.getByTestId("history-entry").first()).toContainText("Redid: Dismissed a conflict");
  // preview the moment just before Vatican Museums moved onto Day 1:
  await page.getByRole("button", { name: 'Moved "Colosseum" to Day 1' }).click();
  await expect(page.getByText(/Viewing version \d+ \(read-only\)/)).toBeVisible();
  await expect(day1.getByText("Vatican Museums")).not.toBeVisible(); // past state
  await page.getByRole("button", { name: "Dismiss", exact: true }).click(); // #16b: was "Back to now"
  await expect(day1.getByText("Vatican Museums")).toBeVisible();

  await page.getByRole("button", { name: 'Moved "Colosseum" to Day 1' }).click();
  await page.getByRole("button", { name: "Revert to here" }).click();
  await expect(page.getByText(/Viewing version/)).not.toBeVisible();
  await expect(day1.getByText("Vatican Museums")).not.toBeVisible(); // reverted for real
  await expect(day1.getByText("Colosseum")).toBeVisible();
  await expect(page.getByText(/overlap in time/)).not.toBeVisible(); // no overlap in that state
  await expect(page.getByTestId("history-entry").first()).toContainText("Reverted to version");
});
