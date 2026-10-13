import { randomUUID } from "node:crypto";
import type { Browser, Page } from "@playwright/test";
import { expect, test } from "./fixtures/test";
import { grantCollaborators } from "./adminBootstrap";
import { createMappedTrip } from "./helpers";
import { e2eTripName } from "./tripNames";

// M46: a trip has a conversation with the people taking it. Two real browser
// contexts, as suggester.spec.ts has them: the owner's page is open, a viewer
// posts from theirs, and the owner's page shows it within one poll of the
// events feed (`chatRev`, D4) without a reload. A viewer, because every
// member posts while the owner is entitled (D2).
//
// `newcomer` and `signedInAs` are suggester.spec.ts's, kept local as it keeps
// them.

function newcomer(prefix: string): string {
  return `${prefix}${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

// Signed out, onto the link, and in on the banked token (m11-invites' M11a note).
async function signedInAs(browser: Browser, username: string, link: string): Promise<Page> {
  const page = await (await browser.newContext({ storageState: undefined })).newPage();
  await page.goto(link);
  await page.getByRole("link", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/signin\?callbackUrl=%2Finvite%2F/);
  await page.getByLabel("Username").fill(username);
  await Promise.all([
    page.waitForURL((url) => !/^\/sign(in|up)$/.test(url.pathname)),
    page.getByRole("button", { name: /sign in with dev login/i }).click(),
  ]);
  return page;
}

function palette(page: Page) {
  return page.getByRole("dialog", { name: "Go to or do" });
}

// Inviting needs the owner's `trip.collaborators` (M20 link 6), and so does posting (D2).
test.beforeAll(async ({ browser }) => {
  await grantCollaborators(browser, "dev-alice");
});

test("a viewer's message reaches the owner's open page within one poll, and the owner's Ask counts it", async ({ page, browser }) => {
  // Two contexts, two sign-ins, two page loads: the budget suggester.spec.ts gives.
  test.slow();
  const tripName = e2eTripName("Chat");
  const tripId = await createMappedTrip(page, tripName, 1);
  const invite = await page.request.post(`/api/trips/${tripId}/invites`, { data: { email: null, role: "viewer" } });
  expect(invite.ok()).toBe(true);
  const { token } = ((await invite.json()) as { invite: { token: string } }).invite;

  const bea = await signedInAs(browser, newcomer("bea"), `/invite/${token}`);
  try {
    await bea.getByRole("button", { name: "Join the trip" }).click();
    await expect(bea.getByRole("heading", { name: tripName, level: 1 })).toBeVisible();

    // The owner's page, opened once the trip has two members, so it polls on a
    // timer, and never reloaded after this.
    await page.goto(`/trips/${tripId}?view=Plan`);
    await expect(page.getByRole("heading", { name: tripName, level: 1 })).toBeVisible();
    await expect(page.getByTestId("ask-pill")).toHaveAccessibleName("Ask or chat");

    // ⌘K's *Open chat* opens the panel on Chat.
    await bea.keyboard.press("ControlOrMeta+KeyK");
    await expect(palette(bea)).toBeVisible();
    await bea.keyboard.type("open chat");
    await expect(palette(bea).getByRole("option", { name: "Open chat", exact: true })).toBeVisible();
    await bea.keyboard.press("Enter");
    const beaPanel = bea.getByRole("complementary", { name: "Assistant" });
    await expect(beaPanel.getByRole("tab", { name: "Chat" })).toHaveAttribute("aria-selected", "true");

    const words = `Train at nine? ${randomUUID().slice(0, 8)}`;
    await beaPanel.getByRole("combobox", { name: "Message" }).fill(words);
    await Promise.all([
      bea.waitForResponse((r) => new URL(r.url()).pathname === `/api/trips/${tripId}/chat` && r.request().method() === "POST" && r.status() === 201),
      beaPanel.getByRole("button", { name: "Send" }).click(),
    ]);
    await expect(beaPanel.getByRole("list", { name: "Messages" })).toContainText(words);
  } finally {
    await bea.context().close();
  }

  // One 2s poll and the read it triggers; a reload would be ~0, so the bound
  // is generous but still far short of anything but the poll delivering it.
  await expect(page.getByTestId("ask-pill")).toHaveAccessibleName("Ask or chat, 1 unread message", { timeout: 10_000 });
  // One button for both (M46's preview walk): it opens on the tab last open,
  // Ask on this fresh browser, and the panel's tabs switch.
  await page.getByTestId("ask-pill").click();
  const panel = page.getByRole("complementary", { name: "Assistant" });
  await panel.getByRole("tab", { name: "Chat, 1 unread message" }).click();
  await expect(panel.getByRole("list", { name: "Messages" })).toContainText("Train at nine?");
  await expect(page.getByTestId("ask-pill")).toHaveAccessibleName("Ask or chat");
});

// M46 D3: a message can carry one day or stop. Its chip goes to it on Plan,
// and once the stop is deleted the words stay and the chip goes.
test("a message's @stop is a chip that focuses the stop on Plan, and plain text once the stop is deleted", async ({ page }) => {
  const tripName = e2eTripName("Chat chip");
  const tripId = await createMappedTrip(page, tripName, 1);
  const { trip } = (await (await page.request.get(`/api/trips/${tripId}`)).json()) as { trip: { days: { activityIds: string[] }[] } };
  const stopId = trip.days[0]!.activityIds[0]!;

  await page.goto(`/trips/${tripId}?view=Overview`);
  await expect(page.getByRole("heading", { name: tripName, level: 1 })).toBeVisible();
  // A trip with one member: the one button opens on Ask, and Chat is its tab.
  await page.getByTestId("ask-pill").click();
  const panel = page.getByRole("complementary", { name: "Assistant" });
  await panel.getByRole("tab", { name: "Chat" }).click();
  const field = panel.getByRole("combobox", { name: "Message" });
  await field.pressSequentially("Meet at @stop on day");
  await expect(panel.getByRole("option", { name: /Stop on day 1/ })).toBeVisible();
  await field.press("Enter");
  await expect(field).toHaveValue("Meet at @Stop on day 1 ");
  await Promise.all([
    page.waitForResponse((r) => new URL(r.url()).pathname === `/api/trips/${tripId}/chat` && r.request().method() === "POST" && r.status() === 201),
    field.press("Enter"),
  ]);

  const messages = panel.getByRole("list", { name: "Messages" });
  await messages.getByRole("button", { name: "@Stop on day 1" }).click();
  await expect(page).toHaveURL(/view=Plan/);
  await expect(page.getByTestId(`activity-card-${stopId}`).getByRole("button", { name: /^Edit / })).toBeFocused();

  const removed = await page.request.post(`/api/trips/${tripId}/commands`, { data: { type: "RemoveActivity", tripId, activityId: stopId } });
  expect(removed.ok()).toBe(true);
  await page.reload();
  await expect(page.getByRole("heading", { name: tripName, level: 1 })).toBeVisible();
  await page.getByTestId("ask-pill").click();
  await panel.getByRole("tab", { name: "Chat" }).click();
  await expect(messages).toContainText("Meet at @Stop on day 1");
  await expect(messages.getByRole("button", { name: "@Stop on day 1" })).toHaveCount(0);
});
