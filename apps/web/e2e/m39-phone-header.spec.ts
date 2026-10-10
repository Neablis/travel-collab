import { expect, test } from "./fixtures/test";
import { createMappedTrip } from "./helpers";
import { e2eTripName } from "./tripNames";

// **M39 D6 — the phone's pinned header is one row, with the day rail under it**
// (KI-2026-09-24-i). Measured 2026-09-24 at 390×844: the pinned header took
// ~305px, the day rail scrolled away while Add stop and History stayed put, and
// the first stop card started at y≈691 — the bottom of the first screen.
//
// A measurement because the entry is one, and because jsdom has no layout:
// "pinned" and "near the top" are only true or false in a browser. Runs in the
// `phone` project, at Mitchell's 411×852.
test.describe("M39 D6 — the phone trip header", () => {
  // 6 am to 10 pm: a river 16 hours tall (704px), so the page is more than a
  // screen tall and a scroll of one screen really moves it.
  async function tallPlan(page: import("@playwright/test").Page, label: string) {
    const tripId = await createMappedTrip(page, e2eTripName(label), 2, {
      activitiesPerDay: 3,
      timeWindows: [
        { start: "06:00", end: "07:00" },
        { start: "13:00", end: "14:00" },
        { start: "21:00", end: "22:00" },
      ],
    });
    await page.goto(`/trips/${tripId}?view=Plan`);
    await page.getByTestId(/^activity-card-/).first().waitFor();
    return tripId;
  }

  const header = (page: import("@playwright/test").Page) => page.locator('header[aria-label="Trip"]');

  test("pins the title row and the day rail, and starts the day near the top", async ({ page }) => {
    await tallPlan(page, "PhoneHeader");

    // Before scrolling: the first stop is in the top third of the screen, not
    // at its foot. Measured 305 on the production build (AppHeader 56, the
    // row 50, the rail 84, the scrolling date line, then the day's own
    // header), against ~691 before. The plan said "≈300"; 320 holds the order
    // of magnitude without pinning a pixel a padding token would move. The
    // old header measures 691 here and fails it.
    const firstStop = (await page.getByTestId(/^activity-card-/).first().boundingBox())!;
    expect(firstStop.y).toBeLessThan(320);

    const title = header(page).getByRole("heading", { level: 1 });
    const days = page.getByRole("group", { name: "Days" });
    await page.evaluate(() => window.scrollBy(0, window.innerHeight));
    // The page really moved, or the two assertions below prove nothing.
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(200);
    await expect(title).toBeInViewport();
    await expect(days).toBeInViewport();

    // And they are pinned under AppHeader, not merely still on screen: the
    // rail is inside the header box whose height the board's offsets read.
    const stack = await page.evaluate(() =>
      parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--sticky-stack-height")),
    );
    const daysBox = (await days.boundingBox())!;
    expect(daysBox.y + daysBox.height).toBeLessThanOrEqual(stack + 1);
  });

  test("holds Add stop, History and Trip settings in the row's menu", async ({ page }) => {
    await tallPlan(page, "PhoneMenu");

    await header(page).getByRole("button", { name: "Trip actions" }).click();
    const menu = page.getByRole("menu");
    await expect(menu.getByRole("menuitem")).toHaveText(["Add stop", "History", "Trip settings"]);

    // History opens hung from the menu, on screen, with undo and redo in it.
    await menu.getByRole("menuitem", { name: "History" }).click();
    const undo = page.getByRole("button", { name: "Undo" });
    await expect(undo).toBeInViewport();
    await expect(page.getByRole("button", { name: "Redo" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(undo).toBeHidden();

    await header(page).getByRole("button", { name: "Trip actions" }).click();
    await page.getByRole("menuitem", { name: "Add stop" }).click();
    await expect(page.getByRole("heading", { name: "Add a stop" })).toBeVisible();
  });

  test("makes Unscheduled a row after the day, covering nothing", async ({ page }) => {
    await tallPlan(page, "PhoneRackRow");

    const rack = page.getByTestId("unscheduled-rack");
    const river = page.getByTestId("day-river");
    // In the page's flow, below the day's last stop, and so not a fixed bar
    // over the list: nothing is reserved for it at the foot of the screen.
    expect(await rack.evaluate((el) => getComputedStyle(el).position)).not.toBe("fixed");
    const riverBox = (await river.boundingBox())!;
    const rackBox = (await rack.boundingBox())!;
    expect(rackBox.y).toBeGreaterThanOrEqual(riverBox.y + riverBox.height);
    expect(
      await page.getByTestId("trip-board-content").evaluate((el) => getComputedStyle(el).getPropertyValue("--rack-height").trim()),
    ).toBe("0px");

    // Collapsed to its count, and it opens where it is.
    const toggle = rack.getByRole("button", { name: /^Unscheduled 0\b/ });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(rack.getByText(/Nothing parked/)).toBeVisible();
  });
});
