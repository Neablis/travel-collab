import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures/test";
import { createMappedTrip, forget, publishedDay, signInAsDevUser, stranger } from "./helpers";
import { e2eTripName } from "./tripNames";

// M45 D9, against the simulated model: a playbook day has an assistant of its
// own, closed until Ask opens it. It answers about the day on screen, and
// presses the page's own buttons for you: *add it to a trip, on a day* (the
// trip and day as you named them) and *start a trip with it*, each on a card
// that does nothing until Approve.

const ASK = /\/api\/ask$/;

function rail(page: Page) {
  return page.getByRole("complementary", { name: "Assistant" });
}

async function ask(page: Page, text: string) {
  const composer = rail(page).getByPlaceholder("Ask about this page…");
  await Promise.all([
    page.waitForResponse((r) => ASK.test(new URL(r.url()).pathname)),
    composer.fill(text).then(() => composer.press("Enter")),
  ]);
}

/** The trip as the server holds it, as this signed-in user reads it. */
async function tripDetail(page: Page, tripId: string) {
  const res = await page.request.get(`/api/trips/${tripId}`);
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { trip: { name: string; days: { activityIds: string[] }[]; activities: Record<string, { title: string }> } }).trip;
}

let city = "";
let dayName = "";
let savedDayId = "";
let tripName = "";
let tripId = "";

test.beforeEach(async ({ page }) => {
  test.slow();
  await page.goto("/");
  // A city nobody else has published into, so the stop's title is this run's.
  city = `Kyoto${randomUUID().replace(/-/g, "").slice(0, 8)}`;
  // Named as a test trip, so the trip "start a trip with this day" makes is
  // swept with the rest (`global.teardown.ts`).
  dayName = e2eTripName("Temple morning");
  savedDayId = await publishedDay(page, city, dayName);
  tripName = e2eTripName("Kyoto");
  tripId = await createMappedTrip(page, tripName, 3);
  await page.goto(`/playbooks/day/${savedDayId}`);
});

test.afterEach(async ({ page }) => {
  await forget(page, savedDayId);
});

test("on a playbook day the assistant opens on Ask, says what the day covers, and adds it to the trip and day named", async ({ page }) => {
  await expect(rail(page)).toBeHidden();
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(rail(page)).toBeVisible();

  const log = rail(page).getByRole("log", { name: "Conversation" });
  await ask(page, "what does this day cover?");
  await expect(log).toContainText(`Stop in ${city}`);

  await ask(page, `add this to my ${tripName} trip on day 3`);
  const card = rail(page).getByRole("group", { name: "Suggested change" });
  await expect(card).toContainText(`to ${tripName} on day 3`);
  // Nothing has happened yet: the card is the whole of it until Approve.
  expect((await tripDetail(page, tripId)).days[2]!.activityIds).toHaveLength(1);

  await card.getByRole("button", { name: "Make the change" }).click();
  await expect(page).toHaveURL(new RegExp(`/trips/${tripId}`));
  const trip = await tripDetail(page, tripId);
  expect(trip.days).toHaveLength(3);
  expect(trip.days[2]!.activityIds.map((id) => trip.activities[id]!.title)).toContain(`Stop in ${city}`);
});

test("asked to start a trip with this day, the assistant drafts it and Approve creates it", async ({ page }) => {
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await ask(page, "start a trip with this day");
  const card = rail(page).getByRole("group", { name: "Suggested change" });
  await expect(card).toContainText(`Start a trip called “${dayName}”`);

  await card.getByRole("button", { name: "Make the change" }).click();
  await expect(page).toHaveURL(/\/trips\/[0-9a-f-]{36}/);
  const created = new URL(page.url()).pathname.split("/")[2]!;
  expect(created).not.toBe(tripId);
  const trip = await tripDetail(page, created);
  expect(trip.name).toBe(dayName);
  expect(trip.days[0]!.activityIds.map((id) => trip.activities[id]!.title)).toEqual([`Stop in ${city}`]);
});

// Mitchell's decision 3 (2026-10-13), "send the plan with the page": the Ask
// is in the HTML the server sends for a reader whose plan has the assistant,
// so it is there on the first paint rather than after a read, and it is never
// in it for a reader whose plan has not. The raw response, before any script.
test("the day's Ask is in the server's HTML for a plan with the assistant, and not for a free one", async ({ page, browser }) => {
  const ASK_PILL = 'data-testid="ask-pill"';
  const entitled = await page.request.get(`/playbooks/day/${savedDayId}`);
  expect(await entitled.text()).toContain(ASK_PILL);

  const free = await stranger(browser);
  await signInAsDevUser(free, `m45free${randomUUID().replace(/-/g, "").slice(0, 12)}`);
  const unentitled = await free.request.get(`/playbooks/day/${savedDayId}`);
  const html = await unentitled.text();
  // The day itself is there, so the absence is the Ask's and not the page's.
  expect(html).toContain(dayName);
  expect(html).not.toContain(ASK_PILL);
  await free.context().close();
});
