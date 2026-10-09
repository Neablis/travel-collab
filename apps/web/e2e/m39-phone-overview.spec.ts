import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures/test";
import { createMappedTrip } from "./helpers";
import { e2eTripName } from "./tripNames";

// **M39 D2 — a trip still opens on Overview on a phone, and Overview is the
// phone notebook page** (KI-2026-09-25-f). Mitchell, 2026-10-09: the Overview
// tab renders SPEC §19's phone page (artboard `phoneNbDoc`) read-only — no
// letter frame, the blocks in their phone form — and Edit still opens the page
// in the Notebook (§25). The desktop letter does not change.
//
// Geometry, so a browser: jsdom has no layout, and "the frame is gone" and
// "the page is shorter" are only true or false where CSS applies.

const letter = (page: Page) => page.locator(".tc-overview-letter");

async function overviewOf(page: Page, label: string): Promise<string> {
  const tripId = await createMappedTrip(page, e2eTripName(label), 3);
  await page.goto(`/trips/${tripId}`);
  await expect(page.getByTestId("itinerary-day")).toHaveCount(3);
  return tripId;
}

test.describe("M39 D2 — the Overview on a phone", () => {
  // The KI's own measurement, on the seeded trip it was taken on: 390px wide,
  // the demo's fourteen days. 7,481px on the production build before this
  // change (the KI's 8,560 predates the M30 itinerary template), 3,048 after,
  // of which "Day by day" went from 5,848 to 1,556. 4,000 sits well clear of
  // both — it fails the old page by 3,500px and leaves a quarter of the new
  // one for the demo's copy to grow into. The per-day figure is the sharper
  // claim: ~418px a day before, ~111 after; 200 is the line between a printed
  // schedule and a row per day.
  test("drops the letter frame and reads at phone density, at 390px", async ({ browser }) => {
    const context = await browser.newContext({
      storageState: { cookies: [], origins: [] },
      viewport: { width: 390, height: 844 },
    });
    const page = await context.newPage();
    await page.goto("/demo");
    const days = page.getByRole("list", { name: "Day by day" }).getByTestId("itinerary-day");
    await expect(days).toHaveCount(14);

    // The frame: no shadow, no border, and the sheet's ground meets both
    // edges of the screen.
    const frame = await letter(page).evaluate((el) => {
      const cs = getComputedStyle(el);
      const box = el.getBoundingClientRect();
      return { shadow: cs.boxShadow, border: cs.borderTopWidth, left: box.left, right: box.right };
    });
    expect(frame).toEqual({ shadow: "none", border: "0px", left: 0, right: 390 });

    // The schedule's phone form: no per-stop list inside a day.
    await expect(page.getByRole("list", { name: "Day 1", exact: true })).toHaveCount(0);
    const schedule = (await page.getByRole("list", { name: "Day by day" }).boundingBox())!;
    expect(schedule.height / 14).toBeLessThan(200);

    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    expect(height).toBeLessThan(4_000);
    await context.close();
  });

  // At the project's own 411px, Mitchell's device: Edit is still the one
  // action, and it leaves the tab for the Notebook (§25) rather than editing
  // here.
  test("Edit opens the page in the Notebook", async ({ page }) => {
    const tripId = await overviewOf(page, "PhoneOverviewEdit");
    await expect(page.getByRole("list", { name: "Day 1", exact: true })).toHaveCount(0);

    await letter(page).getByRole("link", { name: "Edit" }).click();
    await expect(page).toHaveURL(new RegExp(`/trips/${tripId}/pages/[^/?]+\\?from=overview$`));
    await expect(page.getByRole("heading", { name: "Overview", level: 1 })).toBeVisible();
  });
});

test.describe("M39 D2 — the Overview on a desktop is unchanged", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("keeps the letter and the printed schedule at 1280px", async ({ page }) => {
    await overviewOf(page, "DesktopOverview");

    const frame = await letter(page).evaluate((el) => {
      const cs = getComputedStyle(el);
      return { shadow: cs.boxShadow, border: cs.borderTopWidth, width: el.getBoundingClientRect().width };
    });
    expect(frame.shadow).not.toBe("none");
    expect(frame.border).toBe("1px");
    // `max(720px, 75vw)` = 960, inside the lens's column.
    expect(frame.width).toBe(960);
    // The printed form: each day carries its own list of timed stops.
    await expect(page.getByRole("list", { name: "Day 1", exact: true })).toBeVisible();
  });
});
