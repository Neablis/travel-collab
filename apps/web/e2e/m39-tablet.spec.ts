import { expect, test } from "./fixtures/test";
import { controlsUnderFloor, createMappedTrip } from "./helpers";
import { e2eTripName } from "./tripNames";

// **M39 D3 — a tablet keeps the 44px floor, and Ask does not take its board**
// (KI-2026-09-24-j). Measured 2026-09-24 at 820×1180: on Plan 244 of 287
// controls were under 32px, the floating Ask covered the right-hand column's
// costs, and Ask docked left the board about 440px.
//
// Runs in the `tablet` project: 820×1180 with `hasTouch`, which is what makes
// Chromium report `pointer: coarse` (probed 2026-10-09: `hasTouch: true` gives
// `(pointer: coarse)` true and `(pointer: fine)` false; without it, the
// reverse). The floor is keyed on the pointer, not the width, so a project
// without touch would measure a desktop at 820px instead of a tablet.
test.describe("M39 D3 — a tablet", () => {
  // The same exception, for the same reason, as `m26-phone-targets`: the
  // map's attribution is the library's, and legally required.
  const ALLOWED = [/MapLibre|OpenFreeMap|OpenMapTiles|OpenStreetMap/];

  async function tabletPlan(page: import("@playwright/test").Page, label: string) {
    const tripId = await createMappedTrip(page, e2eTripName(label), 3);
    // Tags on the first stop, so the chips are on screen to be measured — the
    // gap `m26-phone-targets` records for KI-2026-09-24-m.
    const { trip } = (await (await page.request.get(`/api/trips/${tripId}`)).json()) as {
      trip: { days: { activityIds: string[] }[] };
    };
    const tagged = await page.request.post(`/api/trips/${tripId}/commands`, {
      data: { type: "UpdateActivity", tripId, activityId: trip.days[0]!.activityIds[0], tags: ["meal", "ticketed"] },
    });
    expect(tagged.ok()).toBe(true);
    await page.goto(`/trips/${tripId}?view=Plan`);
    await page.getByTestId("tag-chip-meal").first().waitFor();
    return tripId;
  }

  test("every control on Plan clears 44px under a finger, bar a named few", async ({ page }) => {
    await tabletPlan(page, "TabletTargets");
    const offenders = (await controlsUnderFloor(page))
      .filter((c) => !ALLOWED.some((allowed) => allowed.test(c.name)))
      .map((c) => `"${c.name}" is ${c.h}px`);
    // A list, not a count, so a failure names what broke.
    expect(offenders).toEqual([]);
  });

  // The reader's docked choice applies from 1100px up; below it the board
  // keeps every pixel and Ask comes up over it. Stored as `docked` explicitly,
  // so this is the band overriding a choice and not the default happening to
  // agree.
  test("Ask opens over the board rather than beside it, whatever shape was chosen", async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("assistant:shape:board", "docked"));
    await tabletPlan(page, "TabletAsk");
    const board = page.getByTestId("trip-board-content");
    const before = await board.evaluate((el) => el.getBoundingClientRect().width);

    await page.locator('header[aria-label="Trip"]').getByRole("button", { name: "Ask", exact: true }).click();
    const rail = page.getByRole("complementary", { name: "Assistant" });
    await expect(rail).toBeVisible();

    // Docked would take 356px of this; an overlay takes none.
    expect(await board.evaluate((el) => el.getBoundingClientRect().width)).toBe(before);
    // And it is over the board, not beside it: it starts at the left edge.
    expect((await rail.boundingBox())!.x).toBe(0);
  });
});
