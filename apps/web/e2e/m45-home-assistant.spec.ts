import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures/test";
import { createMappedTrip } from "./helpers";
import { e2eTripName } from "./tripNames";

// M45 D6 and D7, against the simulated model: Home has an assistant rail of
// its own, closed until Ask opens it (Mitchell, 2026-10-12, as the trip
// board's), answering across your trips through the account door
// (`POST /api/ask`), and ⌘K hands it text that matches no command, opening it.
// Its unsent draft survives Hide and a reload (KI-2026-10-12-g).

const ACCOUNT_ASK = /\/api\/ask$/;

function rail(page: Page) {
  return page.getByRole("complementary", { name: "Assistant" });
}

/** Home's head's Ask; `exact`, as the open rail's send button is "Ask the assistant". */
async function openRail(page: Page) {
  await expect(rail(page)).toBeHidden();
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(rail(page)).toBeVisible();
}

let tripName = "";
let tripId = "";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  // A trip with places on it, so "which city" has one to name. Specs share
  // the dev user, so which city comes top is not this spec's to assert.
  tripName = e2eTripName("Home ask");
  tripId = await createMappedTrip(page, tripName, 2);
  await page.goto("/");
});

// D6's walk: the reply names Home's own ⌘K command for that trip's Map view
// (ADR-072 §6), and the page runs it.
test("asked to open a trip on the map, Home's rail lands on that trip's Map view", async ({ page }) => {
  await openRail(page);
  const composer = rail(page).getByPlaceholder("Ask about your trips…");
  await composer.fill(`open my ${tripName} trip on the map`);
  await composer.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/trips/${tripId}\\?view=Map$`));
});

test("Home's rail opens on Ask, asks across your trips, and Hide closes it", async ({ page }) => {
  await openRail(page);
  const composer = rail(page).getByPlaceholder("Ask about your trips…");

  const [request] = await Promise.all([
    page.waitForRequest((r) => ACCOUNT_ASK.test(new URL(r.url()).pathname)),
    composer.fill("which city have I been to most").then(() => composer.press("Enter")),
  ]);
  expect((JSON.parse(request.postData() ?? "{}") as { scope: unknown }).scope).toEqual({ kind: "account" });
  await expect(rail(page).getByRole("log", { name: "Conversation" })).toContainText("you've been to most is");
  await rail(page).getByRole("button", { name: "Hide" }).click();
  await expect(rail(page)).toBeHidden();
});

test("⌘K offers Ask: for text that matches nothing, and opens the closed rail with it", async ({ page }) => {
  await expect(page.getByRole("button", { name: "Ask", exact: true })).toBeVisible();
  await expect(rail(page)).toBeHidden();
  await page.keyboard.press("ControlOrMeta+KeyK");
  const palette = page.getByRole("dialog", { name: "Go to or do" });
  await expect(palette).toBeVisible();
  await page.keyboard.type("which country have I been to most");
  await expect(palette.getByRole("option", { name: "Ask: which country have I been to most" })).toBeVisible();

  await Promise.all([page.waitForRequest((r) => ACCOUNT_ASK.test(new URL(r.url()).pathname)), page.keyboard.press("Enter")]);
  await expect(palette).toBeHidden();
  const log = rail(page).getByRole("log", { name: "Conversation" });
  await expect(log).toContainText("which country have I been to most");
  await expect(log).toContainText("you've been to most is");
  // Sent once: one question and one answer in the log.
  await expect(log.getByText("which country have I been to most", { exact: true })).toHaveCount(1);
});

test("a question typed and not sent is still there after Hide and a reload", async ({ page }) => {
  await openRail(page);
  const composer = rail(page).getByPlaceholder("Ask about your trips…");
  await composer.fill("where should I go next");
  // Stored a moment after the last keystroke; wait for it rather than a clock.
  // Under the signed-in user's id (`ownedAskName`), which this spec does not know.
  const draft = () =>
    page.evaluate(() => Object.entries(window.localStorage).find(([key]) => key.startsWith("ask_draft_v1:") && key.endsWith(":account"))?.[1] ?? null);
  await expect.poll(draft).toBe("where should I go next");

  await rail(page).getByRole("button", { name: "Hide" }).click();
  await openRail(page);
  await expect(rail(page).getByPlaceholder("Ask about your trips…")).toHaveValue("where should I go next");

  await page.reload();
  await openRail(page);
  await expect(rail(page).getByPlaceholder("Ask about your trips…")).toHaveValue("where should I go next");
});

// Mitchell, 2026-10-12, at 644px: the tab bar's Ask "is highlighted when not
// open, making it look like it's active". Its pill takes the active tab's fill
// only while the sheet is up. Compared with the bar's own tabs rather than a
// colour, so a re-skin moves both sides together.
test("the tab bar's Ask looks like an inactive tab until the sheet is open", async ({ page }) => {
  await page.setViewportSize({ width: 644, height: 900 });
  const bar = page.getByRole("navigation", { name: "Phone navigation" });
  const fill = (tab: Locator) => tab.getByTestId("phone-tab-pill").evaluate((pill) => getComputedStyle(pill).backgroundColor);
  // By test id: the open sheet is modal, which takes the bar out of the
  // accessibility tree, so a role locator would no longer find it.
  const askTab = page.getByTestId("ask-tab");
  const current = await fill(bar.getByRole("link", { name: "Trips" }));
  const notCurrent = await fill(bar.getByRole("link", { name: "Playbooks" }));
  expect(current).not.toBe(notCurrent);
  await expect(askTab).toHaveAttribute("aria-expanded", "false");
  expect(await fill(askTab)).toBe(notCurrent);

  await askTab.click();
  await expect(rail(page)).toBeVisible();
  await expect(askTab).toHaveAttribute("aria-expanded", "true");
  expect(await fill(askTab)).toBe(current);
});
