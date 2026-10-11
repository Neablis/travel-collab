import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures/test";
import { createMappedTrip } from "./helpers";
import { e2eTripName } from "./tripNames";

// M41 D9, ADR-068 and ADR-069: ⌘K runs the page's own actions, named as
// paths (*Action › Type › Target*), so the whole walk here is done from the
// keyboard: drilling into a path, and typing across its levels. `ControlOrMeta`
// is ⌘ on a Mac and Ctrl elsewhere, the one the palette answers to on each.
// What each command calls is the unit tests' subject (`commands.test.ts`,
// `CommandPalette.test.tsx`, and the identity cases in
// `TripBoardScreen.test.tsx`); this is the keyboard path end to end.

function palette(page: Page) {
  return page.getByRole("dialog", { name: "Go to or do" });
}

async function open(page: Page) {
  await page.keyboard.press("ControlOrMeta+KeyK");
  await expect(palette(page)).toBeVisible();
}

// `waitFor`: an option to see listed before Enter, for one that arrives after
// the palette opens. Your trips are read afresh at each opening and none are
// listed until they land (PR 398 review), so typing a trip's name and pressing
// Enter at once is "No match", which goes nowhere.
async function command(page: Page, text: string, waitFor?: RegExp) {
  await open(page);
  await page.keyboard.type(text);
  if (waitFor !== undefined) await expect(palette(page).getByRole("option", { name: waitFor })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(palette(page)).toBeHidden();
}

// Arrows down to the row named `name` and presses Enter on it: a branch
// drills in, a leaf runs.
async function choose(page: Page, name: string | RegExp) {
  const option = palette(page).getByRole("option", { name, exact: typeof name === "string" });
  await expect(option).toBeVisible();
  for (let step = 0; (await option.getAttribute("aria-selected")) !== "true"; step++) {
    if (step > 20) throw new Error(`never reached the option ${String(name)}`);
    await page.keyboard.press("ArrowDown");
  }
  await page.keyboard.press("Enter");
}

test("a trip walked from the keyboard alone: drilling, typing across levels, a new stop, the assistant", async ({ page }) => {
  const other = await createMappedTrip(page, e2eTripName("PaletteOther"), 1);
  const tripId = await createMappedTrip(page, e2eTripName("Palette"), 2);
  await page.goto(`/trips/${tripId}?view=Plan`);
  await expect(page.getByTestId("day-column")).toHaveCount(2);

  // Drilled: Enter on *Go to* shows it as the chip, and typing under it
  // reaches *View › Calendar*.
  await open(page);
  await choose(page, "Go to");
  await expect(palette(page).getByTestId("palette-path")).toHaveText("Go to ›");
  await page.keyboard.type("cal");
  await page.keyboard.press("Enter");
  await expect(palette(page)).toBeHidden();
  await expect(page).toHaveURL(/view=Calendar/);

  // Typed across levels: Go to › Day › Day 2 is Plan, with that day's own
  // header button focused.
  await command(page, "go day 2");
  await expect(page).toHaveURL(/view=Plan/);
  await expect(page.getByTestId("day-column").nth(1).getByRole("button", { name: /^Day 2/ })).toBeFocused();
  await expect(page.getByTestId("day-column").nth(1).getByRole("button", { name: /^Day 2/ })).toHaveAttribute("aria-pressed", "true");

  // Add › Stop on the selected day: the editor opens on Day 2.
  await command(page, "add stop");
  const sheet = page.getByRole("dialog", { name: "Add a stop" });
  await expect(sheet.getByLabel("What or where")).toBeFocused();
  await page.keyboard.type("Tea house");
  await page.keyboard.press("Enter");
  await expect(sheet).toBeHidden();
  await expect(page.getByTestId("day-column").nth(1)).toContainText("Tea house");

  await command(page, "ask");
  await expect(page.getByRole("complementary", { name: "Assistant" })).toBeVisible();

  await command(page, "go paletteother", /PaletteOther/);
  await expect(page).toHaveURL(new RegExp(`/trips/${other}`));
});

test("Add › Trip from Home is Home's own button", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Your trips" })).toBeVisible();
  await command(page, "add trip");
  await expect(page.getByRole("dialog", { name: "New trip" })).toBeVisible();
});

// PR 395 review: a day's stops moved only by a drag. ADR-069 §4 makes it
// *Move › Day › <day> › <day>*, the drag's own `moveDay`: one batch, so one
// History entry. It replaced the Calendar city cards' commands.
test("Move › Day › Day 1 › Day 2, drilled from the keyboard, is one change", async ({ page }) => {
  const tripId = await createMappedTrip(page, e2eTripName("PaletteMove"), 3, { startDate: "2027-06-07" });
  // A second stop on Day 1, so the move is two commands and only a batch
  // makes it one History entry: one stop moves as one command either way.
  const { trip } = (await (await page.request.get(`/api/trips/${tripId}`)).json()) as { trip: { days: { dayId: string }[] } };
  const added = await page.request.post(`/api/trips/${tripId}/commands`, {
    data: { type: "AddActivity", tripId, activityId: crypto.randomUUID(), title: "Late swim", dayId: trip.days[0]!.dayId, timeWindow: { start: "18:00", end: "19:00" } },
  });
  expect(added.ok()).toBe(true);
  await page.goto(`/trips/${tripId}?view=Plan`);
  const column = (index: number) => page.getByTestId("day-column").nth(index);
  await expect(column(0).locator("[data-river-block]")).toHaveCount(2);
  const history = async () =>
    ((await (await page.request.get(`/api/trips/${tripId}/history`)).json()) as { history: { entries: { description: string }[] } }).history.entries;
  const before = (await history()).length;

  await open(page);
  await choose(page, "Move");
  await choose(page, "Day");
  await expect(palette(page).getByTestId("palette-path")).toHaveText("Move › Day ›");
  await choose(page, /^Day 1\b/);
  await choose(page, /^Day 2\b/);
  await expect(palette(page)).toBeHidden();

  await expect(column(0).locator("[data-river-block]")).toHaveCount(0);
  await expect(column(1).locator("[data-river-block]")).toHaveCount(3);
  await expect.poll(async () => (await history()).length).toBe(before + 1);
  expect((await history())[0]?.description).toMatch(/Moved/);
});
