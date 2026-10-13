import { randomUUID } from "node:crypto";
import { expect, test } from "./fixtures/test";
import { grantCollaborators } from "./adminBootstrap";
import { signInAsDevUser } from "./helpers";
import { e2eTripName } from "./tripNames";

// M46 D5's Home half: a trip's card says how many chat messages the reader has
// not read, and says nothing once they have. Two people, because your own
// messages are never unread to you. Everything but Home itself goes through
// the shipped endpoints: the Chat tab is part 2's, so marking read is its
// route here rather than the panel.

// Posting needs the owner's `trip.collaborators` (M46 D2).
test.beforeAll(async ({ browser }) => {
  await grantCollaborators(browser, "dev-alice");
});

test("Home counts another member's unread messages, and drops the count once read", async ({ page, browser }) => {
  // Two contexts and two sign-ins, the budget m39-phone-conflicts gives.
  test.slow();
  const tripName = e2eTripName("ChatUnread");
  const created = await page.request.post("/api/trips", { data: { name: tripName } });
  expect(created.status()).toBe(201);
  const { tripId } = (await created.json()) as { tripId: string };

  const invited = await page.request.post(`/api/trips/${tripId}/invites`, { data: { email: null, role: "editor" } });
  expect(invited.status()).toBe(201);
  const { invite } = (await invited.json()) as { invite: { token: string } };

  let lastMessageId = "";
  const samContext = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  try {
    const sam = await samContext.newPage();
    await signInAsDevUser(sam, `sam${randomUUID().replace(/-/g, "").slice(0, 12)}`);
    expect((await sam.request.post(`/api/invites/${encodeURIComponent(invite.token)}/accept`)).ok()).toBe(true);
    for (const body of ["Flights are booked", "Hotel too"]) {
      const posted = await sam.request.post(`/api/trips/${tripId}/chat`, { data: { body } });
      expect(posted.status()).toBe(201);
      lastMessageId = ((await posted.json()) as { message: { messageId: string } }).message.messageId;
    }
  } finally {
    await samContext.close();
  }

  // The trip is the hero or a card, depending on what else this account holds.
  const trip = page
    .getByTestId(/^(trip-card|next-trip-hero)$/)
    .filter({ has: page.getByRole("link", { name: tripName, exact: true }) });

  await page.goto("/");
  await expect(trip).toBeVisible();
  await expect(trip.getByRole("img", { name: "2 unread messages" })).toBeVisible();

  const read = await page.request.post(`/api/trips/${tripId}/chat/read`, { data: { messageId: lastMessageId } });
  expect(read.status()).toBe(204);

  // Home does not poll: the count is as fresh as its load, so load it again.
  await page.goto("/");
  await expect(trip).toBeVisible();
  await expect(trip.getByRole("img", { name: /unread/ })).toHaveCount(0);
});
