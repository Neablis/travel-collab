import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures/test";
import { pickNewTripPlace, signInAsDevUser } from "./helpers";
import { e2eTripName } from "./tripNames";

// M56 part 2: New trip is five pages and a Review, every answer a pick, and
// what was picked is what the trip holds. A new account is on the week's
// `plus` trial, so Review offers *Plan with AI*; the free half is the
// component test's (`NewTripWizard.test.tsx`).
test.use({ storageState: { cookies: [], origins: [] } });

// Mitchell, 2026-10-30: a trip made from New trip opens on Plan, where it is
// planned, not on the read-only Overview a bare `/trips/<id>` lands on.
function planTab(page: Page) {
  return page.getByRole("tablist", { name: "Trip view" }).getByRole("tab", { name: "Plan" });
}

test("five pages and Review make a trip holding every answer, and a new place re-walks them", async ({ page }) => {
  await signInAsDevUser(page, `m56${randomUUID().replace(/-/g, "").slice(0, 10)}`);
  // A first run: the pages are on Home itself.
  const card = page.getByTestId("first-trip-start");
  const next = card.getByRole("button", { name: "Next" });

  const first = e2eTripName("M56First");
  await pickNewTripPlace(card, first);
  await next.click();

  await expect(card.getByText("Step 2 of 5")).toBeVisible();
  await card.getByRole("radio", { name: "Yes, pick a day" }).click();
  await card.getByLabel("Yes, pick a day", { exact: true }).and(card.locator("input")).fill("2027-04-10");
  await next.click();

  await card.getByRole("radio", { name: "A week" }).click();
  await next.click();
  await card.getByRole("radio", { name: "Packed" }).click();
  await next.click();
  await card.getByRole("checkbox", { name: "Food" }).click();
  await card.getByRole("checkbox", { name: "Museum" }).click();
  await card.getByRole("button", { name: "Review" }).click();

  const decided = card.getByTestId("new-trip-decided");
  await expect(decided).toHaveText(`${first} · Apr 10, 2027 · A week · Packed · Food, Museum`);

  // Changing Where re-walks the later pages, each still holding its answer.
  const second = e2eTripName("M56Second");
  await card.getByRole("button", { name: "Change where" }).click();
  await pickNewTripPlace(card, second);
  await next.click();
  await expect(card.getByText("Destination changed")).toBeVisible();
  await expect(card.getByRole("radio", { name: "Yes, pick a day" })).toHaveAttribute("aria-checked", "true");
  await next.click();
  await expect(card.getByRole("radio", { name: "A week" })).toHaveAttribute("aria-checked", "true");
  await next.click();
  await expect(card.getByRole("radio", { name: "Packed" })).toHaveAttribute("aria-checked", "true");
  await next.click();
  await card.getByRole("button", { name: "Review" }).click();
  await expect(decided).toHaveText(`${second} · Apr 10, 2027 · A week · Packed · Food, Museum`);

  // *Plan with AI* makes the trip and goes to its Plan (the rail is part 6's).
  await card.getByRole("button", { name: "Plan with AI" }).click();
  await expect(page).toHaveURL(/\/trips\/[0-9a-f-]{36}/);
  await expect(planTab(page)).toHaveAttribute("aria-selected", "true");
  const tripId = new URL(page.url()).pathname.split("/")[2]!;
  const read = await page.request.get(`/api/trips/${tripId}`);
  expect(read.ok()).toBe(true);
  const { trip } = (await read.json()) as {
    trip: { name: string; startDate: string | null; days: unknown[]; pace: string | null; tags: string[] };
  };
  expect({ name: trip.name, startDate: trip.startDate, days: trip.days.length, pace: trip.pace, tags: trip.tags }).toEqual({
    name: second,
    startDate: "2027-04-10",
    days: 7,
    pace: "packed",
    tags: ["meal", "museum"],
  });
});

// Mitchell on his iPhone, 2026-10-30: in the New trip sheet the last row of
// step 5's tag tiles sat under the footer until the body was scrolled. The
// small phone is the case: 375x667 is the shortest a supported iPhone gets,
// and `hasTouch` makes Chromium answer `(pointer: coarse)` as the phone does.
test.describe("New trip on a small phone", () => {
  test.use({ viewport: { width: 375, height: 667 }, hasTouch: true });

  test("shows every tag tile on step 5 without scrolling the sheet's body", async ({ page }) => {
    await signInAsDevUser(page, `m56s${randomUUID().replace(/-/g, "").slice(0, 10)}`);
    // A trip first: the sheet is for an account that has one; first run is Home's card.
    const made = await page.request.post("/api/trips", { data: { name: e2eTripName("M56Phone") } });
    expect(made.ok()).toBe(true);
    await page.goto("/home");
    await page.getByRole("button", { name: "New trip" }).click();
    const sheet = page.getByRole("dialog", { name: "New trip" });
    const next = sheet.getByRole("button", { name: "Next" });

    await pickNewTripPlace(sheet, e2eTripName("M56PhoneWhere"));
    await next.click();
    await sheet.getByRole("radio", { name: "Not yet" }).click();
    await next.click();
    await sheet.getByRole("radio", { name: "A week" }).click();
    await next.click();
    await sheet.getByRole("radio", { name: "Packed" }).click();
    await next.click();
    await expect(sheet.getByText("Step 5 of 5")).toBeVisible();

    const body = sheet.getByTestId("new-trip-page");
    const tiles = sheet.getByRole("checkbox");
    await expect(tiles).toHaveCount(12);
    const bodyBox = (await body.boundingBox())!;
    const lastBox = (await tiles.last().boundingBox())!;
    expect(lastBox.y + lastBox.height, "the last tile's foot against the body's").toBeLessThanOrEqual(bodyBox.y + bodyBox.height);
    expect(await body.evaluate((el) => el.scrollHeight - el.clientHeight), "the body's overflow").toBeLessThanOrEqual(0);
    // Smaller, but still a finger's target both ways.
    expect(Math.min(lastBox.width, lastBox.height)).toBeGreaterThanOrEqual(44);
  });
});
