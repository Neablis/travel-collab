import { expect, test, type Page } from "@playwright/test";
import { createMappedTrip } from "./helpers";
import { e2eTripName } from "./tripNames";
import { gearedTravel } from "../src/components/lenses/mapRailFocus";
import { readMapRailTuning } from "../src/components/lenses/mapRailTuning";

const DAY_COUNT = 14;

// The rail's focus log lives on `window` for the duration of the scan below.
// Type-only: Playwright's transform erases this, it never reaches the browser.
type RailWindow = Window & typeof globalThis & { __railFocusLog?: number[] };

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

/**
 * Moves the rail's scroll position and waits two frames — never the clock.
 *
 * KI-13/KI-21: every wall-clock sleep this file used to carry (nine of them,
 * ~24s) was really "wait out `scrollThrottleMs`'s trailing edge", which
 * couples the spec to a tuning constant it does not own — turning that knob
 * flaked the spec with no spec change. Two frames is an event, not a guess:
 * scroll events are dispatched during the frame's own "run the scroll steps",
 * ahead of requestAnimationFrame callbacks, so the first frame proves the
 * rail's handler has seen this scroll and the second gives React's re-render a
 * frame to land. Nothing here waits for the *throttle* — every caller instead
 * follows a move with a retrying web-first assertion on the day it expects,
 * which waits out the trailing edge without naming a duration. This function
 * deliberately does not do that waiting itself: proving the rail does NOT emit
 * (the mount case) needs a move with no expectation attached.
 */
async function scrollRailTo(page: Page, scrollTop: number): Promise<void> {
  await page.evaluate(async (target) => {
    const rail = document.querySelector('[aria-label="Days"]')!;
    rail.scrollTop = target;
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  }, scrollTop);
}

test("map rail: scrolling tracks focus through every day", async ({ page }) => {
  // Fixture setup through the command API plus the full-rail scan exceeds
  // Playwright's default 30s per-test budget; this is a slow-but-worthwhile
  // browser test, not a hung one. Deliberately left generous rather than
  // trimmed to the new (much cheaper) scan: an unhit ceiling costs nothing,
  // and a tight one buys flakes on a loaded machine.
  test.setTimeout(90_000);
  // Distinct prefix from other specs' trip names — parallel workers share a DB.
  const tripName = e2eTripName("MapRail");
  await page.goto("/");
  const tripId = await createMappedTrip(page, tripName, DAY_COUNT);

  await page.goto(`/trips/${tripId}?lens=Map`);
  const rail = page.locator('[aria-label="Days"]');
  await expect(rail).toBeVisible();
  await expect(rail.getByRole("button")).toHaveCount(DAY_COUNT);

  /** Retrying, web-first: day `n` (1-based) is the one and only focused day. */
  const expectFocusedDay = async (n: number) => {
    await expect(rail.locator(`button[data-day-index="${n - 1}"]`)).toHaveAttribute("aria-current", "true");
    await expect(rail.locator('button[aria-current="true"]')).toHaveCount(1);
  };

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
  const maxScrollTop = scrollHeight - clientHeight;
  expect(maxScrollTop).toBeGreaterThan(expectedTravel - 40);
  expect(maxScrollTop).toBeLessThan(expectedTravel + 40);

  // -- scrolling from top to bottom visits every day, in order, none skipped --
  // This is the regression test for the two defects that made this feature
  // fail: focus that stuck on Day 1 mid-scroll, and a fixed focus line that
  // could never reach days near either end.
  await scrollRailTo(page, 0);

  // Record every focus change the rail *emits*, instead of sampling the DOM
  // once per scroll step. A MutationObserver cannot miss a day the way a
  // sampling loop can, which is the only thing the old 200-step scan was
  // buying — and it was buying it with 200 wall-clock sleeps. 3 samples per
  // day is then enough resolution for no scroll step to jump a whole day's
  // band (each band is ~1/DAY_COUNT of the geared range).
  //
  // Starts empty rather than seeded: MapRail deliberately never emits focus on
  // mount (see MapRail.tsx's "measure never emits focus" comment and the
  // design doc's "no emit on mount" invariant), so nothing carries
  // `aria-current` until the first real scroll event. Dedupes on the day
  // number, so an unrelated re-render while focus holds steady can't push a
  // spurious duplicate.
  await page.evaluate(() => {
    const rail = document.querySelector('[aria-label="Days"]')!;
    const log: number[] = [];
    (window as RailWindow).__railFocusLog = log;
    const record = () => {
      const active = rail.querySelector<HTMLElement>('button[aria-current="true"]');
      if (!active) return;
      // data-day-index is 0-based; the rendered label is 1-based (mapRailData).
      const day = Number(active.dataset.dayIndex) + 1;
      if (day !== log[log.length - 1]) log.push(day);
    };
    new MutationObserver(record).observe(rail, {
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-current"],
    });
    record();
  });

  // Walk the rail one day-band at a time, and do not advance until the rail
  // has actually reported that band. With n uniformly-spaced days the geared
  // range divides into n even bands (see the maxScrollTop assertion above), so
  // (i - 0.5)/n of the range is band i's centre.
  //
  // Why not a fixed sweep of DAY_COUNT * 3 pixel steps, which is what this was:
  // `evaluate()` only emits when the day it computes *differs from the last one
  // it emitted*, and the scroll handler is a leading+trailing throttle
  // (`scrollThrottleMs`, 50ms). Two frames per step is ~32ms, under that
  // window, so consecutive steps collapse into one trailing evaluation — and
  // that deferred evaluation reads whatever scrollTop is current when it
  // finally runs, not the position that scheduled it. When the collapsed span
  // crossed a whole band, the day in the middle was never a value of `next`,
  // so it was never emitted and there was nothing for the MutationObserver to
  // record. The old header's "an evaluation deferred to its trailing edge is
  // still recorded" was the wrong half of that: recorded, yes — but only the
  // position it lands on. That skipped a day in roughly half of runs, and
  // *which* day moved between them (KI-75).
  //
  // `expectFocusedDay` is a retrying web-first assertion, so this waits on the
  // rail's own emission rather than on a duration — no sleep, and no coupling
  // to the tuning constant the sleeps this file used to carry were guessing at.
  for (let day = 1; day <= DAY_COUNT; day++) {
    await scrollRailTo(page, ((day - 0.5) / DAY_COUNT) * maxScrollTop);
    await expectFocusedDay(day);
  }

  // Every band was awaited above, so the log is already complete; read it back
  // to prove the rail emitted each day once, in order, with none skipped.
  const dayNumbers = await page.evaluate(() => (window as RailWindow).__railFocusLog!);
  expect(dayNumbers).toEqual(Array.from({ length: DAY_COUNT }, (_, i) => i + 1));

  // -- the last day is reached at the bottom boundary --
  // The scan above already ends at (or past) the bottom, so re-setting
  // scrollTop to the same max value would fire no native `scroll` event and
  // this would tautologically re-read the scan's own last result. Dip away
  // from the bottom first so the following jump is a real, observed scroll.
  await scrollRailTo(page, Math.max(0, maxScrollTop - 500));
  await scrollRailTo(page, maxScrollTop);
  await expectFocusedDay(DAY_COUNT);

  // -- and the first day at the top --
  await scrollRailTo(page, 0);
  await expectFocusedDay(1);

  // -- clicking still focuses directly, unchanged by any of the above --
  // No settle wait: click's own scrollIntoViewIfNeeded can itself fire the
  // rail's throttled scroll handler, whose trailing edge could race the
  // click's direct onFocus call — which is exactly what a retrying assertion
  // absorbs and a fixed sleep only gambled on.
  await rail.getByRole("button").nth(6).click();
  await expectFocusedDay(7);
  // ...and the rendered label agrees with the data attribute the assertions
  // above key off, so a mis-numbered label can't hide behind them.
  await expect.poll(async () => dayNumberOf(await focusedDayLabel(page))).toBe(7);

  // -- Tab-ing onto an off-screen day button leaves it fully visible --
  // Regression test for a real bug found live during Task 6's tuning pass:
  // the clip div that pins the day list to the rail's viewport is a scroll
  // container as far as the browser's own keyboard-focus handling is
  // concerned, and its native "scroll the focused element into view" attempt
  // doesn't understand this rail's geared/transformed layout — left
  // unhandled, Tab-ing to an off-screen day left it completely clipped out of
  // view while holding keyboard focus (see MapRail.tsx's `focusin` handler
  // and design doc's "Sticky verification" section for the fix).
  await scrollRailTo(page, 0);
  await rail.getByRole("button").first().focus();
  for (let i = 0; i < 10; i++) await page.keyboard.press("Tab");
  // The fix runs on a deferred tick and then scrolls the rail, so the reveal
  // lands some frames after the last Tab. Poll the overflow in pixels — the
  // failure message then says how far out of the band the button was left,
  // which the old sleep-then-assert could not. 1px absorbs sub-pixel rounding.
  await expect
    .poll(() =>
      rail.evaluate((el) => {
        const clip = el.querySelector("[data-rail-track]")!.parentElement!;
        const active = document.activeElement!.getBoundingClientRect();
        const band = clip.getBoundingClientRect();
        return {
          clippedAbovePx: Math.max(0, Math.round(band.top - active.top - 1)),
          clippedBelowPx: Math.max(0, Math.round(active.bottom - band.bottom - 1)),
        };
      }),
    )
    .toEqual({ clippedAbovePx: 0, clippedBelowPx: 0 });
});

// Mitchell, 2026-09-01: *"When navigating to map view, always use the current
// select day, but if no day is selected, default to first day. Dont go to
// zoomed out full trip view."*
//
// The zoomed-out view was the mount camera — a static centre on the first
// located pin at zoom 9, which is what you got whenever no day was focused,
// because the camera effect had nothing to fit and held the viewport. Asserted
// through the RAIL's own current-day marker rather than through the camera:
// the map is a WebGL canvas with nothing to read, and the rail, the day strip
// and the camera are all driven by the same one selection — which is the point
// of fixing it by giving that selection a value rather than teaching the camera
// a second mode.
test("map: opens on the current day, and on the first one when none is chosen", async ({ page }) => {
  test.setTimeout(90_000);
  const tripName = e2eTripName("MapDefault");
  const tripId = await createMappedTrip(page, tripName, DAY_COUNT);

  // Straight to the map with nothing selected — a fresh load, so `focusedDay`
  // starts null exactly as it does for somebody clicking through to a trip.
  await page.goto(`/trips/${tripId}?lens=Map`);
  const rail = page.locator('[aria-label="Days"]');
  await expect(rail).toBeVisible();
  await expect.poll(async () => dayNumberOf(await focusedDayLabel(page))).toBe(1);

  // And a day picked elsewhere is the day the map opens on — the "always use
  // the current select day" half, which the default must not override.
  await page.goto(`/trips/${tripId}?lens=Board`);
  const columns = page.getByTestId("day-column");
  await expect(columns.first()).toBeVisible();
  await columns.nth(4).getByRole("button", { name: /^Day 5/ }).click();
  await page.getByRole("tab", { name: "Map" }).click();
  await expect(rail).toBeVisible();
  await expect.poll(async () => dayNumberOf(await focusedDayLabel(page))).toBe(5);
});

