import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures/test";
import { boardHydrated } from "./helpers";
import { e2eTripName } from "./tripNames";

// M54 (ADR-082 §6): the suite runs with reduced motion, so no other spec ever
// sees an overlay mid-exit. This one turns motion back on to prove what that
// hides: a leaving overlay takes no click and holds no focus, and a pending
// button keeps its box.
//
// **No test here waits on an animation.** The exit is frozen instead: CDP sets
// the document timeline's playback rate to 0 before the overlay closes, so the
// leaving node stays exactly where it is for as long as the assertions take.
// It is never released: that the exit will end is read off the node (a CSS
// animation on a real `@keyframes`, which fires `animationend`), not waited for.
test.use({ reducedMotion: "no-preference" });

async function freezeAnimations(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Animation.enable");
  await cdp.send("Animation.setPlaybackRate", { playbackRate: 0 });
}

// The overlay that is leaving (`data-state="closed"` and still mounted): is it
// inert, does focus sit inside it, would a click at its centre land on any
// overlay (its scrim included) rather than on the page beneath, and which exit
// is it playing? A keyframe name that matched nothing would leave no animation
// here, and Radix would hold the node for good.
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
      exit: node.getAnimations().map((a) => (a as CSSAnimation).animationName),
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

// The phone header draws its `⋯` once as a desktop header would, then again in
// its phone place once `useIsPhone` corrects in an effect, which is a new
// button (KI-2026-10-26-u). Focused or clicked before that, the trigger these
// tests hold is replaced under them. The trip's status badge is drawn in the
// phone's row by the same correction, so its showing means the `⋯` has moved.
async function phoneHeaderSettled(page: Page) {
  await expect(page.getByText("Active", { exact: true })).toBeVisible();
}

test("the account menu (a popover) leaves without taking a click or holding focus", async ({ page }) => {
  await page.goto("/home");
  await page.getByRole("button", { name: /^Account menu/ }).click();
  await expect(page.getByRole("dialog", { name: /^Account menu/ })).toBeVisible();

  await freezeAnimations(page);
  await page.keyboard.press("Escape");
  expect(await leavingOverlay(page, "dialog")).toEqual({
    inert: true,
    holdsFocus: false,
    takesClick: false,
    exit: ["tc-sink-out"],
  });
  // Back on the opener for the exit, not parked on `<body>` until it ends.
  await expect(page.getByRole("button", { name: /^Account menu/ })).toBeFocused();
});

// The `Menu` primitive's one header use is the phone's `⋯`. Opened by mouse,
// its trigger never had focus (MenuTrigger cancels the pointerdown), and focus
// still goes to it the moment the menu closes.
test("a menu leaves without taking a click or holding focus", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const tripId = await aTrip(page, "MotionMenu");
  await page.goto(`/trips/${tripId}`);
  await phoneHeaderSettled(page);
  await page.getByRole("button", { name: "Trip actions" }).click();
  await expect(page.getByRole("menuitem", { name: "History" })).toBeVisible();

  await freezeAnimations(page);
  await page.keyboard.press("Escape");
  expect(await leavingOverlay(page, "menu")).toEqual({
    inert: true,
    holdsFocus: false,
    takesClick: false,
    exit: ["tc-sink-out"],
  });
  await expect(page.getByRole("button", { name: "Trip actions" })).toBeFocused();
});

// Spec §3: focus moves without waiting for the exit, so a Tab straight after
// Escape starts from the trigger. The menu is modal, so its trigger is under
// the page's `aria-hidden` until the unmount, and that must not keep focus off it.
test("a menu opened by keyboard gives focus back to its trigger the moment it closes", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const tripId = await aTrip(page, "MotionMenuKeys");
  await page.goto(`/trips/${tripId}`);
  await boardHydrated(page);
  await phoneHeaderSettled(page);
  const trigger = page.getByRole("button", { name: "Trip actions" });
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menuitem", { name: "History" })).toBeVisible();

  await freezeAnimations(page);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveAttribute("data-state", "closed");
  await expect(trigger).toBeFocused();
});

// Opened from a focused control, so there is an opener to go back to, and it
// is under the modal's `aria-hidden` when the dialog closes.
test("a dialog (⌘K) leaves without it or its scrim taking a click or holding focus", async ({ page }) => {
  await page.goto("/home");
  await expect(page.getByRole("heading", { level: 1, name: "Your trips" })).toBeVisible();
  const opener = page.getByRole("button", { name: /^Account menu/ });
  await opener.focus();

  await page.keyboard.press("ControlOrMeta+KeyK");
  await expect(page.getByRole("dialog", { name: "Go to or do" })).toBeVisible();

  await freezeAnimations(page);
  await page.keyboard.press("Escape");
  expect(await leavingOverlay(page, "dialog")).toEqual({
    inert: true,
    holdsFocus: false,
    takesClick: false,
    exit: ["tc-sink-out"],
  });
  await expect(opener).toBeFocused();

  // Reopened within the exit (the timeline is still frozen), Radix keeps the
  // content mounted and autofocuses only on mount: what is typed must still
  // reach the palette, not the opener the page hides again.
  await page.keyboard.press("ControlOrMeta+KeyK");
  await expect(page.getByRole("dialog", { name: "Go to or do" })).toHaveAttribute("data-state", "open");
  await page.keyboard.type("cal");
  await expect(page.getByRole("combobox", { name: "Go to or do" })).toHaveValue("cal");
});

// ADR-082 §2, decision 20: under reduced motion nothing animates, so Radix
// unmounts an overlay as soon as it closes, and every other spec relies on it
// (`playwright.config.ts` runs them all at reduce). The timeline is frozen, so
// an exit that still ran would hold the dialog for good, not for 120ms.
test.describe("under reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("a dialog (⌘K) is gone the moment it closes", async ({ page }) => {
    await page.goto("/home");
    await expect(page.getByRole("heading", { level: 1, name: "Your trips" })).toBeVisible();

    await page.keyboard.press("ControlOrMeta+KeyK");
    await expect(page.getByRole("dialog", { name: "Go to or do" })).toBeVisible();

    await freezeAnimations(page);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
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

// Mitchell's M54 phone walk: "The ask button keeps disappearing and
// reappearing when I switch between the other tabs." Board and Notebook are
// different paths, so the screen that offered the Ask unmounts behind a
// loading boundary before the next one offers its own. The item holds its
// place across that gap: watched for every DOM change rather than sampled, so
// a drop of any length is seen.
test("the phone tab bar's Ask never leaves the bar across Board, Notebook and back", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const tripId = await aTrip(page, "MotionAsk");
  await page.goto(`/trips/${tripId}`);
  await boardHydrated(page);
  const bar = page.getByRole("navigation", { name: "Phone navigation" });
  const ask = bar.getByTestId("ask-tab");
  await expect(ask).toBeEnabled();
  await page.evaluate(() => {
    const w = window as unknown as { askDrops: number };
    w.askDrops = 0;
    new MutationObserver(() => {
      if (document.querySelector('nav[aria-label="Phone navigation"] > [data-testid="ask-tab"]:last-child') === null) w.askDrops += 1;
    }).observe(document.body, { childList: true, subtree: true });
  });

  await bar.getByRole("link", { name: "Notebook" }).click();
  await expect(page).toHaveURL(new RegExp(`/trips/${tripId}/pages$`));
  await expect(ask).toBeEnabled();
  await bar.getByRole("link", { name: "Plan" }).click();
  await expect(page).toHaveURL(new RegExp(`/trips/${tripId}\\?view=Plan$`));
  await boardHydrated(page);
  await expect(ask).toBeEnabled();

  expect(await page.evaluate(() => (window as unknown as { askDrops: number }).askDrops)).toBe(0);
});
