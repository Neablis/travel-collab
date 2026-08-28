import { expect, test, type Browser, type Page } from "@playwright/test";

// M11 link 3's exit-gate line: "An invited person can open the trip and modify
// it." Two real browser contexts, because that is the only way to prove it —
// alice owns the trip and hands out a link; bob follows it as himself.
//
// The link is read off the invite row's `title` attribute rather than the
// clipboard: reading the clipboard needs a permission grant that differs
// between headed and headless Chromium, and the app puts the same URL in both
// places precisely so a denied clipboard is never a dead end
// (TravelersPanel.tsx).
//
// Every test here is `test.slow()`. Not flake insurance: each one drives TWO
// browser contexts through a full sign-in and a page load apiece, which is
// genuinely about three times the work of a single-context spec and does not
// fit CI's 30s default. The first run of this file exhausted that budget
// mid-sign-in — a *budget* failure, and the honest fix for one of those is the
// budget, not a retry. The trip itself is created through the app's own
// command API (the `createMappedTrip` idiom in helpers.ts) rather than the
// new-trip wizard, because the wizard is m8's territory and re-walking it here
// is pure cost.

async function createTrip(page: Page, name: string): Promise<string> {
  const response = await page.request.post("/api/trips", { data: { name } });
  expect(response.ok()).toBe(true);
  const { tripId } = (await response.json()) as { tripId: string };
  await page.goto(`/trips/${tripId}`);
  await expect(page.getByRole("heading", { name, level: 2 })).toBeVisible();
  return tripId;
}

async function openTripSettings(page: Page, tripName: string): Promise<void> {
  await page.getByRole("button", { name: `${tripName} — Trip settings` }).click();
  await expect(page.getByRole("heading", { name: "Trip settings" })).toBeVisible();
}

async function inviteLinkFor(page: Page, role: "Can edit" | "Can view"): Promise<string> {
  await page.getByLabel("Invite role").selectOption({ label: role });
  await Promise.all([
    page.waitForResponse(
      (r) => /\/api\/trips\/[^/]+\/invites$/.test(new URL(r.url()).pathname) && r.request().method() === "POST",
    ),
    page.getByRole("button", { name: "Invite someone" }).click(),
  ]);
  // The accessible name is stable ("Copy invite link"); the visible label is
  // not — creating an invite copies it, so this row already reads "Copied".
  const copy = page.getByRole("button", { name: "Copy invite link" }).first();
  await expect(copy).toBeVisible();
  const link = await copy.getAttribute("title");
  expect(link).toBeTruthy();
  return link!;
}

/**
 * A second signed-in person, in their own context.
 *
 * `storageState: undefined` is explicit rather than assumed: the "desktop"
 * project's `use` pins alice's saved session, and inheriting it here would
 * make this spec silently test alice inviting alice. Sign-in goes straight to
 * /signin rather than through the landing page — the front door is m15's
 * spec, and this one only needs the session.
 */
async function signedInAs(browser: Browser, username: string): Promise<Page> {
  const context = await browser.newContext({ storageState: undefined });
  const page = await context.newPage();
  await page.goto("/signin");
  await page.fill('input[name="username"]', username);
  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith("/signin")),
    page.getByRole("button", { name: /sign in with dev login/i }).click(),
  ]);
  return page;
}

test("an invited editor opens the trip and changes it; the owner sees them listed", async ({
  page,
  browser,
}) => {
  test.slow();
  // Distinct prefix from other specs' trip names — parallel workers share the
  // "alice" dev user's trip list (m1/m3/m6's comment).
  const tripName = `Invites ${Date.now()}`;
  await createTrip(page, tripName);
  await openTripSettings(page, tripName);

  // Before any invite, the owner is the only traveller. Scoped to her own
  // row — asserting on the bare text "owner" would also match a pending
  // invite's role badge, so it could pass with no traveller listed at all.
  await expect(page.getByTestId("traveller-dev-alice")).toContainText("owner");
  await expect(page.getByTestId(/^traveller-/)).toHaveCount(1);

  const link = await inviteLinkFor(page, "Can edit");

  const bob = await signedInAs(browser, "bob");
  try {
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
    await bob.context().close();
  }

  // Back on alice's side: bob is a listed traveller with the role she gave
  // him — identity and role together, in his own row, so a regression in
  // membership listing fails here rather than being masked by the invite row.
  await page.reload();
  await openTripSettings(page, tripName);
  await expect(page.getByTestId("traveller-dev-bob")).toContainText("editor");
  await expect(page.getByTestId("traveller-dev-alice")).toContainText("owner");
  await expect(page.getByTestId(/^traveller-/)).toHaveCount(2);
});

test("an invited viewer can read the trip but is told, and shown, that it is read-only", async ({
  page,
  browser,
}) => {
  test.slow();
  const tripName = `Viewer ${Date.now()}`;
  await createTrip(page, tripName);
  await openTripSettings(page, tripName);
  const link = await inviteLinkFor(page, "Can view");

  const carol = await signedInAs(browser, "carol");
  try {
    await carol.goto(link);
    await expect(carol.getByText("You'll be able to look, but not change anything.")).toBeVisible();
    await carol.getByRole("button", { name: "Join this trip" }).click();

    await expect(carol.getByRole("heading", { name: tripName, level: 2 })).toBeVisible();
    await expect(carol.getByText("View only")).toBeVisible();
  } finally {
    await carol.context().close();
  }
});

test("a revoked link stops working", async ({ page, browser }) => {
  test.slow();
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
    page.getByRole("button", { name: "Revoke invite" }).first().click(),
  ]);

  const dan = await signedInAs(browser, "dan");
  try {
    await dan.goto(link);
    await expect(dan.getByText("This invite has been revoked.")).toBeVisible();
    await expect(dan.getByRole("button", { name: "Join this trip" })).toHaveCount(0);
  } finally {
    await dan.context().close();
  }
});
