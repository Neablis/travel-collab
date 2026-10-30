import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures/test";
import { revokeSignupTrial } from "./adminBootstrap";
import { createMappedTrip, signInAsDevUser } from "./helpers";
import { e2eTripName } from "./tripNames";

// Mitchell on production, 2026-10-30, at phone width: from Playbooks, Trips
// redrew the bottom bar without its last item and then it "flickers in", and
// "when you first click into a trip, the ai ask button isn't there then it
// renders in". The bar's Ask was drawn only once the screen below registered
// one (`usePhoneAskEntry`), which is after that screen's read, and never in the
// server HTML (KI-2026-10-13-a). It is drawn from the route now, so every frame
// after each move carries it.
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

/** What the bar drew on `pathname`, one entry per change. */
async function barOn(page: Page, pathname: string): Promise<string[]> {
  const frames = await page.evaluate(() => (window as unknown as { barFrames: string[] }).barFrames);
  return frames.filter((line) => line.startsWith(`${pathname} `)).map((line) => line.slice(pathname.length + 1));
}

/** Holds the trip's server render back, so the walk sees the frames before it lands. */
async function slowTrip(page: Page, tripId: string): Promise<void> {
  await page.route(new RegExp(`/trips/${tripId}`), async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    await route.continue();
  });
}

test("Playbooks to Trips to a trip draws the bar's Ask on every frame", async ({ page }) => {
  const name = e2eTripName("Shell first paint");
  const tripId = await createMappedTrip(page, name, 2);
  await recordBar(page);
  await page.goto("/playbooks");
  const bar = page.getByRole("navigation", { name: "Phone navigation" });
  await expect(bar.getByTestId("ask-tab")).toBeEnabled();

  await bar.getByRole("link", { name: "Trips" }).click();
  await expect(page).toHaveURL(/\/home$/);
  await expect(bar.getByTestId("ask-tab")).toBeEnabled();
  expect(await barOn(page, "/home")).toEqual(["Trips|Playbooks|Ask"]);

  await slowTrip(page, tripId);
  await page.getByRole("link", { name: new RegExp(name.replace(/[[\]]/g, "\\$&")) }).first().click();
  await expect(page).toHaveURL(new RegExp(`/trips/${tripId}`));
  await expect(bar.getByTestId("ask-tab")).toBeEnabled();
  expect(await barOn(page, `/trips/${tripId}`)).toEqual(["Overview|Plan|Map|Notebook|Ask"]);
});

// Mitchell, the same day: "always have button render on mobile, but when
// someone who isn't paying opens it and there isnt access, show a call to
// action to upgrade". The rail's own gate (`upgradeGated`, M21) is that call
// to action; what is new is that the button is there from the first paint.
test.describe("a free account", () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test.slow();

  test("has the trip's Ask in the first paint, and opening it offers plans and asks nothing", async ({ page, browser }) => {
    const who = `m56free${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    await signInAsDevUser(page, who);
    await revokeSignupTrial(browser, `dev-${who}`);
    const tripId = await createMappedTrip(page, e2eTripName("Shell free"), 1);
    const asked: string[] = [];
    page.on("request", (request) => {
      if (/\/ask$/.test(new URL(request.url()).pathname)) asked.push(request.url());
    });

    await recordBar(page);
    await page.goto(`/trips/${tripId}`);
    const ask = page.getByRole("navigation", { name: "Phone navigation" }).getByTestId("ask-tab");
    await expect(ask).toBeEnabled();
    expect(await barOn(page, `/trips/${tripId}`)).toEqual(["Overview|Plan|Map|Notebook|Ask"]);

    await ask.click();
    const assistant = page.getByRole("complementary", { name: "Assistant" });
    await expect(assistant.getByRole("link", { name: "See plans" })).toHaveAttribute("href", "/plans");
    await expect(assistant.getByPlaceholder(/Ask about this/)).toBeDisabled();
    expect(asked).toEqual([]);
  });
});
