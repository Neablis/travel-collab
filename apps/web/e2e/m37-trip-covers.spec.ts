import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures/test";
import { createEmptyTripViaWizard, homeTrip } from "./helpers";
import { e2eTripName } from "./tripNames";

// M37's gate walk: an empty trip's designed card, a cover picked from Trip
// settings, and the cover with its credit back on Home. The server runs with
// `EXTERNAL_DATA_OFFLINE=true` (playwright.config.ts), so the cover source is
// the offline fake (`server/external/unsplash/offline.ts`): three fixed
// photos for any query, served as SVGs from this origin, and no request to
// Unsplash from any test.

/** Creates an empty trip and follows its *Choose a cover photo* link into Trip settings. */
async function openCoverPickerFromHome(page: Page, tripName: string): Promise<Locator> {
  await page.goto("/");
  await createEmptyTripViaWizard(page, tripName);

  // The designed empty state (D6): the dates line, then the next steps. The
  // trip is the hero or a card, whichever the shared account's race gives it.
  const onHome = homeTrip(page, tripName);
  await expect(onHome.getByText("No dates yet · nothing planned yet")).toBeVisible();
  await expect(onHome.getByRole("link", { name: "Add the first day" })).toBeVisible();
  await onHome.getByRole("link", { name: "Choose a cover photo" }).click();

  const sheet = page.getByRole("dialog", { name: "Trip settings" });
  await expect(sheet).toBeVisible();
  // The link's whole point: the sheet opens AT the section, not its top. In
  // view is not enough — the section is in view at the sheet's top too. So:
  // its top at the scrollport's (less the 16px `scroll-mt-4`), or, where the
  // sheet is too short to bring it that far, scrolled as far as it goes. At
  // 1280×900 the second holds: the port scrolls 52px and the section stays
  // 167px down; the sheet at its top read 219 and failed.
  const section = sheet.getByRole("region", { name: "Cover photo" });
  const scrollport = sheet.getByTestId("sheet-scrollport");
  await expect
    .poll(async () => {
      const [at, port] = await Promise.all([section.boundingBox(), scrollport.boundingBox()]);
      const { scrollTop, end } = await scrollport.evaluate((el) => ({
        scrollTop: el.scrollTop,
        end: el.scrollHeight - el.clientHeight,
      }));
      if (!at || !port || end <= 0) return `unscrollable (${end})`;
      return Math.round(at.y - port.y) <= 24 || scrollTop >= end - 1
        ? "landed"
        : `${Math.round(at.y - port.y)}px down at scrollTop ${scrollTop} of ${end}`;
    })
    .toBe("landed");
  return section;
}

test("pick a cover for an empty trip in Trip settings, and see it credited on Home", async ({ page }) => {
  // Shorter than the project's 900, so the sheet always has somewhere to
  // land. At 900 it fit exactly once alice held Premium — which
  // `m11-invites.spec.ts` grants her mid-run, taking People's Premium note
  // with it — and the landing check read "unscrollable (0)" with the section
  // in plain view (PR #354's Tier 3). Whether it did depended on which spec
  // ran first in the shard. At 720 the sheet scrolls whichever plan she has.
  await page.setViewportSize({ width: 1280, height: 720 });
  const tripName = e2eTripName("Covers");
  const section = await openCoverPickerFromHome(page, tripName);

  await section.getByRole("searchbox", { name: "Search photos" }).fill("dunes");
  await section.getByRole("button", { name: "Search" }).click();
  const pick = section.getByRole("button", { name: "Use photo by Ada Offline" });
  await expect(pick).toHaveAttribute("aria-pressed", "false");
  await Promise.all([
    page.waitForResponse((r) => /\/api\/trips\/[^/]+\/cover$/.test(new URL(r.url()).pathname) && r.request().method() === "PUT" && r.ok()),
    pick.click(),
  ]);
  await expect(pick).toHaveAttribute("aria-pressed", "true");
  await expect(section.getByRole("button", { name: "Remove cover" })).toBeVisible();

  // **And on the trip, at once** (Mitchell, 2026-10-10 preview: "adding a cover
  // photo makes no changes right away"). Closing the sheet shows the band above
  // the desktop header with the photo just picked — no reload — and the band is
  // the way back into the picker.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Trip settings" })).toBeHidden();
  const band = page.getByRole("button", { name: "Change cover photo" });
  await expect(band).toBeVisible();
  await expect(page.getByRole("img", { name: "Sand dunes under a pale sun" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add cover" })).toHaveCount(0);
  await band.click();
  await expect(page.getByRole("dialog", { name: "Trip settings" }).getByRole("region", { name: "Cover photo" })).toBeVisible();

  // Home reads the cover off the trip list, on its next load.
  await page.goto("/");
  const onHome = homeTrip(page, tripName);
  const photo = onHome.getByRole("img", { name: "Sand dunes under a pale sun" });
  await expect(photo).toBeVisible();
  // Rendered, not just present: the image actually loaded under the CSP. It
  // is lazy on a card, so it is brought on screen first.
  await photo.scrollIntoViewIfNeeded();
  await expect.poll(() => photo.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  await expect(onHome.getByText("Photo by Ada Offline on Unsplash")).toBeVisible();
  await expect(onHome.getByRole("link", { name: "Ada Offline" })).toHaveAttribute(
    "href",
    "https://unsplash.com/@ada-offline?utm_source=caesura&utm_medium=referral",
  );
  // A trip with a cover is no longer offered one.
  await expect(onHome.getByRole("link", { name: "Add the first day" })).toBeVisible();
  await expect(onHome.getByRole("link", { name: "Choose a cover photo" })).toHaveCount(0);
});

test("the cover picker fits a 390px phone, with 44px targets", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const tripName = e2eTripName("Covers phone");
  const section = await openCoverPickerFromHome(page, tripName);

  await section.getByRole("searchbox", { name: "Search photos" }).fill("harbour");
  await section.getByRole("button", { name: "Search" }).click();
  const tiles = section.getByRole("button", { name: /^Use photo by / });
  await expect(tiles).toHaveCount(3);

  // Nothing reaches past the screen's right edge. Measured on the controls
  // rather than as the sheet's scrollWidth: the sheet is not the box that
  // scrolls, and a grid forced to 600px left that number at 0.
  const search = section.getByRole("button", { name: "Search" });
  for (const target of [search, ...(await tiles.all())]) {
    const box = await target.boundingBox();
    expect((box?.x ?? Infinity) + (box?.width ?? 0)).toBeLessThanOrEqual(390);
  }
  for (const target of [
    section.getByRole("searchbox", { name: "Search photos" }),
    search,
    tiles.first(),
    section.getByRole("link", { name: "Ben Offline" }),
  ]) {
    const box = await target.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }

  // And the credit Home shows under a cover: two links in a sentence, which
  // measured 15px tall at 390 on the #354 preview.
  await Promise.all([
    page.waitForResponse((r) => /\/api\/trips\/[^/]+\/cover$/.test(new URL(r.url()).pathname) && r.request().method() === "PUT" && r.ok()),
    section.getByRole("button", { name: "Use photo by Ben Offline" }).click(),
  ]);
  await page.goto("/");
  const onHome = homeTrip(page, tripName);
  for (const link of [onHome.getByRole("link", { name: "Ben Offline" }), onHome.getByRole("link", { name: "Unsplash" })]) {
    await link.scrollIntoViewIfNeeded();
    const box = await link.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
});
