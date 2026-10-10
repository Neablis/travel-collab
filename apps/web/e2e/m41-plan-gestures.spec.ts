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

// PR 396 review: back-to-back stops sit 2px apart (RIVER_BLOCK_GAP_PX), and a
// top-edge band that reached above its block lay over the bottom grip of the
// block before it — so pulling the earlier stop's end moved the later one's
// start. Neither edge's band may reach into its neighbour.
test("between back-to-back stops, the earlier one's bottom grip changes its end and not the next one's start", async ({ page }) => {
  const tripId = await createMappedTrip(page, e2eTripName("BackToBack"), 1, {
    activitiesPerDay: 2,
    timeWindows: [
      { start: "09:00", end: "10:00" },
      { start: "10:00", end: "11:00" },
    ],
    title: (_day, index) => (index === 0 ? "Earlier" : "Later"),
  });
  await page.goto(`/trips/${tripId}?view=Plan`);
  const day = page.getByTestId("day-column").nth(0);
  const earlier = day.getByTestId(/activity-card-/).filter({ has: page.getByRole("button", { name: /^Edit Earlier,/ }) });

  const grip = earlier.getByTitle("Drag to change when it ends");
  await grip.scrollIntoViewIfNeeded();
  const box = (await grip.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  // An hour down, at 44px an hour.
  await page.mouse.move(x, y + 44, { steps: 8 });
  await page.mouse.up();

  await expect(day.getByRole("button", { name: /^Edit Earlier, 9 am – 11 am,/ })).toBeVisible();
  await expect(day.getByRole("button", { name: /^Edit Later, 10 am – 11 am,/ })).toBeVisible();
});

// PR 396 review: the top-edge band ran the block's full width, over the top of
// the ✕ in its title row, so a press on the ✕'s upper edge started a resize
// and removed nothing.
test("a press on the top edge of a block's ✕ removes the stop", async ({ page }) => {
  const tripId = await createMappedTrip(page, e2eTripName("TopEdgeRemove"), 1);
  await page.goto(`/trips/${tripId}?view=Plan`);
  const day = page.getByTestId("day-column").nth(0);
  const remove = day.getByRole("button", { name: /^Remove Stop on day 1/ });
  await remove.scrollIntoViewIfNeeded();
  const box = (await remove.boundingBox())!;

  await page.mouse.click(box.x + box.width / 2, box.y + 1);

  await expect(day.getByTestId(/^activity-card-/)).toHaveCount(0);
});

// PR 396 review: a day's header is no stop, and the rack cannot take a day —
// so lifting one must not open the rack as a stop's drag does.
test("lifting a day's header leaves the Unscheduled drawer shut", async ({ page }) => {
  const tripId = await createMappedTrip(page, e2eTripName("DayDragRack"), 2);
  await page.goto(`/trips/${tripId}?view=Plan`);
  const toggle = page.getByTestId("unscheduled-rack").getByRole("button", { name: /^Unscheduled/ });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  const header = page.getByTestId("day-column").nth(0).locator("[data-day-header]");
  const target = page.getByTestId("day-column").nth(1);
  await header.scrollIntoViewIfNeeded();
  const from = (await header.boundingBox())!;
  const to = (await target.boundingBox())!;

  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 6, from.y + from.height / 2 + 6, { steps: 3 });
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 25 });

  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await page.mouse.up();
  // The drag was real: the day's stop went with it.
  await expect(target.getByRole("button", { name: /^Edit Stop on day 1,/ })).toBeVisible();
});
