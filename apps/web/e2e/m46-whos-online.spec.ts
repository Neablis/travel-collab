import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import type { TripAccess } from "@tc/contracts";
import { expect, test } from "./fixtures/test";
import { grantCollaborators } from "./adminBootstrap";
import { createMappedTrip, personRow, signInAsDevUser } from "./helpers";
import { e2eTripName } from "./tripNames";
import { displayNameFor } from "../src/lib/displayName";

// M46 D7: who has the trip open. B opens the trip in their own browser; A's
// page, loaded on its own, shows B online within a poll or two: on the header's
// traveller stack (640px and up, where the stack is drawn) and on B's row in
// Trip settings → People (every width). Two contexts, as travellers.spec.ts.

/**
 * The stack's label names who is online, since a screen reader hears nothing
 * inside it. Drawn from 640px only (travellers spec W20), so a no-op below.
 */
async function expectOnlineOnStack(page: Page, name: string): Promise<void> {
  if (page.viewportSize()!.width < 640) return;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  await expect(page.getByRole("button", { name: /^Travellers on this trip/ })).toHaveAccessibleName(
    new RegExp(`online: .*${escaped}`),
    { timeout: 15_000 },
  );
}

test.beforeAll(async ({ browser }) => {
  await grantCollaborators(browser, "dev-alice");
});

test("a member who opens the trip shows as online to another", async ({ page, browser }) => {
  // Two contexts, two sign-ins, two page loads: the budget travellers.spec gives.
  test.slow();
  const tripId = await createMappedTrip(page, e2eTripName("Online"), 1);

  // An editor travels by default, so B is a face on A's stack.
  const invited = await page.request.post(`/api/trips/${tripId}/invites`, { data: { email: null, role: "editor" } });
  expect(invited.status()).toBe(201);
  const { invite } = (await invited.json()) as { invite: { token: string } };

  const bContext = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  try {
    const b = await bContext.newPage();
    // Not "online…": the row's assertion below reads its words.
    const username = `bea${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const bId = `dev-${username}`;
    await signInAsDevUser(b, username);
    expect((await b.request.post(`/api/invites/${encodeURIComponent(invite.token)}/accept`)).ok()).toBe(true);
    // Open, and left open: B's own poll is the heartbeat.
    await b.goto(`/trips/${tripId}?view=Plan`);
    await expect(b.getByRole("heading", { level: 1 })).toBeVisible();

    const { access } = (await (await page.request.get(`/api/trips/${tripId}/access`)).json()) as { access: TripAccess };
    const bMember = access.members.find((m) => m.userId === bId);
    expect(bMember).toBeDefined();
    const bName = displayNameFor(bMember!);

    await page.goto(`/trips/${tripId}?view=Plan`);
    // A poll every 2s on a trip of two; B's first lands about 2s after load.
    await expectOnlineOnStack(page, bName);

    await page.getByRole("button", { name: /— Trip settings$/ }).click();
    const people = page.getByRole("dialog", { name: "Trip settings" }).getByTestId("people-section");
    await expect(personRow(people, bId)).toContainText("online", { timeout: 15_000 });
  } finally {
    await bContext.close();
  }
});
