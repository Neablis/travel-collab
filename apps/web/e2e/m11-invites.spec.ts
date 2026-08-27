import { expect, test, type Page } from "@playwright/test";
import { signInAsDevUser } from "./helpers";

// M11 link 3's exit-gate line: "An invited person can open the trip and modify
// it." Two real browser contexts, because that is the only way to prove it —
// alice owns the trip and hands out a link; bob follows it as himself.
//
// The link is read off the invite row's `title` attribute rather than the
// clipboard: reading the clipboard needs a permission grant that differs
// between headed and headless Chromium, and the app puts the same URL in both
// places precisely so a denied clipboard is never a dead end
// (TravelersPanel.tsx).

async function openTripSettings(page: Page, tripName: string): Promise<void> {
  await page.getByRole("button", { name: `${tripName} — Trip settings` }).click();
  await expect(page.getByRole("heading", { name: "Trip settings" })).toBeVisible();
}

async function createTrip(page: Page, tripName: string): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "New trip" }).click();
  await page.getByLabel("Trip name").fill(tripName);
  await page.getByRole("button", { name: "Create empty" }).click();
  await page.getByRole("link", { name: tripName }).click();
  await expect(page.getByRole("heading", { name: tripName, level: 2 })).toBeVisible();
}

async function inviteLinkFor(page: Page, role: "Can edit" | "Can view"): Promise<string> {
  await page.getByLabel("Invite role").selectOption({ label: role });
  await Promise.all([
    page.waitForResponse(
      (r) => /\/api\/trips\/[^/]+\/invites$/.test(new URL(r.url()).pathname) && r.request().method() === "POST",
    ),
    page.getByRole("button", { name: "Invite someone" }).click(),
  ]);
  const copy = page.getByRole("button", { name: "Copy link" }).first();
  await expect(copy).toBeVisible();
  const link = await copy.getAttribute("title");
  expect(link).toBeTruthy();
  return link!;
}

test("an invited editor opens the trip and changes it; the owner sees them listed", async ({
  page,
  browser,
}) => {
  // Distinct prefix from other specs' trip names — parallel workers share the
  // "alice" dev user's trip list (m1/m3/m6's comment).
  const tripName = `Invites ${Date.now()}`;
  await createTrip(page, tripName);
  await openTripSettings(page, tripName);

  // Before any invite, the owner is the only traveller.
  await expect(page.getByText("owner")).toBeVisible();

  const link = await inviteLinkFor(page, "Can edit");

  // Bob, in his own browser context with his own session.
  const bobContext = await browser.newContext();
  const bob = await bobContext.newPage();
  try {
    await signInAsDevUser(bob, "bob");
    await bob.goto(link);

    await expect(bob.getByRole("heading", { name: tripName, level: 1 })).toBeVisible();
    await expect(bob.getByText("You'll be able to change the plan.")).toBeVisible();
    await bob.getByRole("button", { name: "Join this trip" }).click();

    // Lands on the trip, editable, with no "View only" badge.
    await expect(bob.getByRole("heading", { name: tripName, level: 2 })).toBeVisible();
    await expect(bob.getByText("View only")).toHaveCount(0);

    // …and can actually change it. "Add a day" lives in the board's trailing
    // "One more day?" column (Board.tsx).
    await Promise.all([
      bob.waitForResponse(
        (r) =>
          /\/api\/trips\/[^/]+\/commands$/.test(new URL(r.url()).pathname) &&
          r.request().method() === "POST" &&
          r.ok(),
      ),
      bob.getByTestId("one-more-day-column").getByRole("button", { name: "Add a day" }).click(),
    ]);

    // The trip now appears in bob's own Home grid, alongside his own trips —
    // SPEC R4 deleted the "shared with you" label, so it simply appears.
    await bob.goto("/");
    await expect(bob.getByRole("link", { name: tripName })).toBeVisible();
  } finally {
    await bobContext.close();
  }

  // Back on alice's side: bob is a listed traveller with the role she gave him.
  await page.reload();
  await openTripSettings(page, tripName);
  await expect(page.getByText("editor")).toBeVisible();
});

test("an invited viewer can read the trip but is told, and shown, that it is read-only", async ({
  page,
  browser,
}) => {
  const tripName = `Viewer ${Date.now()}`;
  await createTrip(page, tripName);
  await openTripSettings(page, tripName);
  const link = await inviteLinkFor(page, "Can view");

  const carolContext = await browser.newContext();
  const carol = await carolContext.newPage();
  try {
    await signInAsDevUser(carol, "carol");
    await carol.goto(link);
    await expect(carol.getByText("You'll be able to look, but not change anything.")).toBeVisible();
    await carol.getByRole("button", { name: "Join this trip" }).click();

    await expect(carol.getByRole("heading", { name: tripName, level: 2 })).toBeVisible();
    await expect(carol.getByText("View only")).toBeVisible();
  } finally {
    await carolContext.close();
  }
});

test("a revoked link stops working", async ({ page, browser }) => {
  const tripName = `Revoked ${Date.now()}`;
  await createTrip(page, tripName);
  await openTripSettings(page, tripName);
  const link = await inviteLinkFor(page, "Can edit");

  await Promise.all([
    page.waitForResponse(
      (r) =>
        /\/api\/trips\/[^/]+\/invites\/[^/]+$/.test(new URL(r.url()).pathname) &&
        r.request().method() === "DELETE",
    ),
    page.getByRole("button", { name: "Revoke" }).first().click(),
  ]);

  const danContext = await browser.newContext();
  const dan = await danContext.newPage();
  try {
    await signInAsDevUser(dan, "dan");
    await dan.goto(link);
    await expect(dan.getByText("This invite has been revoked.")).toBeVisible();
    await expect(dan.getByRole("button", { name: "Join this trip" })).toHaveCount(0);
  } finally {
    await danContext.close();
  }
});
