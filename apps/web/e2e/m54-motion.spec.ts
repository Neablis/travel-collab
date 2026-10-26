import type { CDPSession, Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures/test";
import { e2eTripName } from "./tripNames";

// M54 (ADR-082 §6): the suite runs with reduced motion, so no other spec ever
// sees an overlay mid-exit. This one turns motion back on to prove what that
// hides: a leaving overlay takes no click and holds no focus, and a pending
// button keeps its box.
//
// **No test here waits on an animation.** The exit is frozen instead: CDP sets
// the document timeline's playback rate to 0 before the overlay closes, so the
// leaving node stays exactly where it is for as long as the assertions take,
// and released afterwards, Radix unmounts it on its `animationend`.
test.use({ reducedMotion: "no-preference" });

async function freezeAnimations(page: Page): Promise<CDPSession> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Animation.enable");
  await cdp.send("Animation.setPlaybackRate", { playbackRate: 0 });
  return cdp;
}

// The overlay that is leaving (`data-state="closed"` and still mounted): is it
// inert, does focus sit inside it, and would a click at its centre land on any
// overlay (its scrim included) rather than on the page beneath?
async function leavingOverlay(page: Page, role: "dialog" | "menu") {
  return page.evaluate((r) => {
    const node = document.querySelector(`[role="${r}"][data-state="closed"]`);
    if (!(node instanceof HTMLElement)) return null;
    const box = node.getBoundingClientRect();
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return {
      inert: node.inert,
      holdsFocus: node.contains(document.activeElement),
      takesClick: hit !== null && hit.closest("[data-motion]") !== null,
    };
  }, role);
}

// A trip of its own, so Home has its grid (and its import link), and so the
// trip page has a header.
async function aTrip(page: Page, prefix: string): Promise<string> {
  const name = e2eTripName(prefix);
  const created = await page.request.post("/api/trips", { data: { name } });
  expect(created.ok(), `POST /api/trips -> ${created.status()}`).toBe(true);
  return ((await created.json()) as { tripId: string }).tripId;
}

test("the account menu (a popover) leaves without taking a click or holding focus", async ({ page }) => {
  await page.goto("/home");
  await page.getByRole("button", { name: /^Account menu/ }).click();
  await expect(page.getByRole("dialog", { name: /^Account menu/ })).toBeVisible();

  const cdp = await freezeAnimations(page);
  await page.keyboard.press("Escape");
  expect(await leavingOverlay(page, "dialog")).toEqual({ inert: true, holdsFocus: false, takesClick: false });

  await cdp.send("Animation.setPlaybackRate", { playbackRate: 1 });
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

// The `Menu` primitive's one header use is the phone's `⋯`.
test("a menu leaves without taking a click or holding focus", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const tripId = await aTrip(page, "MotionMenu");
  await page.goto(`/trips/${tripId}`);
  await page.getByRole("button", { name: "Trip actions" }).click();
  await expect(page.getByRole("menuitem", { name: "History" })).toBeVisible();

  const cdp = await freezeAnimations(page);
  await page.keyboard.press("Escape");
  expect(await leavingOverlay(page, "menu")).toEqual({ inert: true, holdsFocus: false, takesClick: false });

  await cdp.send("Animation.setPlaybackRate", { playbackRate: 1 });
  await expect(page.getByRole("menu")).toHaveCount(0);
});

test("a dialog (⌘K) leaves without it or its scrim taking a click or holding focus", async ({ page }) => {
  await page.goto("/home");
  await expect(page.getByRole("heading", { level: 1, name: "Your trips" })).toBeVisible();

  await page.keyboard.press("ControlOrMeta+KeyK");
  await expect(page.getByRole("dialog", { name: "Go to or do" })).toBeVisible();

  const cdp = await freezeAnimations(page);
  await page.keyboard.press("Escape");
  expect(await leavingOverlay(page, "dialog")).toEqual({ inert: true, holdsFocus: false, takesClick: false });

  await cdp.send("Animation.setPlaybackRate", { playbackRate: 1 });
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

// M54 decision 2: "nothing like 'Press me' -> 'pressed .......'". The import
// link is the one control on `pending` in this part; the request is held open
// so the pending state lasts as long as the measuring does.
test("a pending button's box is the same before, during and after", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/v1/trips/import", async (route) => {
    await held;
    await route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: "invalid-bundle", message: "This file contains no trip to import." } }),
    });
  });
  await aTrip(page, "MotionPending");
  await page.goto("/home");

  const button = page.getByRole("button", { name: /^(Import a trip file|Importing…)$/ });
  await expect(button).toBeVisible();
  // Size only: the page above the link is still settling as it loads, and the
  // refusal banner lands above it later, so its position moves for reasons
  // that are not the button's.
  const size = async () => {
    const box = (await button.boundingBox())!;
    return { width: box.width, height: box.height };
  };
  const before = await size();

  await page.getByTestId("trip-file-input").setInputFiles({
    name: "trip.json",
    mimeType: "application/json",
    buffer: Buffer.from("{}"),
  });
  await expect(button).toHaveAttribute("aria-busy", "true");
  await expect(button).toHaveAccessibleName("Importing…");
  expect(await size()).toEqual(before);

  release();
  await expect(page.getByRole("alert").filter({ hasText: "no trip to import" })).toBeVisible();
  await expect(button).not.toHaveAttribute("aria-busy");
  expect(await size()).toEqual(before);
});

// M54 decision 11: one indicator per tab list, measured onto the active tab.
// How far the indicator sits from the box it should cover, in whole pixels.
// Every running animation is finished first, so the slide is read at its end
// rather than waited out.
async function indicatorOffset(page: Page, list: string, active: string) {
  return page.evaluate(
    ([listSelector, activeSelector]) => {
      // A skeleton's breathing loops forever, and cannot be finished.
      for (const animation of document.getAnimations()) {
        if (animation.effect?.getComputedTiming().endTime !== Infinity) animation.finish();
      }
      const indicator = document.querySelector(`${listSelector} [data-testid="tab-indicator"]`);
      const target = document.querySelector(`${listSelector} ${activeSelector}`);
      if (indicator === null || target === null) return null;
      const a = indicator.getBoundingClientRect();
      const b = target.getBoundingClientRect();
      return { x: Math.round(a.x - b.x), y: Math.round(a.y - b.y), width: Math.round(a.width - b.width) };
    },
    [list, active] as const,
  );
}

const UNDER = { x: 0, y: 0, width: 0 };

// The server's HTML already marks the active tab; the indicator is placed
// once the page hydrates, and says so.
async function placed(indicator: Locator) {
  await expect(indicator).toHaveAttribute("data-placed", "");
}

test("the trip tabs' indicator moves under the tab you switch to", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const tripId = await aTrip(page, "MotionTabs");
  await page.goto(`/trips/${tripId}`);
  const list = '[role="tablist"][aria-label="Trip view"]';
  await placed(page.getByRole("tablist", { name: "Trip view" }).getByTestId("tab-indicator"));
  await expect(page.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
  expect(await indicatorOffset(page, list, '[aria-selected="true"]')).toEqual(UNDER);

  await page.getByRole("tab", { name: "Calendar" }).click();
  await expect(page.getByRole("tab", { name: "Calendar" })).toHaveAttribute("aria-selected", "true");
  expect(await indicatorOffset(page, list, '[aria-selected="true"]')).toEqual(UNDER);
});

// The phone bar's tabs are `flex-1`, so a wider window moves every one of them
// without a render: only the ResizeObserver brings the pill along.
test("the phone tab bar's pill follows a switch and a resize", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const tripId = await aTrip(page, "MotionPill");
  await page.goto(`/trips/${tripId}`);
  const bar = page.getByRole("navigation", { name: "Phone navigation" });
  const list = 'nav[aria-label="Phone navigation"]';
  const pill = 'a[aria-current="page"] [data-testid="phone-tab-pill"]';
  await placed(bar.getByTestId("tab-indicator"));

  await bar.getByRole("link", { name: "Plan" }).click();
  await expect(bar.getByRole("link", { name: "Plan" })).toHaveAttribute("aria-current", "page");
  expect(await indicatorOffset(page, list, pill)).toEqual(UNDER);

  await page.setViewportSize({ width: 700, height: 844 });
  await expect.poll(() => indicatorOffset(page, list, pill)).toEqual(UNDER);
});
