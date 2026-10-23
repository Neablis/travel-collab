import { randomUUID } from "node:crypto";
import type { APIRequestContext, Browser } from "@playwright/test";
import { expect, test } from "./fixtures/test";
import { grantCollaborators } from "./adminBootstrap";
import { createMappedTrip } from "./helpers";
import { e2eTripName } from "./tripNames";

// M52's walk, in a browser: a trip under way opens on Today, not the
// Overview notebook (decision 11), with what is on now, what is next and a
// way there (decision 15), and an `@assistant` in the trip chat drafts a
// change its asker accepts (decision 18).
//
// **The browser's clock is frozen at noon** (`page.clock`), so *now* is the
// castle and *next* is dinner whenever this runs. The server's is not, which
// is why the trip runs from yesterday to tomorrow: under way on either clock.
// Reykjavik, because its zone is UTC all year, so the stops' wall times (the
// day's zone, from where its stops are) and the frozen instant agree.

const DAY = 86_400_000;
const isoDay = (offset: number) => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10);
const CHURCH = { name: "Hallgrímskirkja", city: "Reykjavik", lat: 64.1417, lng: -21.9266, countryCode: "IS" };
const DINNER = { name: "Dill", city: "Reykjavik", lat: 64.1466, lng: -21.9426, countryCode: "IS" };

test.use({ timezoneId: "Atlantic/Reykjavik" });

// The chat needs the owner's `trip.collaborators`, and the asker's plan the
// assistant (M52 decision 8): `premium` holds both.
test.beforeAll(async ({ browser }) => {
  await grantCollaborators(browser, "dev-alice");
});

// A second member, so the trip has a chat on every build (a solo trip's is
// going, Mitchell 2026-10-23): a viewer joins on an invite and leaves.
async function addViewer(browser: Browser, tripId: string, request: APIRequestContext) {
  const invite = (await (await request.post(`/api/trips/${tripId}/invites`, { data: { email: null, role: "viewer" } })).json()) as { invite: { token: string } };
  const context = await browser.newContext({ storageState: undefined });
  const viewer = await context.newPage();
  await viewer.goto(`/invite/${invite.invite.token}`);
  await viewer.getByRole("link", { name: "Sign in", exact: true }).click();
  await viewer.getByLabel("Username").fill(`today${randomUUID().replace(/-/g, "").slice(0, 12)}`);
  await Promise.all([
    viewer.waitForURL((url) => !/^\/sign(in|up)$/.test(url.pathname)),
    viewer.getByRole("button", { name: /sign in with dev login/i }).click(),
  ]);
  await viewer.getByRole("button", { name: "Join the trip" }).click();
  await expect(viewer.getByRole("heading", { level: 1 })).toBeVisible();
  await context.close();
}

test("a trip under way opens on Today, with now, next and directions, and an @assistant change its asker accepts", async ({ page, browser }) => {
  // Two contexts and an assistant turn: the budget m46-trip-chat.spec.ts gives.
  test.slow();
  await page.clock.setFixedTime(new Date(`${isoDay(0)}T12:00:00Z`));
  await page.goto("/home");
  const tripName = e2eTripName("Today");
  const tripId = await createMappedTrip(page, tripName, 3, {
    startDate: isoDay(-1),
    activitiesPerDay: 2,
    timeWindows: [
      { start: "11:00", end: "13:00" },
      { start: "19:00", end: "21:00" },
    ],
    title: (day, i) => (i === 0 ? `Castle ${day + 1}` : `Dinner ${day + 1}`),
    locations: [CHURCH, DINNER],
  });
  await addViewer(browser, tripId, page.request);

  // -- Overview is Today: now, next, and directions to each --
  await page.goto(`/trips/${tripId}?view=Overview`);
  await expect(page.getByRole("heading", { name: tripName, level: 1 })).toBeVisible();
  const letter = page.locator(".tc-overview-letter");
  await expect(letter.getByText("Now", { exact: true })).toBeVisible();
  await expect(letter.getByRole("button", { name: "Castle 2", exact: true })).toBeVisible();
  await expect(letter.getByText("Next", { exact: true })).toBeVisible();
  await expect(letter.getByText(/^in 7 h · /)).toBeVisible();
  await expect(letter.getByRole("link", { name: "Directions to Dinner 2" })).toHaveAttribute(
    "href",
    `https://www.google.com/maps/dir/?api=1&destination=${DINNER.lat}%2C${DINNER.lng}`,
  );
  // The usual Overview is one quiet link away, and back.
  await letter.getByRole("link", { name: "Whole trip →" }).click();
  await expect(letter.getByText(/^Here is your itinerary, day by day/)).toBeVisible();
  await letter.getByRole("link", { name: "Today", exact: true }).click();
  await expect(letter.getByRole("button", { name: "Castle 2", exact: true })).toBeVisible();

  // -- @assistant in the chat drafts a change, and its asker accepts it --
  await page.getByTestId("ask-pill").click();
  const panel = page.getByRole("complementary", { name: "Assistant" });
  await panel.getByRole("tab", { name: "Chat" }).click();
  // "move", the simulated model's change verb: it proposes from the trip's
  // data (`simulatedModel.ts`), so the card is its sample stop.
  await panel.getByRole("combobox", { name: "Message" }).fill("@assistant move dinner back an hour");
  await Promise.all([
    page.waitForResponse((r) => new URL(r.url()).pathname === `/api/trips/${tripId}/chat` && r.request().method() === "POST" && r.status() === 201),
    panel.getByRole("button", { name: "Send" }).click(),
  ]);
  const messages = panel.getByRole("list", { name: "Messages" });
  await expect(messages).toContainText("I've drafted 1 change for this trip.");
  await messages.getByRole("button", { name: "Accept" }).click();
  await expect(messages.getByRole("button", { name: "Accept" })).toHaveCount(0);

  const { trip } = (await (await page.request.get(`/api/trips/${tripId}`)).json()) as { trip: { activities: Record<string, { title: string }> } };
  expect(Object.values(trip.activities).map((a) => a.title)).toContain("Sample: coffee stop");
});
