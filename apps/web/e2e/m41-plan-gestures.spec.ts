import { expect, test } from "./fixtures/test";
import { createMappedTrip, dragCardTo } from "./helpers";
import { e2eTripName } from "./tripNames";

// M41 D7: Plan's direct gestures. A day's header carries the whole day onto
// another, and Option/Alt held at the drop leaves a copy where the stop would
// have gone. The top edge and Delete are DayRiver's unit tests; these two need
// a real drag, which jsdom cannot make. `mappedTrip` gives each day one stop,
// 9–10 am, "Stop on day N".

test("a day's header dragged onto another day moves its stops there", async ({ page }) => {
  const tripId = await createMappedTrip(page, e2eTripName("DayDrag"), 3);
  await page.goto(`/trips/${tripId}?view=Plan`);
  const column = (i: number) => page.getByTestId("day-column").nth(i);
  await expect(column(0).getByTestId(/^activity-card-/)).toHaveCount(1);

  await dragCardTo(column(0).locator("[data-day-header]"), column(2));

  await expect(column(0).getByTestId(/^activity-card-/)).toHaveCount(0);
  await expect(column(2).getByTestId(/^activity-card-/)).toHaveCount(2);
  await expect(column(2).getByRole("button", { name: /^Edit Stop on day 1,/ })).toBeVisible();
});

test("a stop dragged with Option held leaves a copy, and stays where it was", async ({ page }) => {
  const tripId = await createMappedTrip(page, e2eTripName("AltCopy"), 2);
  await page.goto(`/trips/${tripId}?view=Plan`);
  const column = (i: number) => page.getByTestId("day-column").nth(i);

  await page.keyboard.down("Alt");
  await dragCardTo(column(1).getByTestId(/^activity-card-/), column(0));
  await page.keyboard.up("Alt");

  await expect(column(0).getByRole("button", { name: /^Edit Stop on day 2,/ })).toBeVisible();
  await expect(column(1).getByRole("button", { name: /^Edit Stop on day 2,/ })).toBeVisible();
});
