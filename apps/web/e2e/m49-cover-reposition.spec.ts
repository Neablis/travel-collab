import { randomUUID } from "node:crypto";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures/test";
import { createEmptyTripViaWizard, homeTrip, signInAsDevUser } from "./helpers";
import { e2eTripName } from "./tripNames";

// M49 decision 10: an editor repositions the cover on the trip's band, chosen
// from the cover's own menu by mouse and by keyboard, and the framing holds
// across a reload and on Home.
// The cover comes from the offline source (`EXTERNAL_DATA_OFFLINE=true`,
// playwright.config.ts), as in `m37-trip-covers.spec.ts`.

const PHOTO = "Sand dunes under a pale sun";
/** The dunes photo's height over its width: `public/offline-covers/dunes.svg` is 1080×720. */
const PHOTO_ASPECT = 720 / 1080;

/**
 * A dev username nobody has used before, as `responsive.spec.ts`'s own: on an
 * account of its own a trip's place on Home, hero or card, is this spec's to
 * decide, where the shared account's other trips would race it.
 */
function freshUsername(): string {
  return `e2e${randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

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

/**
 * Where the photo's top edge is drawn, in pixels from its box's top: scaled to
 * cover the box, the hidden part above it is the position's share of all it
 * hides.
 */
async function drawnTop(photo: Locator): Promise<number> {
  const { width, height } = (await photo.boundingBox())!;
  const hidden = Math.max(width * PHOTO_ASPECT, height) - height;
  return -(hidden * (await framing(photo))) / 100;
}

/** The band's photo: the first on the page, above the header. */
const bandPhoto = (page: Page) => page.getByRole("img", { name: PHOTO }).first();

/** The cover on the band: no buttons on it, only itself (decision 10, amended 2026-10-25). */
const editCover = (page: Page) => page.getByRole("button", { name: "Edit cover" });

/**
 * Opens the cover's menu and chooses Reposition from it: by mouse, a click on
 * the cover; by keyboard, `Enter` on the focused cover, then `↓` to the item.
 */
async function startRepositioning(page: Page, by: "mouse" | "keyboard"): Promise<Locator> {
  if (by === "mouse") {
    await editCover(page).hover();
    await editCover(page).click();
    await page.getByRole("menuitem", { name: "Reposition" }).click();
  } else {
    await editCover(page).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("menuitem", { name: "Change cover" })).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("menuitem", { name: "Reposition" })).toBeFocused();
    await page.keyboard.press("Enter");
  }
  await expect(page.getByText("Drag image to reposition")).toBeVisible();
  return page.getByRole("slider", { name: "Cover position" });
}

test.describe("on an account of its own", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("an editor drags the cover down on the band, saves, and it holds after a reload and on Home", async ({ page }) => {
    await signInAsDevUser(page, freshUsername());
    const tripName = e2eTripName("Cover framing");
    await tripWithCover(page, tripName);
    await expect.poll(() => framing(bandPhoto(page))).toBe(50);
    const before = await drawnTop(bandPhoto(page));

    // A 100px mouse drag down: the photo keeps pace with it, its top edge drawn
    // 100px lower, within the 1% a position is rounded to.
    const slider = await startRepositioning(page, "mouse");
    const box = (await slider.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + 40);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + 140, { steps: 5 });
    await page.mouse.up();
    const { width, height } = (await bandPhoto(page).boundingBox())!;
    const onePercent = (width * PHOTO_ASPECT - height) / 100;
    await expect
      .poll(async () => Math.abs((await drawnTop(bandPhoto(page))) - before - 100))
      .toBeLessThanOrEqual(onePercent / 2);
    const dragged = await framing(bandPhoto(page));

    // The mode closes once the save has answered, so the reload reads it back.
    await page.getByRole("button", { name: "Save position" }).click();
    await expect(slider).toBeHidden();
    await expect(editCover(page)).toBeFocused();

    await page.reload();
    await expect(bandPhoto(page)).toBeVisible();
    await expect.poll(() => framing(bandPhoto(page))).toBe(dragged);

    // Home's hero frames it the same way: on this account it is the only trip.
    await page.goto("/home");
    const hero = page.getByTestId("next-trip-hero").filter({ hasText: tripName }).getByRole("img", { name: PHOTO });
    await expect(hero).toBeAttached();
    await expect.poll(() => framing(hero)).toBe(dragged);

    // And so does its card, once a newer trip takes the hero.
    await page.request.post("/api/trips", { data: { name: e2eTripName("Cover framing, newer") } });
    await page.reload();
    const card = page.getByTestId("trip-card").filter({ hasText: tripName }).getByRole("img", { name: PHOTO });
    await expect(card).toBeAttached();
    await expect.poll(() => framing(card)).toBe(dragged);
  });
});

test("an editor moves the cover by keyboard, saves with Enter and it holds; Esc puts a move back", async ({ page }) => {
  await tripWithCover(page, e2eTripName("Cover keys"));

  // Shift+↑ is 10% and ↑ 1%: the photo moves up, showing more of its foot.
  const slider = await startRepositioning(page, "keyboard");
  await expect(slider).toBeFocused();
  await page.keyboard.press("Shift+ArrowUp");
  await page.keyboard.press("ArrowUp");
  await expect.poll(() => framing(bandPhoto(page))).toBe(61);
  await page.keyboard.press("Enter");
  await expect(slider).toBeHidden();
  await expect(editCover(page)).toBeFocused();

  await page.reload();
  await expect(bandPhoto(page)).toBeVisible();
  await expect.poll(() => framing(bandPhoto(page))).toBe(61);

  // And Esc puts it back, sending nothing.
  const patches: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "PATCH") patches.push(request.url());
  });
  await startRepositioning(page, "keyboard");
  await page.keyboard.press("ArrowDown");
  await expect.poll(() => framing(bandPhoto(page))).toBe(60);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("slider", { name: "Cover position" })).toBeHidden();
  await expect(editCover(page)).toBeFocused();
  await expect.poll(() => framing(bandPhoto(page))).toBe(61);
  expect(patches).toEqual([]);
});
