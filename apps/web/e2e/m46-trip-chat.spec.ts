import { randomUUID } from "node:crypto";
import type { Browser, Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures/test";
import { E2E_SUPER_CODE } from "./admission";
import { E2E_ADMIN_USERNAME, grantCollaborators } from "./adminBootstrap";
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

// The configured operator, admitted on the super code (m12-moderation's `signedInAs`).
async function operator(browser: Browser): Promise<Page> {
  const page = await (await browser.newContext({ storageState: undefined })).newPage();
  await page.goto("/signup");
  await page.getByLabel("Invite code").fill(E2E_SUPER_CODE);
  await page.getByLabel("Username").fill(E2E_ADMIN_USERNAME);
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
  let read: Awaited<ReturnType<Locator["boundingBox"]>> = null;
  try {
    await bea.getByRole("button", { name: "Join the trip" }).click();
    await expect(bea.getByRole("heading", { name: tripName, level: 1 })).toBeVisible();

    // The owner's page, opened once the trip has two members, so it polls on a
    // timer, and never reloaded after this.
    await page.goto(`/trips/${tripId}?view=Plan`);
    await expect(page.getByRole("heading", { name: tripName, level: 1 })).toBeVisible();
    await expect(page.getByTestId("ask-pill")).toHaveAccessibleName("Ask or chat");
    read = await page.getByTestId("ask-pill").boundingBox();

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
  // A dot on the corner, out of flow: the pill's box is the one it had with
  // nothing unread, so the header does not reflow (Mitchell, M46 walk).
  await expect(page.getByTestId("ask-pill-unread")).toBeVisible();
  expect(read).not.toBeNull();
  expect(await page.getByTestId("ask-pill").boundingBox()).toEqual(read);
  // One button for both (M46's preview walk): it opens on the tab last open,
  // Ask on this fresh browser, and the panel's tabs switch.
  await page.getByTestId("ask-pill").click();
  const panel = page.getByRole("complementary", { name: "Assistant" });
  await panel.getByRole("tab", { name: "Chat, 1 unread message" }).click();
  await expect(panel.getByRole("list", { name: "Messages" })).toContainText("Train at nine?");
  await expect(page.getByTestId("ask-pill")).toHaveAccessibleName("Ask or chat");
});

// M46 D6, walked: the owner edits and deletes their own message and deletes
// the viewer's; the viewer reports one of the owner's; the operator finds it
// in the console's Reports and hides it, and the owner's open page loses it.
// Messages are seeded through the route the composer calls: posting is the
// first test's to prove.
test("the owner edits and deletes in place, the viewer reports a message, and the console's Reports hides it", async ({ page, browser }) => {
  // Three contexts: the first test's budget and an operator's sign-in.
  test.slow();
  const tripName = e2eTripName("Chat moderation");
  const tripId = await createMappedTrip(page, tripName, 1);
  const invite = await page.request.post(`/api/trips/${tripId}/invites`, { data: { email: null, role: "viewer" } });
  expect(invite.ok()).toBe(true);
  const { token } = ((await invite.json()) as { invite: { token: string } }).invite;
  const run = randomUUID().slice(0, 8);
  const say = async (who: Page, body: string) => {
    const res = await who.request.post(`/api/trips/${tripId}/chat`, { data: { body } });
    expect(res.status(), await res.text()).toBe(201);
  };
  const panel = page.getByRole("complementary", { name: "Assistant" });
  const line = (text: string) => panel.getByRole("listitem").filter({ hasText: text });

  const bea = await signedInAs(browser, newcomer("bea"), `/invite/${token}`);
  try {
    await bea.getByRole("button", { name: "Join the trip" }).click();
    await expect(bea.getByRole("heading", { name: tripName, level: 1 })).toBeVisible();
    await say(page, `Hotel is sorted ${run}`);
    await say(page, `Wrong chat ${run}`);
    await say(bea, `Train at nine? ${run}`);

    await page.goto(`/trips/${tripId}?view=Plan`);
    await expect(page.getByRole("heading", { name: tripName, level: 1 })).toBeVisible();
    // The one button, then its Chat tab: Bea's message is unread here.
    await page.getByTestId("ask-pill").click();
    await panel.getByRole("tab", { name: /^Chat/ }).click();

    // Edit own, in place.
    await line(`Hotel is sorted ${run}`).getByRole("button", { name: /^Actions for / }).click();
    await page.getByRole("menuitem", { name: "Edit" }).click();
    await panel.getByRole("textbox", { name: "Edit message" }).fill(`Hotel is booked ${run}`);
    await panel.getByRole("button", { name: "Save" }).click();
    await expect(line(`Hotel is booked ${run}`)).toContainText("edited");

    // Delete own, then the viewer's, each after a confirm.
    for (const words of [`Wrong chat ${run}`, `Train at nine? ${run}`]) {
      await line(words).getByRole("button", { name: /^Actions for / }).click();
      await page.getByRole("menuitem", { name: "Delete" }).click();
      await page.getByRole("dialog", { name: "Delete this message?" }).getByRole("button", { name: "Delete" }).click();
      await expect(line(words)).toHaveCount(0);
    }
    await expect(line("message removed")).toHaveCount(2);

    // The viewer reports the owner's edited message.
    await bea.reload();
    await bea.getByTestId("ask-pill").click();
    const beaPanel = bea.getByRole("complementary", { name: "Assistant" });
    await beaPanel.getByRole("tab", { name: /^Chat/ }).click();
    // A flag that shows only while the line is pointed at (Mitchell's walk).
    // The fade is on the controls' wrapper, so this multiplies the opacity the
    // browser computed up the line, which is what the reader sees.
    const booked = beaPanel.getByRole("listitem").filter({ hasText: `Hotel is booked ${run}` });
    const flag = booked.getByRole("button", { name: /^Report .+'s message$/ });
    const seen = () =>
      flag.evaluate((el) => {
        let opacity = 1;
        for (let node: Element | null = el; node !== null && node.tagName !== "LI"; node = node.parentElement) {
          opacity *= Number(getComputedStyle(node).opacity);
        }
        return opacity;
      });
    expect(await seen()).toBe(0);
    await booked.hover();
    await expect.poll(seen).toBe(1);
    await flag.click();
    const dialog = bea.getByRole("dialog", { name: /^Report / });
    await dialog.getByRole("radio", { name: "Offensive or hateful" }).click();
    await dialog.getByRole("button", { name: "Send" }).click();
    await expect(dialog.getByTestId("report-sent")).toBeVisible();
  } finally {
    await bea.context().close();
  }

  const admin = await operator(browser);
  try {
    // The report queue is the console's Library tab (m12-moderation.spec.ts).
    await admin.goto("/admin?tab=library");
    const row = admin.getByTestId(/^report-/).filter({ hasText: `Hotel is booked ${run}` });
    await expect(row.getByText("Chat message", { exact: true })).toBeVisible();
    await Promise.all([
      admin.waitForResponse((r) => r.url().includes("/api/admin/reports/") && r.request().method() === "POST" && r.ok()),
      row.getByRole("button", { name: "Hide message" }).click(),
    ]);
    await expect(row).toHaveCount(0);
  } finally {
    await admin.context().close();
  }

  // The hide moved `chatRev`, so the owner's open page re-reads within a poll.
  await expect(line(`Hotel is booked ${run}`)).toHaveCount(0, { timeout: 10_000 });
  await expect(line("message removed")).toHaveCount(3);
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
  // Sent, the chip is the stop's name alone: no `@` (Mitchell's M46 walk).
  await expect(messages).toContainText("Meet at Stop on day 1");
  await messages.getByRole("button", { name: "Stop on day 1", exact: true }).click();
  await expect(page).toHaveURL(/view=Plan/);
  const stopEdit = page.getByTestId(`activity-card-${stopId}`).getByRole("button", { name: /^Edit / });
  await expect(stopEdit).toBeFocused();
  // And on screen: focused off it, behind the day's arrival scroll, is the
  // same as not taken there (PR 481 review).
  await expect(stopEdit).toBeInViewport();

  const removed = await page.request.post(`/api/trips/${tripId}/commands`, { data: { type: "RemoveActivity", tripId, activityId: stopId } });
  expect(removed.ok()).toBe(true);
  await page.reload();
  await expect(page.getByRole("heading", { name: tripName, level: 1 })).toBeVisible();
  await page.getByTestId("ask-pill").click();
  await panel.getByRole("tab", { name: "Chat" }).click();
  await expect(messages).toContainText("Meet at @Stop on day 1");
  await expect(messages.getByRole("button", { name: "Stop on day 1", exact: true })).toHaveCount(0);
});
