import { expect, test } from "./fixtures/test";
import { createMappedTrip } from "./helpers";
import { e2eTripName } from "./tripNames";

// **M26 link 13 — the only gate box in this milestone that is a MEASUREMENT**,
// because KI-046 is a measured entry and is amended by measurement, never by an
// impression that it looks better.
//
// KI-046's surviving symptom, re-measured 2026-09-05 at 412px: *"On a 412px
// viewport the card spans ~364px, and the stop's title and note get 82px of it
// … A one-line note wraps to 121px tall in that column."*
//
// It was measured again at 390x844 on 2026-09-20 and the cause had moved: the
// 92px time gutter that starved the column went with the Timeline lens (SPEC
// §24), taking the text to 141px — but the CARD had shrunk from 364px to 241px,
// because a phone was rendering the desktop board. `DAY_COLUMN_WIDTH_PX` is a
// fixed 268px at every width, so a 390px screen showed one and a bit columns
// side by side. The card was narrow because of a layout constant, not because
// the screen is.
//
// §13.4 already had the answer — *"a phone can hold one day at a time; the rail
// is how you change which"* — and the build already had every piece of it. This
// file is what holds it there.
//
// **Numbers, not classes.** This is the layer that can measure; jsdom has no
// layout, and the milestone's box asks for a figure.
test.describe("M26 link 13 — Plan on a phone", () => {
  // Long enough to fill the column, so what is measured is the width AVAILABLE
  // to text and not the width of a short string. KI-046's own figure was an
  // available-width measurement (x 165 -> 247).
  const LONG_TITLE = "Kiyomizu-dera temple and the Higashiyama lanes below it";

  async function planWithALongStop(page: import("@playwright/test").Page) {
    const tripId = await createMappedTrip(page, e2eTripName("PhonePlan"), 3);
    const detail = await (await page.request.get(`/api/trips/${tripId}`)).json();
    const response = await page.request.post(`/api/trips/${tripId}/commands`, {
      data: {
        type: "AddActivity",
        tripId,
        activityId: crypto.randomUUID(),
        dayId: detail.trip.days[0].dayId,
        title: LONG_TITLE,
      },
    });
    expect(response.ok()).toBe(true);
    // Straight to the URL: below 768px the lens TAB STRIP is `hidden md:block`
    // under SPEC §10's two-views rule, so `openPlan`'s tab does not exist here.
    await page.goto(`/trips/${tripId}?view=Plan`);
    return tripId;
  }

  test("gives the stop card's text column its width back", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await planWithALongStop(page);

    const card = page.getByTestId(/^activity-card-/).filter({ hasText: "Kiyomizu-dera" }).first();
    await card.waitFor();

    const textColumn = await card.evaluate((el) => {
      const row = el.querySelector("span.min-w-0")?.parentElement;
      if (row === null || row === undefined) return null;
      const actions = row.lastElementChild as HTMLElement;
      return Math.round(row.getBoundingClientRect().width - actions.getBoundingClientRect().width - 8);
    });

    // **KI-046's 82px is the number this replaces.** The floor is set well
    // below what was measured (215px) on purpose: this holds the ORDER OF
    // MAGNITUDE the link changed, not a pixel count that a font metric or a
    // padding token would make brittle. A regression to the desktop board at
    // this width gives 141px and fails; a tweak to a gap does not.
    expect(textColumn).not.toBeNull();
    expect(textColumn!).toBeGreaterThan(180);
  });

  // §13.4: "A phone can hold one day at a time; the rail is how you change
  // which." The rail is `DayChips`, which already held the selection across
  // Plan, Map and Notebook — this asserts that Plan now honours it.
  test("shows one day at a time, and the rail changes which", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await planWithALongStop(page);

    const columns = page.getByTestId(/^day-column/);
    await expect(columns).toHaveCount(1);
    await expect(page.getByText("Kiyomizu-dera temple and the Higashiyama lanes below it")).toBeVisible();

    // Day 2, through the rail.
    await page.locator("[data-day-index=\"1\"]").click();
    await expect(columns).toHaveCount(1);
    await expect(page.getByText("Kiyomizu-dera temple and the Higashiyama lanes below it")).toHaveCount(0);
  });

  // SPEC §13.1's 44px floor, on controls link 14's chrome pass did not reach:
  // they live inside a card, and measured 32x32 before this link.
  test("gives a stop's own controls a 44px target", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await planWithALongStop(page);

    const edit = page.getByRole("button", { name: `Edit ${LONG_TITLE}` });
    const box = await edit.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(box!.width).toBeGreaterThanOrEqual(44);
  });

  // Found by the 2026-09-24 mobile check: the Day / Start / End row needed
  // ~407px, and a bare `1fr` grid track cannot shrink below its content, so on
  // a phone it widened the whole form past the 358px sheet — every field ran
  // ~50px off the right edge and Save sat at x 368–427 on a 390px screen.
  // Measured, because jsdom has no layout.
  test("fits the stop editor inside the phone, with Save on screen", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await planWithALongStop(page);
    await page.getByRole("button", { name: `Edit ${LONG_TITLE}` }).click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor();

    // Measured in the page with every sideways scroll reset to 0, NOT via
    // `scrollIntoViewIfNeeded` + `boundingBox`: that scrolls the sheet
    // SIDEWAYS to reach an off-screen field, which then measures as on screen
    // — the first version of this test passed against the broken layout for
    // exactly that reason. A field's x does not depend on vertical scroll, so
    // nothing needs scrolling at all (PR #220 review: measure the fields this
    // test is about, not "no scroller overflows", which an empty list passes).
    const rights = await dialog.evaluate((d) => {
      for (const el of [d, ...d.querySelectorAll<HTMLElement>("*")]) el.scrollLeft = 0;
      const right = (el: Element | null | undefined) => (el ? el.getBoundingClientRect().right : null);
      return {
        Day: right(d.querySelector("#activity-day")),
        Start: right(d.querySelector("#activity-start")),
        "End time": right(d.querySelector("#activity-end-time")),
        Save: right([...d.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Save")),
      };
    });
    for (const [name, right] of Object.entries(rights)) {
      expect(right, `${name} is rendered`).not.toBeNull();
      expect(right!, `${name} ends inside the 390px screen`).toBeLessThanOrEqual(390);
    }
  });

  // The desktop is unchanged, which is the other half of "a variant layer, not
  // a second design system": same component, different density.
  test("still shows every day side by side on a desktop", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await planWithALongStop(page);
    await expect(page.getByTestId(/^day-column/)).toHaveCount(3);
  });
});
