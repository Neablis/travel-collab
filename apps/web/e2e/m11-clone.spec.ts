import { expect, test, type Page } from "@playwright/test";
import { e2eTripName, escapeForRegExp } from "./tripNames";

// M11 link 5's exit-gate line: "A shared trip can be cloned into the
// recipient's own trips and edited." Two contexts again, because the whole
// claim is about someone who is not the owner.

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

async function shareLinkFor(page: Page): Promise<string> {
  // `exact: true` — the trip title button's accessible name is
  // "<trip name> — Trip settings", so a loose "Share" match can be ambiguous.
  await page.getByRole("button", { name: "Share", exact: true }).click();
  await Promise.all([
    page.waitForResponse(
      (r) => /\/api\/trips\/[^/]+\/shares$/.test(new URL(r.url()).pathname) && r.request().method() === "POST",
    ),
    page.getByRole("button", { name: "Create a share link" }).click(),
  ]);
  const copy = page.getByRole("button", { name: "Copy share link" }).first();
  await expect(copy).toBeVisible();
  const link = await copy.getAttribute("title");
  expect(link).toBeTruthy();
  return link!;
}

async function signedInAs(browser: import("@playwright/test").Browser, username: string): Promise<Page> {
  // `storageState: undefined` is explicit: the "desktop" project's `use` pins
  // alice's saved session, and inheriting it would make this spec test alice
  // cloning alice's own trip.
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

test("a stranger clones a shared trip, gets the pinned plan, and can edit it", async ({
  page,
  browser,
}) => {
  test.slow();
  const tripName = e2eTripName("Cloneable");
  const tripId = await createTrip(page, tripName);
  await addDay(page, tripId);
  await addDay(page, tripId);

  await page.goto(`/trips/${tripId}`);
  await expect(page.getByRole("heading", { name: tripName, level: 2 })).toBeVisible();
  const link = await shareLinkFor(page);

  // The owner keeps planning AFTER handing the link out. The clone must take
  // what the link shows, not what the trip has become.
  await addDay(page, tripId);

  const erin = await signedInAs(browser, "erin");
  try {
    await erin.goto(link);
    await expect(erin.getByRole("heading", { name: tripName, level: 1 })).toBeVisible();
    await erin.getByRole("button", { name: "Make this my trip" }).click();

    // Lands on her own copy — named as a copy, and editable.
    await expect(
      erin.getByRole("heading", { name: `${tripName} (copy)`, level: 2 }),
    ).toBeVisible();
    await expect(erin.getByText("Viewer", { exact: true })).toHaveCount(0);
    await Promise.all([
      erin.waitForResponse(
        (r) =>
          /\/api\/trips\/[^/]+\/commands$/.test(new URL(r.url()).pathname) &&
          r.request().method() === "POST" &&
          r.ok(),
      ),
      erin.getByTestId("one-more-day-column").getByRole("button", { name: "Add a day" }).click(),
    ]);

    // The pinned plan had TWO days; the third the owner added after handing
    // the link out is not here. Three columns now = the two she copied plus
    // the one she just added — four would mean the clone took current state.
    await expect(erin.getByTestId("day-column")).toHaveCount(3);

    // …and the copy says where it came from.
    await erin
      .getByRole("button", { name: `${tripName} (copy) — Trip settings` })
      .click();
    await expect(erin.getByText("Where this came from")).toBeVisible();
    await expect(erin.getByText(new RegExp(`Copied from .${escapeForRegExp(tripName)}`))).toBeVisible();

    // It is hers, in her own trip list.
    await erin.goto("/");
    await expect(erin.getByRole("link", { name: `${tripName} (copy)` })).toBeVisible();
  } finally {
    await erin.context().close();
  }

  // The source is untouched by any of it: still its own name, still the three
  // days its owner made.
  await page.reload();
  await expect(page.getByRole("heading", { name: tripName, level: 2 })).toBeVisible();
  await expect(page.getByTestId("day-column")).toHaveCount(3);
});

test("duplicating your own trip records where the copy came from", async ({ page }) => {
  test.slow();
  const tripName = e2eTripName("Duplicated");
  const tripId = await createTrip(page, tripName);
  await page.goto(`/trips/${tripId}`);
  await page.getByRole("button", { name: `${tripName} — Trip settings` }).click();

  await Promise.all([
    page.waitForResponse(
      (r) => /\/api\/trips\/[^/]+\/duplicate$/.test(new URL(r.url()).pathname) && r.ok(),
    ),
    page.getByRole("button", { name: "Duplicate trip" }).click(),
  ]);

  await expect(page.getByRole("heading", { name: `${tripName} (copy)`, level: 2 })).toBeVisible();
  await page.getByRole("button", { name: `${tripName} (copy) — Trip settings` }).click();
  await expect(page.getByText(new RegExp(`Copied from .${escapeForRegExp(tripName)}`))).toBeVisible();
});
