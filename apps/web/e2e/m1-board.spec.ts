import { expect, test } from "@playwright/test";
import { dragCardTo, signInAsDevUser } from "./helpers";

test("board: days, activities, drag, conflicts as data", async ({ page }) => {
  const tripName = `Lisbon ${Date.now()}`;
  await signInAsDevUser(page, "alice");

  await page.getByRole("button", { name: "New trip" }).click();
  await page.getByLabel("Trip name").fill(tripName);
  await page.getByRole("button", { name: "Create trip" }).click();
  await page.getByRole("link", { name: tripName }).click();
  // level:2 disambiguates TripHeader's h2 from TripCard's own h3 heading —
  // the same class of ambiguity fixed elsewhere post-M10 restyle (see
  // m2/m3/m4/smoke's fix commit); this spec hadn't hit it until now.
  await expect(page.getByRole("heading", { name: tripName, level: 2 })).toBeVisible();

  await page.getByRole("button", { name: "+ Add day" }).click();
  await expect(page.getByTestId("day-column")).toHaveCount(1);
  await page.getByRole("button", { name: "+ Add day" }).click();
  await expect(page.getByTestId("day-column")).toHaveCount(2);

  // Two overlapping activities into the backlog
  await page.getByRole("button", { name: "+ Add activity" }).click();
  await page.getByLabel("Activity title").fill("Colosseum");
  await page.getByLabel("Start time").fill("09:00");
  await page.getByLabel("End time").fill("11:00");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Colosseum")).toBeVisible();

  await page.getByRole("button", { name: "+ Add activity" }).click();
  await page.getByLabel("Activity title").fill("Vatican Museums");
  await page.getByLabel("Start time").fill("10:00");
  await page.getByLabel("End time").fill("12:00");
  await page.getByRole("button", { name: "Save" }).click();

  const colosseum = page.getByTestId(/activity-card-/).filter({ hasText: "Colosseum" });
  const vatican = page.getByTestId(/activity-card-/).filter({ hasText: "Vatican Museums" });
  const day1 = page.getByTestId("day-column").nth(0);
  const day2 = page.getByTestId("day-column").nth(1);

  await dragCardTo(colosseum, day1);
  await expect(day1.getByText("Colosseum")).toBeVisible();
  await dragCardTo(vatican, day1);
  await expect(day1.getByText("Vatican Museums")).toBeVisible();

  // The conflict appears as data — the writes above all succeeded.
  await expect(page.getByText(/overlap in time/)).toBeVisible();

  // Resolving by moving away clears it.
  await dragCardTo(vatican, day2);
  await expect(day2.getByText("Vatican Museums")).toBeVisible();
  await expect(page.getByText(/overlap in time/)).not.toBeVisible();
});
