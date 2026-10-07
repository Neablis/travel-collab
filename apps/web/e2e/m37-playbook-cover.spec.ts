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
// The stranger opens the day and its city page BEFORE the pick as well as
// after. This lane runs `next start`, where a stranger's read of a published
// day and of every list showing its card is cached for a day (ADR-063);
// seeing the cover on their second visit to each is what proves a pick clears
// both the day's tag and the library's, not just that the page can draw one.
//
// A city minted per test, for `m11b-playbooks.spec.ts`'s reason: the library is
// global, and a city page asserted on here must hold this day alone.

/** A city name nothing else in the library has. */
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
    await visitor.goto(`/playbooks/city/${city.toLowerCase()}`);
    const card = visitor.locator(`[data-testid="discover-card"][data-saved-day-id="${savedDayId}"]`);
    await expect(card).toBeVisible();
    await expect(card.getByRole("img", { name: "Sand dunes under a pale sun" })).toHaveCount(0);

    const band = await addCover(page, savedDayId);
    await expectLoaded(band.getByRole("img", { name: "Sand dunes under a pale sun" }));
    // The title stands on the photo, and the author can change it from there.
    await expect(band.getByRole("heading", { level: 1, name })).toBeVisible();
    await expect(band.getByRole("button", { name: "Change cover" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Add cover" })).toHaveCount(0);

    // The stranger's next visit: the cover, its credit, and no way to change it.
    await visitor.goto(`/playbooks/day/${savedDayId}`);
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
  const city = mintCity();
  const savedDayId = await publishedDay(page, city, `Phone cover ${randomUUID().slice(0, 8)}`);
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
      // The way to the day's city, over the photo (PR #354's preview walk measured it 15px).
      band.getByRole("link", { name: city, exact: true }),
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

test("a multi-city card's chips on a 390px phone: every one a 44px target, all of them on the photo", async ({
  page,
}) => {
  test.slow();
  await page.setViewportSize({ width: 390, height: 844 });
  // Four cities, three with 36-character names (a nod to Llanfair PG): the
  // card draws three chips and "+1 more", each long chip takes a line of its
  // own at phone width, and "+1 more" a fourth. The chip row stands on the
  // foot of a photo that clips, and a phone's chips are 44px links spaced to
  // keep their hit areas apart, so four rows need 176px of a 150px photo —
  // the first chip used to be cut off 34px above it (PR #354 review).
  const city = mintCity();
  const savedDayId = await publishedDay(page, city, `Many cities ${randomUUID().slice(0, 8)}`, [
    `${mintCity()}Gwyngyllgogerychwyrn`,
    `${mintCity()}Gwyngyllgogerychwyrn`,
    `${mintCity()}Gwyngyllgogerychwyrn`,
  ]);
  try {
    await addCover(page, savedDayId);
    await page.goto(`/playbooks/city/${city.toLowerCase()}`);
    const card = page.locator(`[data-testid="discover-card"][data-saved-day-id="${savedDayId}"]`);
    const photo = card.getByRole("img", { name: "Sand dunes under a pale sun" });
    await expectLoaded(photo);
    const frame = (await photo.boundingBox())!;

    const chips = card.getByTestId("city-chips");
    const links = chips.getByRole("link");
    await expect(links).toHaveCount(3);
    await expect(chips.getByTestId("city-chips-more")).toHaveText("+1 more");
    // The links are the hit areas; the "+N more" chip is drawn on the same
    // row and must be on the photo as well.
    const onPhoto = (box: { x: number; y: number; width: number; height: number }) => {
      expect(box.y).toBeGreaterThanOrEqual(frame.y);
      expect(box.y + box.height).toBeLessThanOrEqual(frame.y + frame.height);
      expect(box.x).toBeGreaterThanOrEqual(frame.x);
      expect(box.x + box.width).toBeLessThanOrEqual(frame.x + frame.width);
    };
    for (const link of await links.all()) {
      const box = (await link.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      onPhoto(box);
    }
    onPhoto((await chips.getByTestId("city-chips-more").boundingBox())!);
  } finally {
    await forget(page, savedDayId);
  }
});
