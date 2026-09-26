import { expect, test } from "./fixtures/test";
import { createMappedTrip, dragCardTo, createEmptyTripViaWizard } from "./helpers";
import { e2eTripName } from "./tripNames";

test("board: days, activities, drag, conflicts as data", async ({ page, browser }) => {
  const tripName = e2eTripName("Lisbon");
  await page.goto("/");

  await createEmptyTripViaWizard(page, tripName);
  await page.getByRole("link", { name: tripName }).click();
  // level:2 disambiguates TripHeader's h2 from TripCard's own h3 heading —
  // the same class of ambiguity fixed elsewhere post-M10 restyle (see
  // m2/m3/m4/smoke's fix commit); this spec hadn't hit it until now.
  await expect(page.getByRole("heading", { name: tripName, level: 2 })).toBeVisible();
  // SPEC §24: entering a trip lands on Overview — *"You read a trip before you
  // change it."* This spec is about the board, so it goes to the one view that
  // edits.
  await page.getByRole("tab", { name: "Plan" }).click();

  await page.getByRole("button", { name: "Add a day", exact: true }).click();
  await expect(page.getByTestId("day-column")).toHaveCount(1);
  await page.getByRole("button", { name: "Add a day", exact: true }).click();
  await expect(page.getByTestId("day-column")).toHaveCount(2);

  // Two overlapping activities, created unscheduled. The board's full-width
  // Backlog column is gone (M10 Phase 3, Task 3.3) — the header's "Add stop"
  // is the openCreate() with no dayId that its "+ Add activity" button used to
  // be, and what it creates lands in the Unscheduled drawer.
  await page.getByRole("button", { name: "Add stop" }).click();
  await page.getByLabel("What or where").fill("Colosseum");
  await page.getByLabel("Start", { exact: true }).fill("09:00");
  await page.getByLabel("How long").selectOption("2 hours");
  await page.getByRole("button", { name: "Add stop" }).last().click();

  // The drawer is collapsed by default, and collapsed means not rendered — so
  // open it (which also makes it the user's, not a drag's, for the rest of the
  // spec) before looking for what was parked in it.
  const rack = page.getByTestId("unscheduled-rack");
  await rack.getByRole("button", { name: /unscheduled/i }).click();
  await expect(rack.getByTestId("rack-card").filter({ hasText: "Colosseum" })).toBeVisible();

  await page.getByRole("button", { name: "Add stop" }).click();
  await page.getByLabel("What or where").fill("Vatican Museums");
  await page.getByLabel("Start", { exact: true }).fill("10:00");
  await page.getByLabel("How long").selectOption("2 hours");
  await page.getByRole("button", { name: "Add stop" }).last().click();
  await expect(rack.getByTestId("rack-card").filter({ hasText: "Vatican Museums" })).toBeVisible();

  // Card-scoped, not a bare day-column substring: the overlap chip (M10 Phase 5)
  // renders the *other* stop's title inside the same column, so a plain
  // getByText would be one line-reorder away from a strict-mode violation.
  const day1 = page.getByTestId("day-column").nth(0);
  const day2 = page.getByTestId("day-column").nth(1);

  await dragCardTo(rack.getByTestId("rack-card").filter({ hasText: "Colosseum" }), day1);
  await expect(day1.getByTestId(/activity-card-/).filter({ hasText: "Colosseum" })).toBeVisible();
  await dragCardTo(rack.getByTestId("rack-card").filter({ hasText: "Vatican Museums" }), day1);
  await expect(day1.getByTestId(/activity-card-/).filter({ hasText: "Vatican Museums" })).toBeVisible();

  // The conflict appears as data — the writes above all succeeded.
  await expect(page.getByText(/overlap in time/)).toBeVisible();

  // **A hidden control is not a tappable one** (M29 part 2 review). The pair
  // overlaps, so each sits in a half-width lane whose Remove only comes up
  // under a hovering mouse. What is asserted is what a pointer at that spot
  // would actually hit, not how the control is styled.
  const colosseum = day1.getByTestId(/activity-card-/).filter({ hasText: "Colosseum" });
  const removeHit = (scope: typeof page) =>
    scope.getByRole("button", { name: "Remove Colosseum" }).evaluate((el) => {
      const box = el.getBoundingClientRect();
      const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      return hit !== null && el.contains(hit);
    });
  await page.mouse.move(0, 0);
  await expect.poll(() => removeHit(page), { message: "at rest, Remove is not under the pointer's reach" }).toBe(false);
  await colosseum.hover();
  await expect.poll(() => removeHit(page), { message: "hovered, Remove comes up and takes the click" }).toBe(true);

  // A touch tablet past 768px has no hover to bring it up with, so it shows it
  // always. `isMobile` + `hasTouch` is what makes Chromium report a coarse
  // pointer; the first assertion says so, or the rest would prove nothing.
  const tablet = await browser.newContext({
    viewport: { width: 1180, height: 820 },
    isMobile: true,
    hasTouch: true,
    storageState: ".auth/alice.json",
  });
  const tabletPage = await tablet.newPage();
  await tabletPage.goto(page.url());
  expect(await tabletPage.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
  await expect(tabletPage.getByRole("button", { name: "Remove Colosseum" })).toBeVisible();
  await expect.poll(() => removeHit(tabletPage), { message: "on touch, Remove is always reachable" }).toBe(true);
  await tablet.close();

  // Resolving by moving away clears it. Both stops are scheduled now, so this
  // is an ordinary card-to-card drag between day columns.
  const vatican = page.getByTestId(/activity-card-/).filter({ hasText: "Vatican Museums" });
  await dragCardTo(vatican, day2);
  await expect(day2.getByTestId(/activity-card-/).filter({ hasText: "Vatican Museums" })).toBeVisible();
  // eslint-disable-next-line playwright/no-useless-not -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
  await expect(page.getByText(/overlap in time/)).not.toBeVisible();
});

// 2026-09-06 preview feedback, on a fourteen-day trip: *"Its impossible to
// scroll right all the way to day 14, because it stops at day 13. Same with
// day 1."*
//
// The cause was arithmetic, not layout. The day scroller picks the selected day
// with `centralDayIndex`, which names the column nearest the box's centre — and
// a box wider than one column can never bring the FIRST or LAST column's centre
// to that line, so neither end could ever be selected however far you scrolled.
// `centralDayIndex` now takes the scroll-edge state Board measures.
//
// `/demo` because it needs no database and renders the canonical Japan fixture,
// which is long enough to overflow the scroller at the desktop width.
test("board: scrolling to either end selects the first and the last day", async ({ page }) => {
  await page.goto("/demo");
  // §24 again: `/demo` is the ordinary trip surface in read-only, so it lands on
  // Overview like any other trip.
  await page.getByRole("tab", { name: "Plan" }).click();

  const columns = page.getByRole("group", { name: "Day columns" });
  await expect(columns).toBeVisible();

  const dayCount = await page.locator("[data-day-index]").count();
  const lastIndex = dayCount - 1;
  // The bug needs a trip long enough that the scroller actually overflows; a
  // fixture short enough to fit would pass this test without exercising it.
  expect(dayCount).toBeGreaterThan(3);
  expect(await columns.evaluate((box) => box.scrollWidth - box.clientWidth)).toBeGreaterThan(0);

  /**
   * The indexes of every chip marked selected — a list, not one value, so this
   * asserts "exactly one, and it is that one" without a conditional.
   */
  const selectedIndexes = () =>
    page
      .locator('[data-day-index][aria-pressed="true"]')
      .evaluateAll((nodes) => nodes.map((node) => Number(node.getAttribute("data-day-index"))));

  // Hard right: the last day, not the interior one that owns the centre.
  await columns.evaluate((box) => {
    box.scrollLeft = box.scrollWidth;
  });
  await expect
    .poll(selectedIndexes, { message: "scrolled to the end, the last day is selected" })
    .toEqual([lastIndex]);

  // Hard left, the symmetric half of the same report.
  await columns.evaluate((box) => {
    box.scrollLeft = 0;
  });
  await expect
    .poll(selectedIndexes, { message: "scrolled to the start, day 1 is selected" })
    .toEqual([0]);
});

// KI-2026-09-25-c: dragging a card to the day-columns row's right edge and
// holding it there scrolled nothing, so a column that started off screen could
// not be reached in one gesture. Two causes, and this test fails on either: the
// row was never registered for pdnd's element auto-scroll (only the window
// was), and the app's `@atlaskit/pragmatic-drag-and-drop` was 2.x while the
// auto-scroll package pulled in its own 3.x — two copies, two drag monitors, so
// auto-scroll never heard a drag start. This walks that gesture and then drops
// on the column the row brought into view.
//
// `dragCardTo` is deliberately not used: it scrolls the target into view before
// moving to it, which is the one thing this test must leave to the drag.
test("board: holding a dragged card at the row's right edge scrolls the day columns sideways", async ({ page }) => {
  const dayCount = 8;
  const tripId = await createMappedTrip(page, e2eTripName("EdgeScroll"), dayCount);
  await page.goto(`/trips/${tripId}?view=Plan`);

  const row = page.getByRole("group", { name: "Day columns" });
  const bar = page.getByTestId("board-columns-scrollbar");
  const lastDay = page.getByTestId("day-column").nth(dayCount - 1);
  const card = page.getByTestId("day-column").nth(0).getByTestId(/activity-card-/);
  await expect(card).toBeVisible();

  // The premise: a row wider than its box, starting at the left, with the last
  // day out of sight. A trip that fit would pass this without testing anything.
  expect(await row.evaluate((box) => box.scrollWidth - box.clientWidth)).toBeGreaterThan(0);
  expect(await row.evaluate((box) => box.scrollLeft)).toBe(0);
  await expect(lastDay).not.toBeInViewport();

  const cardBox = (await card.boundingBox())!;
  const rowBox = (await row.boundingBox())!;

  const sx = cardBox.x + cardBox.width / 2;
  const sy = cardBox.y + cardBox.height / 2;
  const edgeX = rowBox.x + rowBox.width - 60;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  // The same drag-intent nudge `dragCardTo` needs before Chromium fires dragstart.
  await page.mouse.move(sx + 6, sy + 6, { steps: 3 });
  // 60px inside the row's right edge, at the card's own height — clear of the
  // window's top and bottom edges, so only the row has a reason to scroll.
  // **Not closer:** Chromium's own native drag auto-scroll starts a few pixels
  // from a scroller's edge, and at 8px it scrolled the row with the fix
  // reverted, so this test passed without it. 60px is inside pdnd's band
  // (a quarter of the row, capped at 180px) and outside the browser's.
  await page.mouse.move(edgeX, sy, { steps: 10 });

  // Held at the edge. The one-pixel wiggle keeps Chromium issuing `dragover`,
  // which is what pdnd's frame loop reads the pointer from.
  await expect
    .poll(
      async () => {
        await page.mouse.move(edgeX - 1, sy);
        await page.mouse.move(edgeX, sy);
        return row.evaluate((box) => box.scrollLeft);
      },
      { message: "the row scrolls right while a card is held at its right edge" },
    )
    .toBeGreaterThan(0);
  await expect(lastDay).toBeInViewport({ ratio: 1 });

  // The stand-in scrollbar follows a programmatic scroll of the row as well as
  // a hand one: it listens to the row's own scroll events.
  await expect
    .poll(() => bar.evaluate((el) => el.scrollLeft), { message: "the stand-in bar follows the row" })
    .toBeGreaterThan(0);

  const targetBox = (await lastDay.boundingBox())!;
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect(lastDay.getByTestId(/activity-card-/)).toHaveCount(2);
});
