import { expect, test, type Page } from "@playwright/test";

// M11 link 4's exit-gate line, and the only way to prove it: "A share link
// renders the trip AS OF the seq it was created at, proven by editing the trip
// afterwards and seeing the link unchanged."
//
// The reader is a genuinely signed-out browser context — `storageState:
// undefined`, not the "desktop" project's saved alice session — because a
// share link that only works for people who already have an account is not a
// share link.

async function createTrip(page: Page, name: string): Promise<string> {
  const response = await page.request.post("/api/trips", { data: { name } });
  expect(response.ok()).toBe(true);
  const { tripId } = (await response.json()) as { tripId: string };
  return tripId;
}

async function addDay(page: Page, tripId: string): Promise<void> {
  const response = await page.request.post(`/api/trips/${tripId}/commands`, {
    data: { type: "AddDay", tripId, dayId: crypto.randomUUID() },
  });
  expect(response.ok()).toBe(true);
}

async function shareLinkFor(page: Page, tripName: string): Promise<string> {
  // `exact: true` is load-bearing, not tidiness — the same trap helpers.ts
  // documents for /history/i. Playwright's name matching is
  // substring-and-case-insensitive, and the trip title button's accessible
  // name is "<trip name> — Trip settings", so a trip called "Shared 1787…"
  // makes a loose "Share" match ambiguous and trips strict mode.
  await page.getByRole("button", { name: "Share", exact: true }).click();
  await expect(page.getByTestId("share-panel")).toBeVisible();
  await Promise.all([
    page.waitForResponse(
      (r) => /\/api\/trips\/[^/]+\/shares$/.test(new URL(r.url()).pathname) && r.request().method() === "POST",
    ),
    page.getByRole("button", { name: "Create a share link" }).click(),
  ]);
  // The accessible name is stable; the visible label flips to "Copied"
  // because creating a link copies it.
  const copy = page.getByRole("button", { name: "Copy share link" }).first();
  await expect(copy).toBeVisible();
  const link = await copy.getAttribute("title");
  expect(link, `no share link on the panel for ${tripName}`).toBeTruthy();
  return link!;
}

test("a share link keeps showing the trip as it was when it was shared", async ({
  page,
  browser,
}) => {
  test.slow();
  // Distinct prefix from other specs' trip names — parallel workers share the
  // "alice" dev user's trip list (m1/m3/m6's comment).
  const tripName = `Shared ${Date.now()}`;
  const tripId = await createTrip(page, tripName);
  await addDay(page, tripId);
  await addDay(page, tripId);

  await page.goto(`/trips/${tripId}`);
  await expect(page.getByRole("heading", { name: tripName, level: 2 })).toBeVisible();
  const link = await shareLinkFor(page, tripName);

  // A signed-out stranger, in their own context.
  const readerContext = await browser.newContext({ storageState: undefined });
  const reader = await readerContext.newPage();
  try {
    await reader.goto(link);
    await expect(reader.getByRole("heading", { name: tripName, level: 1 })).toBeVisible();
    await expect(reader.getByText("Read only")).toBeVisible();
    await expect(reader.getByText("2 days")).toBeVisible();
    await expect(reader.getByText(/this is the plan as it was then/)).toBeVisible();
    // Nothing on this page can change the trip.
    await expect(reader.getByRole("button", { name: "Add stop" })).toHaveCount(0);

    // Now alice keeps planning.
    await addDay(page, tripId);
    await page.request.post(`/api/trips/${tripId}/commands`, {
      data: { type: "SetTripName", tripId, name: `${tripName} (renamed)` },
    });

    // The link is unchanged — same two days, same name — and now says the
    // trip has moved on.
    await reader.reload();
    await expect(reader.getByRole("heading", { name: tripName, level: 1 })).toBeVisible();
    await expect(reader.getByText("2 days")).toBeVisible();
    await expect(reader.getByText(/It has changed since\./)).toBeVisible();
  } finally {
    await readerContext.close();
  }
});

test("turning a share link off stops it working", async ({ page, browser }) => {
  test.slow();
  const tripName = `Unshared ${Date.now()}`;
  const tripId = await createTrip(page, tripName);
  await page.goto(`/trips/${tripId}`);
  await expect(page.getByRole("heading", { name: tripName, level: 2 })).toBeVisible();
  const link = await shareLinkFor(page, tripName);

  await Promise.all([
    page.waitForResponse(
      (r) =>
        /\/api\/trips\/[^/]+\/shares\/[^/]+$/.test(new URL(r.url()).pathname) &&
        r.request().method() === "DELETE",
    ),
    page.getByRole("button", { name: "Turn off share link" }).first().click(),
  ]);

  const readerContext = await browser.newContext({ storageState: undefined });
  const reader = await readerContext.newPage();
  try {
    await reader.goto(link);
    await expect(reader.getByRole("heading", { name: "Nothing to see here" })).toBeVisible();
  } finally {
    await readerContext.close();
  }
});

// The landing CTAs are ordinary links now, not Preview shells. Where no demo
// share is configured — CI, and any deploy where nobody set DEMO_SHARE_TOKEN —
// /s/featured is a designed empty state with a way onward, not a dead end.
test.describe("the landing page's peek CTAs", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("both open the public share page", async ({ page }) => {
    await page.goto("/welcome");
    for (const name of ["Look around a real trip", "See a finished one"]) {
      await expect(page.getByRole("link", { name })).toHaveAttribute("href", "/s/featured");
    }
    await page.getByRole("link", { name: "Look around a real trip" }).click();
    await expect(page).toHaveURL(/\/s\/featured$/);
    // Unconfigured in CI: an empty state that offers the next step, not a 404.
    await expect(page.getByRole("heading", { name: "Nothing to see here" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Start a trip" })).toBeVisible();
  });
});
