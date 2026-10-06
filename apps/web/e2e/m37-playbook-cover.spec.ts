import { randomUUID } from "node:crypto";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures/test";
import { forget, publishedDay, stranger } from "./helpers";

// M37 part 5's walk: the author of a published day adds a cover on its page,
// and a stranger then sees it — on the day, with its credit, and leading the
// day's card on its city page. The server runs with
// `EXTERNAL_DATA_OFFLINE=true` (playwright.config.ts), so the cover source is
// the offline fake: three fixed photos served as SVGs from this origin, and no
// request to Unsplash from any test.
//
// The stranger opens the day BEFORE the pick as well as after. This lane runs
// `next start`, where a stranger's read of a published day is cached for a day
// (ADR-063); seeing the cover on their second visit is what proves a pick
// clears that cache, not just that the page can draw one.
//
// A city minted per test, for `m11b-playbooks.spec.ts`'s reason: the library is
// global, and a city page asserted on here must hold this day alone.

const mintCity = () => `Covere2e${randomUUID().replace(/-/g, "").slice(0, 8)}`;

/** The author opens their day, presses Add cover and picks Ada Offline's dunes. */
async function addCover(page: Page, savedDayId: string): Promise<Locator> {
  await page.goto(`/playbooks/day/${savedDayId}`);
  await page.getByRole("button", { name: "Add cover" }).click();
  const dialog = page.getByRole("dialog", { name: "Cover photo" });
  await dialog.getByRole("searchbox", { name: "Search photos" }).fill("dunes");
  await dialog.getByRole("button", { name: "Search" }).click();
  const pick = dialog.getByRole("button", { name: "Use photo by Ada Offline" });
  await Promise.all([
    page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === `/api/saved-days/${savedDayId}/cover` && r.request().method() === "PUT" && r.ok(),
    ),
    pick.click(),
  ]);
  await expect(pick).toHaveAttribute("aria-pressed", "true");
  await dialog.getByRole("button", { name: "Close" }).click();
  return page.getByTestId("day-cover");
}

/** The photo is rendered, not merely present: it loaded under the CSP. */
async function expectLoaded(photo: Locator): Promise<void> {
  await expect(photo).toBeVisible();
  await expect.poll(() => photo.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
}

test("the author adds a cover to a published day; a stranger sees it, credited, on the day and its card", async ({
  page,
  browser,
}) => {
  test.slow();
  const city = mintCity();
  const name = `Cover day ${randomUUID().slice(0, 8)}`;
  const savedDayId = await publishedDay(page, city, name);
  const visitor = await stranger(browser);
  try {
    // Before: the day as it always was, and now in the stranger's cache.
    await visitor.goto(`/playbooks/day/${savedDayId}`);
    await expect(visitor.getByRole("heading", { level: 1, name })).toBeVisible();
    await expect(visitor.getByTestId("day-cover")).toHaveCount(0);
    await expect(visitor.getByRole("button", { name: "Add cover" })).toHaveCount(0);

    const band = await addCover(page, savedDayId);
    await expectLoaded(band.getByRole("img", { name: "Sand dunes under a pale sun" }));
    // The title stands on the photo, and the author can change it from there.
    await expect(band.getByRole("heading", { level: 1, name })).toBeVisible();
    await expect(band.getByRole("button", { name: "Change cover" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Add cover" })).toHaveCount(0);

    // The stranger's next visit: the cover, its credit, and no way to change it.
    await visitor.reload();
    const theirs = visitor.getByTestId("day-cover");
    await expectLoaded(theirs.getByRole("img", { name: "Sand dunes under a pale sun" }));
    await expect(theirs.getByText("Photo by Ada Offline on Unsplash").first()).toBeVisible();
    await expect(theirs.getByRole("link", { name: "Ada Offline" }).first()).toHaveAttribute(
      "href",
      "https://unsplash.com/@ada-offline?utm_source=caesura&utm_medium=referral",
    );
    await expect(theirs.getByRole("button", { name: "Change cover" })).toHaveCount(0);

    // The day's card on its city page leads with the same photo, credited.
    await visitor.goto(`/playbooks/city/${city.toLowerCase()}`);
    const card = visitor.locator(`[data-testid="discover-card"][data-saved-day-id="${savedDayId}"]`);
    await card.scrollIntoViewIfNeeded();
    await expectLoaded(card.getByRole("img", { name: "Sand dunes under a pale sun" }));
    await expect(card.getByText("Photo by Ada Offline on Unsplash")).toBeVisible();
  } finally {
    await visitor.context().close();
    await forget(page, savedDayId);
  }
});

test("a day's cover on a 390px phone: the band fits, its controls are 44px, the credit sits under it", async ({
  page,
}) => {
  test.slow();
  await page.setViewportSize({ width: 390, height: 844 });
  const savedDayId = await publishedDay(page, mintCity(), `Phone cover ${randomUUID().slice(0, 8)}`);
  try {
    const band = await addCover(page, savedDayId);
    await expectLoaded(band.getByRole("img", { name: "Sand dunes under a pale sun" }));

    // Nothing reaches past the screen's right edge.
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    const photoBox = await band.getByRole("img").boundingBox();
    expect(photoBox?.height).toBe(360);
    for (const control of [
      band.getByRole("link", { name: /^Back to / }),
      band.getByRole("button", { name: "Change cover" }),
      band.getByTestId("share-day"),
    ]) {
      const box = await control.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
      expect((box?.x ?? Infinity) + (box?.width ?? 0)).toBeLessThanOrEqual(390);
    }
    // Under the band on a phone, where the right of the title has no room.
    const credit = band.getByText("Photo by Ada Offline on Unsplash").last();
    await expect(credit).toBeVisible();
    expect((await credit.boundingBox())!.y).toBeGreaterThanOrEqual(photoBox!.y + photoBox!.height);
  } finally {
    await forget(page, savedDayId);
  }
});
