import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures/test";
import { createMappedTrip, dragCardTo, openNewParkedStop } from "./helpers";
import { e2eTripName } from "./tripNames";

// M41 D2: the Calendar rearranges by city block. A card dragged onto another
// day moves the stops on it there, as one History entry; dropped on a date
// after the trip's end, the trip grows to that date in the same entry; and the
// Unscheduled drawer comes to Calendar, so a parked stop drops onto a day.
//
// Monday 7 June 2027 for three days (Mon–Wed), so the week row has Thursday to
// Saturday after the end to drop on. `mappedTrip` gives each day one stop,
// 9–10 am, in "City N".

async function historyEntries(page: Page, tripId: string): Promise<{ description: string }[]> {
  const { history } = (await (await page.request.get(`/api/trips/${tripId}/history`)).json()) as {
    history: { entries: { description: string }[] };
  };
  return history.entries;
}
const historyLength = async (page: Page, tripId: string) => (await historyEntries(page, tripId)).length;

const cell = (page: Page, dayIndex: number) => page.locator(`[data-testid="calendar-cell"][data-day-index="${dayIndex}"]`);

test("a city card dragged to another day moves its stops as one change, and past the end grows the trip", async ({ page }) => {
  const tripId = await createMappedTrip(page, e2eTripName("CalDrag"), 3, { startDate: "2027-06-07" });
  await page.goto(`/trips/${tripId}?view=Calendar`);
  await expect(cell(page, 0).getByTestId("calendar-day-card")).toHaveCount(1);
  const before = await historyLength(page, tripId);

  // Day 1's City 1 onto Day 2: Day 1 is left empty, and Day 2 holds both.
  await dragCardTo(cell(page, 0).getByTestId("calendar-day-card"), cell(page, 1));
  await expect(cell(page, 0)).toContainText("Nothing planned yet");
  await expect(cell(page, 1).getByTestId("calendar-day-card")).toHaveCount(2);
  await expect.poll(() => historyLength(page, tripId)).toBe(before + 1);

  // Day 3's City 3 onto Saturday, three days after Wednesday's end: the trip
  // grows to six days, and the stop is on the last of them.
  await dragCardTo(cell(page, 2).getByTestId("calendar-day-card"), page.locator('[data-drop-after="2027-06-12"]'));
  await expect(cell(page, 5).getByTestId("calendar-day-card")).toContainText("City 3");
  await expect(cell(page, 2)).toContainText("Nothing planned yet");
  // ONE entry for the days and the move together, so one undo takes both: a
  // count alone would pass on the way through four separate entries.
  await expect.poll(async () => (await historyEntries(page, tripId))[0]?.description).toMatch(/Added Day 4.*Added Day 6.*Moved/);
  expect(await historyLength(page, tripId)).toBe(before + 2);
});

test("a parked stop in the Calendar's drawer drops onto a day", async ({ page }) => {
  const tripId = await createMappedTrip(page, e2eTripName("CalRack"), 2, { startDate: "2027-06-07" });
  await page.goto(`/trips/${tripId}?view=Calendar`);

  await openNewParkedStop(page);
  await page.getByLabel("What or where").fill("Tea house");
  await page.getByRole("button", { name: "Add stop" }).last().click();
  const parked = page.getByTestId("rack-card").filter({ hasText: "Tea house" });
  await expect(parked).toBeVisible();

  await dragCardTo(parked, cell(page, 1));
  await expect(parked).toHaveCount(0);
  // Its own card: a stop with no city is the day's untitled bucket.
  await expect(cell(page, 1).getByTestId("calendar-day-card")).toHaveCount(2);
});
