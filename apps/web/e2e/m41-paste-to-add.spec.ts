import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures/test";
import { createMappedTrip } from "./helpers";
import { e2eTripName } from "./tripNames";

// M41 D8: a paste or a drop onto a day opens the editor on that day,
// prefilled. The parser is `pasteToStop.test.ts` and the day it picks is
// `board.test.tsx`; these need a real browser for the two things jsdom cannot
// do: `:hover` under a real pointer, and pragmatic-drag-and-drop's external
// adapter taking a drop from outside the page. Both events are dispatched
// with the browser's own `DataTransfer`, because Playwright cannot drive the
// OS clipboard or a drag from another app.

const column = (page: Page, i: number) => page.getByTestId("day-column").nth(i);

// The column's day, failing here rather than comparing against "" when the
// attribute is missing (an empty Day select would match that).
async function dayIdOf(page: Page, i: number): Promise<string> {
  const dayId = await column(page, i).getAttribute("data-day-id");
  if (dayId === null || dayId === "") throw new Error(`day column ${i} carries no data-day-id`);
  return dayId;
}

test("a line of text pasted with the pointer over a day opens the editor there, and saves a stop on it", async ({ page }) => {
  const tripId = await createMappedTrip(page, e2eTripName("Paste"), 3);
  await page.goto(`/trips/${tripId}?view=Plan`);
  await expect(column(page, 1).getByTestId(/^activity-card-/)).toHaveCount(1);

  await column(page, 1).locator("[data-day-header]").hover();
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData("text/plain", "Ramen at Ichiran\nCash only");
    document.body.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true }));
  });

  const sheet = page.getByRole("dialog");
  await expect(sheet.getByLabel("What or where")).toHaveValue("Ramen at Ichiran");
  await expect(sheet.getByLabel("Notes")).toHaveValue("Cash only");
  await expect(sheet.getByLabel("Day")).toHaveValue(await dayIdOf(page, 1));
  await sheet.getByRole("button", { name: "Add stop" }).last().click();

  await expect(column(page, 1).getByText("Ramen at Ichiran")).toBeVisible();
});

test("a Maps link dropped on a day from outside the app opens the editor on that day with the place", async ({ page }) => {
  const tripId = await createMappedTrip(page, e2eTripName("DropLink"), 2);
  await page.goto(`/trips/${tripId}?view=Plan`);
  const target = column(page, 1);
  await expect(target.getByTestId(/^activity-card-/)).toHaveCount(1);

  const link = "https://www.google.com/maps/place/Kinkaku-ji/@35.0394,135.7292,15z";
  await target.evaluate((el, url) => {
    const box = el.getBoundingClientRect();
    const at = { clientX: box.left + box.width / 2, clientY: box.top + 40, bubbles: true, cancelable: true };
    const data = new DataTransfer();
    data.setData("text/uri-list", url);
    data.setData("text/plain", url);
    for (const type of ["dragenter", "dragover", "drop"]) el.dispatchEvent(new DragEvent(type, { ...at, dataTransfer: data }));
  }, link);

  const sheet = page.getByRole("dialog");
  await expect(sheet.getByLabel("What or where")).toHaveValue("Kinkaku-ji");
  await expect(sheet.getByLabel("Day")).toHaveValue(await dayIdOf(page, 1));
  await sheet.getByRole("button", { name: "Add stop" }).last().click();

  await expect(target.getByRole("button", { name: /^Edit Kinkaku-ji,/ })).toBeVisible();
});
