import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures/test";
import { createEmptyTripViaWizard, homeTrip } from "./helpers";
import { e2eTripName } from "./tripNames";

// M49 decision 10: an editor repositions the cover on the trip's band, by
// mouse and by keyboard, and the framing holds across a reload and on Home.
// The cover comes from the offline source (`EXTERNAL_DATA_OFFLINE=true`,
// playwright.config.ts), as in `m37-trip-covers.spec.ts`.

const PHOTO = "Sand dunes under a pale sun";

/** Creates an empty trip, gives it a cover from Trip settings, and leaves the trip page showing the band. */
async function tripWithCover(page: Page, tripName: string): Promise<void> {
  await page.goto("/home");
  await createEmptyTripViaWizard(page, tripName);
  await homeTrip(page, tripName).getByRole("link", { name: "Choose a cover photo" }).click();
  const section = page.getByRole("dialog", { name: "Trip settings" }).getByRole("region", { name: "Cover photo" });
  await section.getByRole("searchbox", { name: "Search photos" }).fill("dunes");
  await section.getByRole("button", { name: "Search" }).click();
  await Promise.all([
    page.waitForResponse((r) => /\/api\/trips\/[^/]+\/cover$/.test(new URL(r.url()).pathname) && r.request().method() === "PUT" && r.ok()),
    section.getByRole("button", { name: "Use photo by Ada Offline" }).click(),
  ]);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Trip settings" })).toBeHidden();
}

/** The `object-position` percentage a cover photo is drawn at. */
async function framing(photo: Locator): Promise<number> {
  const position = await photo.evaluate((img) => getComputedStyle(img).objectPosition);
  // "50% 37%": the second value is the vertical one.
  return Number(position.split(" ")[1]?.replace("%", ""));
}

/** The band's photo: the first on the page, above the header. */
const bandPhoto = (page: Page) => page.getByRole("img", { name: PHOTO }).first();

/** Hovers the band and enters reposition mode. */
async function startRepositioning(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: "Change cover photo" }).hover();
  await page.getByRole("button", { name: "Reposition", exact: true }).click();
  await expect(page.getByText("Drag image to reposition")).toBeVisible();
  return page.getByRole("slider", { name: "Cover position" });
}

test("an editor drags the cover down on the band, saves, and it holds after a reload and on Home", async ({ page }) => {
  const tripName = e2eTripName("Cover framing");
  await tripWithCover(page, tripName);
  await expect.poll(() => framing(bandPhoto(page))).toBe(50);

  // A mouse drag down: the photo follows it, showing more of its top.
  const slider = await startRepositioning(page);
  const box = (await slider.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 40);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + 140, { steps: 5 });
  await page.mouse.up();
  await expect.poll(() => framing(bandPhoto(page))).toBeLessThan(50);
  const dragged = await framing(bandPhoto(page));

  // The mode closes once the save has answered, so the reload reads it back.
  await page.getByRole("button", { name: "Save position" }).click();
  await expect(slider).toBeHidden();

  await page.reload();
  await expect(bandPhoto(page)).toBeVisible();
  await expect.poll(() => framing(bandPhoto(page))).toBe(dragged);

  // Home's card or hero frames it the same way.
  await page.goto("/home");
  const onHome = homeTrip(page, tripName).getByRole("img", { name: PHOTO });
  await expect(onHome).toBeAttached();
  await expect.poll(() => framing(onHome)).toBe(dragged);
});

test("an editor moves the cover by keyboard, saves with Enter and it holds; Esc puts a move back", async ({ page }) => {
  await tripWithCover(page, e2eTripName("Cover keys"));

  // Shift+↑ is 10% and ↑ 1%: the photo moves up, showing more of its foot.
  const slider = await startRepositioning(page);
  await expect(slider).toBeFocused();
  await page.keyboard.press("Shift+ArrowUp");
  await page.keyboard.press("ArrowUp");
  await expect.poll(() => framing(bandPhoto(page))).toBe(61);
  await page.keyboard.press("Enter");
  await expect(slider).toBeHidden();

  await page.reload();
  await expect(bandPhoto(page)).toBeVisible();
  await expect.poll(() => framing(bandPhoto(page))).toBe(61);

  // And Esc puts it back, sending nothing.
  const patches: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "PATCH") patches.push(request.url());
  });
  await startRepositioning(page);
  await page.keyboard.press("ArrowDown");
  await expect.poll(() => framing(bandPhoto(page))).toBe(60);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("slider", { name: "Cover position" })).toBeHidden();
  await expect.poll(() => framing(bandPhoto(page))).toBe(61);
  expect(patches).toEqual([]);
});
