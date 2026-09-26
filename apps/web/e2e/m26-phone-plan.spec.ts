import { expect, test } from "./fixtures/test";
import type { Browser, Locator, Page } from "@playwright/test";
import { createMappedTrip, fingerOn, riverPoint } from "./helpers";
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

  // **The stop is untimed, and that is why it is still a card** (M29 phone).
  // Since 2026-09-26 a phone draws its day as the river, and only a stop with
  // no time keeps a card, on the "Any time" shelf above it; the measurements
  // below are of that card. A timed stop is a river block, walked in the M29
  // describe at the end of this file.
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

// **M29 — the phone gets the river** (Mitchell, 2026-09-26: *"cards should get
// the river, we might need to think through the gestures, but keep
// functionality as similar as possible"*). The phone's day is the desktop
// column's river now, and its gestures are the touch versions DayRiver gives
// any touch pointer: a hold where the mouse drags or double-clicks, so that a
// swipe still scrolls. Which gesture reaches which command is
// `DayRiver.test.tsx`; this is the layer with a real finger, a real scroll and
// real hit-testing, which jsdom has none of.
//
// A phone context of its own (`isMobile` + `hasTouch`, as m18b's touch tablet),
// because the `desktop` project's page has a mouse, and Chromium only reports
// a coarse pointer and routes touch input with both flags set.
//
// **The trip.** Two days, each with stops at 8–9 am, 4–5 pm and 9–10 pm, so the
// shared axis runs 8 am to 10 pm (616px, taller than the screen) and 9 am to
// 4 pm is empty time.
test.describe("M29 — the river on a phone", () => {
  const PX_PER_HOUR = 44;
  const AXIS_START = 8;

  async function phone(browser: Browser, label: string, size = { width: 390, height: 844 }) {
    const context = await browser.newContext({
      viewport: size,
      isMobile: true,
      hasTouch: true,
      storageState: ".auth/alice.json",
    });
    const page = await context.newPage();
    const tripId = await createMappedTrip(page, e2eTripName(label), 2, {
      activitiesPerDay: 3,
      timeWindows: [
        { start: "08:00", end: "09:00" },
        { start: "16:00", end: "17:00" },
        { start: "21:00", end: "22:00" },
      ],
      title: (day, index) => `Day ${day + 1} ${["breakfast", "walk", "dinner"][index]}`,
    });
    await page.goto(`/trips/${tripId}?view=Plan`);
    const river = page.getByTestId("day-river");
    await expect(river).toHaveCount(1);
    // Every assumption below rests on this: a finger, not a mouse.
    expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
    return { context, page, river };
  }

  /** A point on the river at `hours`, scrolled clear of the header, rack and tab bar. */
  const pointAt = (page: Page, river: Locator, hours: number, centre = hours) =>
    riverPoint(page, river, hours, { axisStart: AXIS_START, centre });

  const block = (scope: Locator | Page, name: RegExp) => scope.getByRole("button", { name });

  test("draws the day as a river, and a tap on a block opens it", async ({ browser }) => {
    const { context, page, river } = await phone(browser, "PhoneRiver");
    // The timed stops are river blocks, not a list of cards: each is drawn on
    // the river, at its time.
    await expect(block(river, /^Edit Day 1 breakfast, 8 am – 9 am,/)).toBeVisible();
    await expect(block(river, /^Edit Day 1 walk, 4 pm – 5 pm,/)).toBeVisible();
    await expect(river.getByRole("list", { name: / timeline$/ })).toBeVisible();

    const at = await pointAt(page, river, 16.5);
    await page.touchscreen.tap(at.x, at.y);
    await expect(page.getByRole("heading", { name: "Edit activity" })).toBeVisible();
    await expect(page.getByLabel("Start", { exact: true })).toHaveValue("16:00");
    await context.close();
  });

  test("a hold on empty time, let go, adds a stop there", async ({ browser }) => {
    const { context, page, river } = await phone(browser, "PhoneRiverAdd");
    const finger = await fingerOn(page);

    // 12:05: the quarter hour nearest is noon.
    const at = await pointAt(page, river, 12 + 5 / 60);
    await finger.down(at.x, at.y);
    // The hold is what draws the hour; nothing is drawn before it.
    await expect(river.getByTestId("river-ghost")).toHaveText("12 pm – 1 pm");
    await finger.up();

    await expect(page.getByRole("heading", { name: "Add a stop" })).toBeVisible();
    await expect(page.getByLabel("Start", { exact: true })).toHaveValue("12:00");
    await page.getByLabel("What or where").fill("Lunch");
    await page.getByRole("button", { name: "Add stop" }).last().click();
    await expect(block(river, /^Edit Lunch, 12 pm – 1 pm,/)).toBeVisible();
    await context.close();
  });

  test("a held block is carried to a new time", async ({ browser }) => {
    const { context, page, river } = await phone(browser, "PhoneRiverMove");
    const finger = await fingerOn(page);
    const walk = page.getByTestId(/^activity-card-/).filter({ has: block(page, /^Edit Day 1 walk,/) });

    // Held at 4:30, its middle, so its top rides half an hour above the finger:
    // carried to 1:30, it lands at 1 pm. The page is centred on 3 pm so both
    // ends are on screen and clear of the bands that scroll it.
    const from = await pointAt(page, river, 16.5, 15);
    await finger.down(from.x, from.y);
    await expect(walk).toHaveAttribute("data-lifted", "true");
    await finger.move(from.x, from.y - 3 * PX_PER_HOUR, 16);
    await expect(river.getByTestId("river-ghost")).toHaveText("1 pm – 2 pm");
    await finger.up();

    await expect(block(river, /^Edit Day 1 walk, 1 pm – 2 pm,/)).toBeVisible();
    // The release was a drop, not also a tap on the block it let go of.
    await expect(page.getByRole("heading", { name: "Edit activity" })).toHaveCount(0);
    await page.reload();
    await expect(block(page.getByTestId("day-river"), /^Edit Day 1 walk, 1 pm – 2 pm,/)).toBeVisible();
    await context.close();
  });

  test("the grip is a 44px target, and dragging it changes when a stop ends", async ({ browser }) => {
    const { context, page, river } = await phone(browser, "PhoneRiverResize");
    const finger = await fingerOn(page);
    const breakfast = page.getByTestId(/^activity-card-/).filter({ has: block(page, /^Edit Day 1 breakfast,/) });
    const grip = breakfast.getByTitle("Drag to change when it ends");

    const to = await pointAt(page, river, 10.5);
    const box = (await grip.boundingBox())!;
    // SPEC §13.1's floor, on the one control a to-scale block could not grow.
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
    await finger.down(box.x + box.width / 2, box.y + box.height / 2);
    await finger.move(box.x + box.width / 2, to.y);
    await expect(block(river, /^Edit Day 1 breakfast, 8 am – 10:30 am,/)).toBeVisible();
    await finger.up();

    await expect(page.getByTestId("toast")).toContainText("Now ends at 10:30 am");
    await context.close();
  });

  test("a plain swipe scrolls the river and creates nothing", async ({ browser }) => {
    const { context, page, river } = await phone(browser, "PhoneRiverSwipe");
    const finger = await fingerOn(page);

    const at = await pointAt(page, river, 13);
    const before = await page.evaluate(() => window.scrollY);
    await finger.down(at.x, at.y);
    await finger.move(at.x, at.y - 250, 6);
    await finger.up();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(before + 100);
    // A swipe flings: the page keeps scrolling after the finger lifts. Wait
    // until a frame goes by without it moving, or the next point is aimed at
    // a river still sliding under it (seen on the first ci-like run: a hold
    // aimed at 11:00 landed at 11:15).
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            new Promise<boolean>((settled) => {
              const y = window.scrollY;
              requestAnimationFrame(() => requestAnimationFrame(() => settled(window.scrollY === y)));
            }),
        ),
      )
      .toBe(true);

    // A hold would have drawn an outline under the finger by now, and stayed
    // drawn waiting for a release it will never get. So the next hold is
    // waited out, and the only outline on the river is ITS hour.
    const next = await pointAt(page, river, 11);
    await finger.down(next.x, next.y);
    await expect(river.getByTestId("river-ghost")).toHaveText("11 am – 12 pm");
    await finger.up();
    await expect(page.getByLabel("Start", { exact: true })).toHaveValue("11:00");
    await context.close();
  });
});
