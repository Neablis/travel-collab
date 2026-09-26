import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures/test";
import { centreOnPoint, createMappedTrip, dragCardTo, openHistory, reaim } from "./helpers";
import { e2eTripName } from "./tripNames";

// M29 part 3 — the river's gestures (SPEC §36.9b), in a real browser because
// that is the only place they exist: the sketch and the resize are pointer
// events on laid-out geometry, and the drop is native HTML5 drag, which jsdom
// has neither of. The arithmetic is `riverGestures.test.ts`, the routing of a
// drop `resolveDrop.test.ts`, and the command each gesture sends is asserted
// in `TripBoardScreen.test.tsx`; what this walks is that a person's pointer
// reaches them.
//
// **The trip.** Two days, each with a stop at 8–9 am and another at 4–5 pm,
// so the shared axis runs 8 am to 5 pm — 9 hours, 396px — and everything from
// 9 to 4 is empty time on both days. The river's top edge is 8 am and every
// y below is measured from it, at 44px an hour.

const PX_PER_HOUR = 44;
const AXIS_START = 8;

async function riverTrip(page: Page, label: string): Promise<string> {
  const tripId = await createMappedTrip(page, e2eTripName(label), 2, {
    activitiesPerDay: 2,
    timeWindows: [
      { start: "08:00", end: "09:00" },
      { start: "16:00", end: "17:00" },
    ],
    title: (day, index) => `Day ${day + 1} ${index === 0 ? "breakfast" : "walk"}`,
  });
  await page.goto(`/trips/${tripId}?view=Plan`);
  return tripId;
}

const river = (page: Page, day: number) => page.getByTestId("day-column").nth(day).getByTestId("day-river");

/** A point on a day's river: `hours` down the clock, 120px in (clear of the tick gutter). */
async function pointAt(target: Locator, hours: number): Promise<{ x: number; y: number }> {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (!box) throw new Error("the river has no box");
  return { x: box.x + 120, y: box.y + (hours - AXIS_START) * PX_PER_HOUR };
}

/** A stop's edit button — its accessible name leads with its title and its time. */
const block = (scope: Locator | Page, name: RegExp) => scope.getByRole("button", { name });

test("double-clicking empty time opens the add sheet at that time", async ({ page }) => {
  await riverTrip(page, "RiverDblClick");

  // 12:05 — the quarter hour nearest is noon.
  const at = await pointAt(river(page, 0), 12 + 5 / 60);
  await page.mouse.dblclick(at.x, at.y);

  await expect(page.getByRole("heading", { name: "Add a stop" })).toBeVisible();
  await expect(page.getByLabel("Start", { exact: true })).toHaveValue("12:00");
  await page.getByLabel("What or where").fill("Lunch");
  await page.getByRole("button", { name: "Add stop" }).last().click();

  await expect(block(page.getByTestId("day-column").nth(0), /^Edit Lunch, 12 pm – 1 pm,/)).toBeVisible();
});

test("dragging across empty time opens the add sheet with that start and that length", async ({ page }) => {
  await riverTrip(page, "RiverSketch");

  const from = await pointAt(river(page, 1), 13);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x, from.y + 2.5 * PX_PER_HOUR, { steps: 8 });
  const ghost = river(page, 1).getByTestId("river-ghost");
  await expect(ghost).toHaveText("1 pm – 3:30 pm");
  await page.mouse.up();

  await expect(page.getByRole("heading", { name: "Add a stop" })).toBeVisible();
  await expect(page.getByLabel("Start", { exact: true })).toHaveValue("13:00");
  // Two and a half hours is none of the five lengths, so it is offered as drawn.
  await expect(page.getByLabel("How long").locator("option:checked")).toHaveText("2 h 30 m");
  await page.getByLabel("What or where").fill("Tea ceremony");
  await page.getByRole("button", { name: "Add stop" }).last().click();

  await expect(block(page.getByTestId("day-column").nth(1), /^Edit Tea ceremony, 1 pm – 3:30 pm,/)).toBeVisible();
});

test("dragging a block's bottom edge changes when it ends", async ({ page }) => {
  await riverTrip(page, "RiverResize");
  const day1 = page.getByTestId("day-column").nth(0);
  const breakfast = day1.getByTestId(/activity-card-/).filter({ has: block(page, /^Edit Day 1 breakfast,/) });

  const grip = breakfast.getByTitle("Drag to change when it ends");
  await grip.scrollIntoViewIfNeeded();
  const box = (await grip.boundingBox())!;
  const to = await pointAt(river(page, 0), 10.5);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, to.y, { steps: 8 });
  // The block itself stretches while the grip is held.
  await expect(block(day1, /^Edit Day 1 breakfast, 8 am – 10:30 am,/)).toBeVisible();
  await page.mouse.up();

  const toast = page.getByTestId("toast");
  await expect(toast).toContainText("Now ends at 10:30 am");
  // The toast says what happened without covering the rack, which the editable
  // Plan always pins across the bottom of the screen (CodeRabbit, PR #245).
  const toastBox = (await toast.boundingBox())!;
  const rackBox = (await page.getByTestId("unscheduled-rack").boundingBox())!;
  expect(toastBox.y + toastBox.height).toBeLessThanOrEqual(rackBox.y);
  await page.reload();
  await expect(block(page.getByTestId("day-column").nth(0), /^Edit Day 1 breakfast, 8 am – 10:30 am,/)).toBeVisible();
});

test("dragging a block to another day lands it at the time under the pointer, and one undo puts it back", async ({ page }) => {
  await riverTrip(page, "RiverDrop");
  const day1 = page.getByTestId("day-column").nth(0);
  const day2 = page.getByTestId("day-column").nth(1);
  const walk = day2.getByTestId(/activity-card-/).filter({ has: block(page, /^Edit Day 2 walk,/) });

  // Held by its middle, so the block's top is half its height above the
  // pointer: aim the pointer at 2 pm plus that, and the top lands at 2 pm.
  // Both are measured after `pointAt` has scrolled day 1 into view: a box
  // read before that scroll is stale by however far the page moved.
  // 2 pm is put mid-viewport first, and the pointer re-aimed on arrival: a
  // point near a viewport edge is inside the drag's auto-scroll hitbox, which
  // moved the page under the pointer by a load-dependent amount (this read
  // 2:15 pm, then 3 pm, on one `test:e2e:ci-like` run).
  await walk.scrollIntoViewIfNeeded();
  await centreOnPoint(river(page, 0), (14 - AXIS_START) * PX_PER_HOUR);
  const to = await pointAt(river(page, 0), 14);
  const box = (await walk.boundingBox())!;
  const held = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(held.x, held.y);
  await page.mouse.down();
  // The drag-intent nudge `dragCardTo` documents, before Chromium fires dragstart.
  await page.mouse.move(held.x + 6, held.y + 6, { steps: 3 });
  await page.mouse.move(to.x, to.y + box.height / 2, { steps: 20 });
  await reaim(river(page, 0), { x: 120, y: (14 - AXIS_START) * PX_PER_HOUR + box.height / 2 });

  // The outline of the block's own hour, where it will land.
  await expect(river(page, 0).getByTestId("river-ghost")).toHaveText("2 pm – 3 pm");
  await page.mouse.up();

  await expect(block(day1, /^Edit Day 2 walk, 2 pm – 3 pm,/)).toBeVisible();
  await expect(block(day2, /^Edit Day 2 walk,/)).toHaveCount(0);

  // The day and the time were one change: one undo restores both.
  await openHistory(page);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(block(day2, /^Edit Day 2 walk, 4 pm – 5 pm,/)).toBeVisible();
  await expect(block(day1, /^Edit Day 2 walk,/)).toHaveCount(0);
});

// Mitchell, 2026-09-26: "When dragging and dropping from anywhere, it should
// have same functionality of set the start time to where it's dropped, retain
// length it had". A stop off the Unscheduled rack used to keep the rack's own
// rule instead — its stored time, or a fitted one — and the river refused it.
test("dragging a stop off the rack onto a day's river lands it at that time with its own length, and one undo parks it again", async ({ page }) => {
  await riverTrip(page, "RiverRack");

  // Created with no day, so it is parked — with a time of its own, 9–11 am.
  await page.getByRole("button", { name: "Add stop" }).click();
  await page.getByLabel("What or where").fill("Tea house");
  await page.getByLabel("Start", { exact: true }).fill("09:00");
  await page.getByLabel("How long").selectOption("2 hours");
  await page.getByRole("button", { name: "Add stop" }).last().click();
  const rack = page.getByTestId("unscheduled-rack");
  await rack.getByRole("button", { name: /unscheduled/i }).click();
  const parked = rack.getByTestId("rack-card").filter({ hasText: "Tea house" });
  await expect(parked).toContainText("9 am – 11 am");

  // 1 pm on day 2's river. A rack card is not drawn to scale, so it has no
  // height to have been held by: its top goes to the pointer.
  await dragCardTo(parked, river(page, 1), { x: 120, y: (13 - AXIS_START) * PX_PER_HOUR });

  const day2 = page.getByTestId("day-column").nth(1);
  await expect(block(day2, /^Edit Tea house, 1 pm – 3 pm,/)).toBeVisible();
  await expect(parked).toHaveCount(0);

  // Onto the day and to its time were one change.
  await openHistory(page);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(parked).toContainText("9 am – 11 am");
  await expect(block(day2, /^Edit Tea house,/)).toHaveCount(0);
});
