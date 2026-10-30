import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures/test";
import { revokeSignupTrial } from "./adminBootstrap";
import { createMappedTrip, signInAsDevUser } from "./helpers";
import { e2eTripName, escapeForRegExp } from "./tripNames";

// Mitchell on production, 2026-10-30, at phone width: from Playbooks, Trips
// redrew the bottom bar without its last item and then it "flickers in", and
// "when you first click into a trip, the ai ask button isn't there then it
// renders in". The bar's Ask was drawn only once the screen below registered
// one (`usePhoneAskEntry`), which is after that screen's read, and never in the
// server HTML (KI-2026-10-13-a). It is drawn from the route now, so every frame
// after each move carries it: on Home, a trip, its notebook pages and the
// playbook pages with an assistant (PR 655, Mitchell: "Render everywhere, keep
// behavior consistent").
//
// Frames, not a wait: a locator retries until the item is there, which is the
// very gap being tested. An init script writes down the bar's items once per
// animation frame, and the walk asserts every frame on each new route.

test.use({ viewport: { width: 411, height: 852 } });

/** Starts writing down, per animation frame, the route and the bar's items in order. */
async function recordBar(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const record = window as unknown as { barFrames: string[] };
    record.barFrames = [];
    let last = "";
    const frame = () => {
      const bar = document.querySelector('nav[aria-label="Phone navigation"]');
      const items = bar === null ? "no bar" : Array.from(bar.querySelectorAll("a, button"), (item) => item.textContent).join("|");
      const line = `${location.pathname} ${items}`;
      if (line !== last) record.barFrames.push(line);
      last = line;
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
}

/**
 * What the bar drew on `pathname`, one entry per change. A full load's frames
 * before the bar has streamed in are left out: there is no bar to lack an Ask.
 */
async function barOn(page: Page, pathname: string): Promise<string[]> {
  const frames = await page.evaluate(() => (window as unknown as { barFrames: string[] }).barFrames);
  const drawn = frames.filter((line) => line.startsWith(`${pathname} `)).map((line) => line.slice(pathname.length + 1));
  const first = drawn.findIndex((items) => items !== "no bar");
  return first === -1 ? drawn : drawn.slice(first);
}

/** Holds the server render of every URL `pattern` matches back, so the walk sees the frames before it lands. */
async function slow(page: Page, pattern: RegExp): Promise<void> {
  await page.route(pattern, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    await route.continue();
  });
}

/** The bar's Ask, once the screen below has offered its own (until then it is drawn `data-pending`). */
function offeredAsk(page: Page) {
  return page.getByRole("navigation", { name: "Phone navigation" }).locator('[data-testid="ask-tab"]:not([data-pending])');
}

test("Playbooks to Trips to a trip and back to Playbooks draws the bar's Ask on every frame", async ({ page }) => {
  const name = e2eTripName("Shell first paint");
  const tripId = await createMappedTrip(page, name, 2);
  await recordBar(page);
  await page.goto("/playbooks");
  const bar = page.getByRole("navigation", { name: "Phone navigation" });
  await expect(offeredAsk(page)).toBeVisible();

  await bar.getByRole("link", { name: "Trips" }).click();
  await expect(page).toHaveURL(/\/home$/);
  await expect(offeredAsk(page)).toBeVisible();
  expect(await barOn(page, "/home")).toEqual(["Trips|Playbooks|Ask"]);

  await slow(page, new RegExp(`/trips/${tripId}`));
  // By its href, not its name, which is a pattern to escape.
  // Dispatched rather than aimed: a click at a point can land on whichever
  // card has moved there (seen twice on this walk, on another trip's).
  await page.locator(`a[href="/trips/${tripId}"]`).first().dispatchEvent("click");
  await expect(page).toHaveURL(new RegExp(`/trips/${tripId}`));
  await expect(offeredAsk(page)).toBeVisible();
  expect(await barOn(page, `/trips/${tripId}`)).toEqual(["Overview|Plan|Map|Notebook|Ask"]);

  // Home to Discover (PR 656 gives it a loading frame of its own): the Ask is
  // there for the whole read, not only once Discover has its days.
  await page.goto("/home");
  await slow(page, /\/playbooks(?:\?|$)/);
  await bar.getByRole("link", { name: "Playbooks" }).click();
  await expect(page).toHaveURL(/\/playbooks$/);
  await expect(offeredAsk(page)).toBeVisible();
  expect(await barOn(page, "/playbooks")).toEqual(["Trips|Playbooks|Ask"]);
});

// Mitchell, the same day: "always have button render on mobile, but when
// someone who isn't paying opens it and there isnt access, show a call to
// action to upgrade". The rail's own gate (`upgradeGated`, M21) is that call
// to action; what is new is that the button is there from the first paint, on
// every page with an assistant (PR 655).
test.describe("a free account", () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test.slow();

  let asked: string[] = [];

  test.beforeEach(async ({ page, browser }) => {
    const who = `m56free${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    await signInAsDevUser(page, who);
    await revokeSignupTrial(browser, `dev-${who}`);
    asked = [];
    page.on("request", (request) => {
      if (/\/ask$/.test(new URL(request.url()).pathname)) asked.push(request.url());
    });
  });

  /**
   * On `path`, every frame of the bar has the Ask; opening it offers plans,
   * and, where the rail suggests questions, one tapped asks nothing: it is
   * still offered, with no turn above it. Each test then says that nothing was
   * sent. (⌘K offers no *Ask:* row to this plan at all, and a new notebook
   * page's rail suggests nothing, so there the composer is the whole gate.)
   */
  async function askedNothingOn(page: Page, path: string, items: string, placeholder: RegExp, suggests = true): Promise<void> {
    await recordBar(page);
    await slow(page, new RegExp(escapeForRegExp(path)));
    await page.goto(path);
    await expect(offeredAsk(page)).toBeVisible();
    expect(await barOn(page, path)).toEqual([items]);

    await offeredAsk(page).click();
    const assistant = page.getByRole("complementary", { name: "Assistant" });
    await expect(assistant.getByRole("link", { name: "See plans" })).toHaveAttribute("href", "/plans");
    const composer = assistant.getByPlaceholder(placeholder);
    await expect(composer).toBeDisabled();

    if (!suggests) return;
    const suggested = assistant.getByRole("list", { name: "Suggested questions" });
    // Dispatched past Playwright's wait for an enabled control: the tap a
    // reader makes, which the gate, not the test, has to refuse.
    await suggested.getByRole("button").first().dispatchEvent("click");
    await expect(suggested).toBeVisible();
    await expect(assistant.getByRole("log", { name: "Conversation" })).toHaveCount(0);
  }

  test("has the trip's Ask in the first paint, and opening it offers plans and asks nothing", async ({ page }) => {
    const tripId = await createMappedTrip(page, e2eTripName("Shell free"), 1);
    await askedNothingOn(page, `/trips/${tripId}`, "Overview|Plan|Map|Notebook|Ask", /Ask about this trip/);
    expect(asked).toEqual([]);
  });

  test("has a notebook page's Ask in the first paint, and opening it offers plans and asks nothing", async ({ page }) => {
    const tripId = await createMappedTrip(page, e2eTripName("Shell free notebook"), 1);
    const created = await page.request.post(`/api/trips/${tripId}/pages`, {
      data: { title: "Food", context: { tripId }, content: { type: "doc", content: [{ type: "paragraph" }] } },
    });
    expect(created.ok()).toBe(true);
    const { id } = ((await created.json()) as { page: { id: string } }).page;
    await askedNothingOn(page, `/trips/${tripId}/pages/${id}`, "Overview|Plan|Map|Notebook|Ask", /Ask AI to add to this page/, false);
    expect(asked).toEqual([]);
  });

  test("has Discover's Ask in the first paint, and opening it offers plans and asks nothing", async ({ page }) => {
    await askedNothingOn(page, "/playbooks", "Trips|Playbooks|Ask", /Ask about this page/);
    expect(asked).toEqual([]);
  });
});
