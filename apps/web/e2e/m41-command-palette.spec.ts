import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures/test";
import { createMappedTrip } from "./helpers";
import { e2eTripName } from "./tripNames";

// M41 D9 and ADR-068: ⌘K runs the page's own actions, so the whole walk here
// is done from the keyboard. `ControlOrMeta` is ⌘ on a Mac and Ctrl elsewhere,
// and the palette answers to both. What each command calls is the unit tests'
// subject (`CommandPalette.test.tsx`, `commands.test.ts`, and the identity
// cases in `TripBoardScreen.test.tsx`); this is the keyboard path end to end.

async function command(page: Page, text: string) {
  await page.keyboard.press("ControlOrMeta+KeyK");
  const palette = page.getByRole("dialog", { name: "Go to or do" });
  await expect(palette).toBeVisible();
  await page.keyboard.type(text);
  await page.keyboard.press("Enter");
  await expect(palette).toBeHidden();
}

test("a trip walked from the keyboard alone: a lens, a new stop, the assistant, another trip", async ({ page }) => {
  const other = await createMappedTrip(page, e2eTripName("PaletteOther"), 1);
  const tripId = await createMappedTrip(page, e2eTripName("Palette"), 2);
  await page.goto(`/trips/${tripId}?view=Plan`);
  await expect(page.getByTestId("day-column")).toHaveCount(2);

  await command(page, "cal");
  await expect(page).toHaveURL(/view=Calendar/);

  // No day selected, so the stop is parked: the Calendar's drawer, collapsed,
  // counts it.
  await command(page, "new stop");
  const sheet = page.getByRole("dialog", { name: "Add a stop" });
  await expect(sheet.getByLabel("What or where")).toBeFocused();
  await page.keyboard.type("Tea house");
  await page.keyboard.press("Enter");
  await expect(sheet).toBeHidden();
  await expect(page.getByRole("button", { name: /^Unscheduled 1 / })).toBeVisible();

  await command(page, "ask");
  await expect(page.getByRole("complementary", { name: "Assistant" })).toBeVisible();

  await command(page, "PaletteOther");
  await expect(page).toHaveURL(new RegExp(`/trips/${other}`));
});

test("New trip from Home is Home's own button", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Your trips" })).toBeVisible();
  await command(page, "new trip");
  await expect(page.getByRole("dialog", { name: "New trip" })).toBeVisible();
});

// PR 395 review: a city card's stops moved only by a drag. From the keyboard,
// Tab to the day's cell and ⌘K offers *Move <City> to Day N*, which is the
// drag's own drop: one batch, so one History entry.
test("a Calendar city card moves to another day from the keyboard, as one change", async ({ page }) => {
  const tripId = await createMappedTrip(page, e2eTripName("PaletteMove"), 3, { startDate: "2027-06-07" });
  await page.goto(`/trips/${tripId}?view=Calendar`);
  const cell = (dayIndex: number) => page.locator(`[data-testid="calendar-cell"][data-day-index="${dayIndex}"]`);
  await expect(cell(0).getByTestId("calendar-day-card")).toHaveCount(1);
  const history = async () =>
    ((await (await page.request.get(`/api/trips/${tripId}/history`)).json()) as { history: { entries: { description: string }[] } }).history.entries;
  const before = (await history()).length;

  // Tab, not `.focus()`: the cell is reached the way a keyboard user reaches it.
  // One Tab per try, until the cell has focus.
  await expect(async () => {
    await page.keyboard.press("Tab");
    await expect(cell(0)).toBeFocused({ timeout: 100 });
  }).toPass({ intervals: [0], timeout: 30_000 });

  await command(page, "to day 2");
  await expect(cell(0)).toContainText("Nothing planned yet");
  await expect(cell(1).getByTestId("calendar-day-card")).toHaveCount(2);
  await expect.poll(async () => (await history()).length).toBe(before + 1);
  expect((await history())[0]?.description).toMatch(/Moved/);
});
