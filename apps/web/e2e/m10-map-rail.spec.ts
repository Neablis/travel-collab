import { expect, test, type Page } from "@playwright/test";
import { createMappedTrip } from "./helpers";
import { gearedTravel } from "../src/components/lenses/mapRailFocus";
import { readMapRailTuning } from "../src/components/lenses/mapRailTuning";

const DAY_COUNT = 14;

/** Which day the rail currently marks focused, by its 1-based label. */
async function focusedDayLabel(page: Page): Promise<string> {
  return page.locator('[aria-label="Days"] button[aria-current="true"]').innerText();
}

// The day label span renders with a CSS `uppercase` text-transform (see
// MapRail.tsx), so a real browser's `.innerText()` reflects the rendered
// "DAY N", not the underlying "Day N" string a jsdom-based test would see
// untransformed — matched case-insensitively for that reason.
function dayNumberOf(label: string): number {
  return Number(label.match(/day (\d+)/i)![1]);
}

async function scrollRailBy(page: Page, delta: number): Promise<void> {
  await page.evaluate((by) => {
    document.querySelector('[aria-label="Days"]')!.scrollTop += by;
  }, delta);
  // One frame for the scroll handler's leading edge plus its trailing timer.
  await page.waitForTimeout(120);
}

test("map rail: scrolling tracks focus through every day", async ({ page }) => {
  // A deliberately thorough 200-step full-rail scan (~25s alone) plus fixture
  // setup through the command API comfortably exceeds Playwright's default
  // 30s per-test budget; this is a slow-but-worthwhile browser test, not a
  // hung one.
  test.setTimeout(90_000);
  // Distinct prefix from other specs' trip names — parallel workers share a DB.
  const tripName = `MapRail ${Date.now()}`;
  await page.goto("/");
  const tripId = await createMappedTrip(page, tripName, DAY_COUNT);

  await page.goto(`/trips/${tripId}?lens=Map`);
  const rail = page.locator('[aria-label="Days"]');
  await expect(rail).toBeVisible();
  await expect(rail.getByRole("button")).toHaveCount(DAY_COUNT);

  // -- the rail is geared: its scroll range far exceeds its content --
  const { scrollHeight, clientHeight } = await rail.evaluate((el) => ({
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
  }));
  expect(scrollHeight).toBeGreaterThan(clientHeight * 3);

  // -- the manufactured spacer height matches gearedTravel's formula --
  // Reads the live tuning default rather than a hardcoded number, so this
  // assertion keeps holding after Task 6 settles a different scrollPxPerDay.
  // This checks the *total* geared range, not the per-day rate: with n
  // uniformly-spaced days the sweep's n-1 transitions land at even 1/n steps
  // of that range, so any one day change actually costs (n-1)/n of
  // scrollPxPerDay (see mapRailFocus.ts's gearedTravel doc comment) — this
  // assertion can't see that distinction, only that the manufactured range as
  // a whole matches the formula. A generous +/-40px tolerance absorbs
  // sub-pixel layout rounding without being loose enough to miss the gearing
  // being wired to the wrong rate.
  const { scrollPxPerDay } = readMapRailTuning();
  const expectedTravel = gearedTravel(DAY_COUNT, scrollPxPerDay);
  const actualTravel = scrollHeight - clientHeight;
  expect(actualTravel).toBeGreaterThan(expectedTravel - 40);
  expect(actualTravel).toBeLessThan(expectedTravel + 40);

  // -- scrolling from top to bottom visits every day, in order, none skipped --
  // This is the regression test for the two defects that made this feature
  // fail: focus that stuck on Day 1 mid-scroll, and a fixed focus line that
  // could never reach days near either end.
  await page.evaluate(() => {
    document.querySelector('[aria-label="Days"]')!.scrollTop = 0;
  });
  await page.waitForTimeout(120);

  const step = Math.ceil((scrollHeight - clientHeight) / 200);
  // Starts empty rather than seeded with a pre-loop read: MapRail
  // deliberately never emits focus on mount (see MapRail.tsx's "measure never
  // emits focus" comment and the design doc's "no emit on mount" invariant),
  // so nothing carries `aria-current` until the loop's first real scroll
  // event fires. `dayNumbers[dayNumbers.length - 1]` already handles an empty
  // array correctly (reads `undefined`), so the first post-scroll label is
  // captured the same way every subsequent change is. Dedupes on the parsed
  // day number rather than the button's full text, so an unrelated re-render
  // while focus holds steady can't push a spurious duplicate.
  const dayNumbers: number[] = [];
  for (let i = 0; i < 200; i++) {
    await scrollRailBy(page, step);
    const day = dayNumberOf(await focusedDayLabel(page));
    if (day !== dayNumbers[dayNumbers.length - 1]) dayNumbers.push(day);
  }

  expect(dayNumbers).toEqual(Array.from({ length: DAY_COUNT }, (_, i) => i + 1));

  // -- the last day is reached at the bottom boundary --
  // The scan above already ends at (or past) the bottom via `ceil`-ed steps,
  // so re-setting scrollTop to the same max value would fire no native
  // `scroll` event and this would tautologically re-read the scan's own last
  // result. Dip away from the bottom first so the following jump is a real,
  // observed scroll.
  await page.evaluate(() => {
    const el = document.querySelector('[aria-label="Days"]')!;
    el.scrollTop = Math.max(0, el.scrollHeight - el.clientHeight - 500);
  });
  await page.waitForTimeout(120);
  await page.evaluate(() => {
    const el = document.querySelector('[aria-label="Days"]')!;
    el.scrollTop = el.scrollHeight;
  });
  await page.waitForTimeout(120);
  expect(dayNumberOf(await focusedDayLabel(page))).toBe(DAY_COUNT);

  // -- and the first day at the top --
  await page.evaluate(() => {
    document.querySelector('[aria-label="Days"]')!.scrollTop = 0;
  });
  await page.waitForTimeout(120);
  expect(dayNumberOf(await focusedDayLabel(page))).toBe(1);

  // -- clicking still focuses directly, unchanged by any of the above --
  // A settle wait matches every other read in this file: click's own
  // scrollIntoViewIfNeeded can itself fire the rail's throttled scroll
  // handler, whose trailing edge (up to scrollThrottleMs later) could
  // otherwise race the click's direct onFocus call.
  await rail.getByRole("button").nth(6).click();
  await page.waitForTimeout(120);
  expect(dayNumberOf(await focusedDayLabel(page))).toBe(7);

  // -- Tab-ing onto an off-screen day button leaves it fully visible --
  // Regression test for a real bug found live during Task 6's tuning pass:
  // the clip div that pins the day list to the rail's viewport is a scroll
  // container as far as the browser's own keyboard-focus handling is
  // concerned, and its native "scroll the focused element into view" attempt
  // doesn't understand this rail's geared/transformed layout — left
  // unhandled, Tab-ing to an off-screen day left it completely clipped out of
  // view while holding keyboard focus (see MapRail.tsx's `focusin` handler
  // and design doc's "Sticky verification" section for the fix).
  await page.evaluate(() => {
    document.querySelector('[aria-label="Days"]')!.scrollTop = 0;
  });
  await page.waitForTimeout(120);
  await rail.getByRole("button").first().focus();
  for (let i = 0; i < 10; i++) await page.keyboard.press("Tab");
  await page.waitForTimeout(150);
  const focusVisibility = await rail.evaluate((el) => {
    const clip = el.querySelector("[data-rail-track]")!.parentElement!;
    const activeRect = document.activeElement!.getBoundingClientRect();
    const clipRect = clip.getBoundingClientRect();
    return { activeTop: activeRect.top, activeBottom: activeRect.bottom, clipTop: clipRect.top, clipBottom: clipRect.bottom };
  });
  expect(focusVisibility.activeTop).toBeGreaterThanOrEqual(focusVisibility.clipTop - 1);
  expect(focusVisibility.activeBottom).toBeLessThanOrEqual(focusVisibility.clipBottom + 1);
});
