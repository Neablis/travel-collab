import { expect, test, type Page } from "@playwright/test";
import { createMappedTrip, signInAsDevUser } from "./helpers";
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
  await signInAsDevUser(page, "alice");
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

  // -- gearing holds at the tuned rate: scrollPxPerDay of travel per day --
  // Reads the live tuning default rather than a hardcoded number, so this
  // assertion keeps holding after Task 6 settles a different scrollPxPerDay.
  // A generous +/-40px tolerance absorbs sub-pixel layout rounding without
  // being loose enough to miss the gearing being wired to the wrong rate.
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
  // event fires. `label !== seen[seen.length - 1]` already handles an empty
  // array correctly (`seen[-1]` is `undefined`), so the first post-scroll
  // label is captured the same way every subsequent change is.
  const seen: string[] = [];
  for (let i = 0; i < 200; i++) {
    await scrollRailBy(page, step);
    const label = await focusedDayLabel(page);
    if (label !== seen[seen.length - 1]) seen.push(label);
  }

  const dayNumbers = seen.map(dayNumberOf);
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
});
