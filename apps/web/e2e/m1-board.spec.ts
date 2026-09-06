import { expect, test } from "@playwright/test";
import { dragCardTo } from "./helpers";
import { e2eTripName } from "./tripNames";

test("board: days, activities, drag, conflicts as data", async ({ page }) => {
  const tripName = e2eTripName("Lisbon");
  await page.goto("/");

  await page.getByRole("button", { name: "New trip" }).click();
  await page.getByLabel("Trip name").fill(tripName);
  await page.getByRole("button", { name: "Create empty" }).click();
  await page.getByRole("link", { name: tripName }).click();
  // level:2 disambiguates TripHeader's h2 from TripCard's own h3 heading —
  // the same class of ambiguity fixed elsewhere post-M10 restyle (see
  // m2/m3/m4/smoke's fix commit); this spec hadn't hit it until now.
  await expect(page.getByRole("heading", { name: tripName, level: 2 })).toBeVisible();

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
  await page.getByLabel("Start").fill("09:00");
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
  await page.getByLabel("Start").fill("10:00");
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
