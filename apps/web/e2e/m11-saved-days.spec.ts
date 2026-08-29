import { expect, test, type Page } from "@playwright/test";
import { commandsFor } from "@tc/factories";
import { e2eTripName } from "./tripNames";

// M11 link 6's exit-gate line: "select parts of my trip and save them for
// reuse". One person, two trips — keep a day out of one, drop it into the
// other, and check what arrived is the plan without the dates.

async function buildTrip(page: Page, name: string, dayCount: number): Promise<string> {
  const created = await page.request.post("/api/trips", { data: { name } });
  expect(created.ok()).toBe(true);
  const { tripId } = (await created.json()) as { tripId: string };
  // The same command vocabulary db:seed and the other specs share (ADR-020).
  for (const command of commandsFor("mappedTrip", tripId, { dayCount })) {
    const res = await page.request.post(`/api/trips/${tripId}/commands`, { data: command });
    expect(res.ok()).toBe(true);
  }
  return tripId;
}

async function openTimeline(page: Page, tripId: string, tripName: string): Promise<void> {
  await page.goto(`/trips/${tripId}`);
  await expect(page.getByRole("heading", { name: tripName, level: 2 })).toBeVisible();
  await page.getByRole("tab", { name: "Timeline" }).click();
}

test("keep a day out of one trip, and drop it into another", async ({ page }) => {
  test.slow();
  // Distinct prefixes from other specs' trip names — parallel workers share
  // the "alice" dev user's trip list (m1/m3/m6's comment).
  const sourceName = e2eTripName("Kept");
  const targetName = e2eTripName("Reuse");
  const sourceId = await buildTrip(page, sourceName, 2);
  const targetId = await buildTrip(page, targetName, 1);

  // -- Keep day 1 of the source trip --
  await openTimeline(page, sourceId, sourceName);
  await page.getByRole("button", { name: "Keep day 1" }).first().click();
  await expect(page.getByRole("heading", { name: "Keep this day" })).toBeVisible();

  // The dialog describes the real day rather than offering a field that
  // changes nothing, and says plainly that saved days are private.
  await expect(page.getByText(/stop.*Order and gaps kept, no dates\./)).toBeVisible();
  await expect(page.getByText(/Saved days are private to you/)).toBeVisible();

  // A saved day, not a trip — no `[e2e]` prefix (global.teardown.ts only
  // sweeps trips), but still timestamped for the same shared-user reason.
  const savedName = `Nakameguro ${Date.now()}`;
  const nameField = page.getByLabel("Name");
  await nameField.fill(savedName);
  await Promise.all([
    page.waitForResponse(
      (r) => new URL(r.url()).pathname === "/api/saved-days" && r.request().method() === "POST",
    ),
    page.getByRole("button", { name: "Save" }).click(),
  ]);
  await expect(page.getByText(`Kept "${savedName}"`)).toBeVisible();

  // -- Drop it into the other trip --
  await openTimeline(page, targetId, targetName);
  await page.getByRole("button", { name: "Add a saved day" }).click();
  const row = page
    .getByTestId("saved-days-list")
    .locator("div")
    .filter({ hasText: savedName })
    .first();
  await expect(row).toBeVisible();
  // It says where it came from — a snapshot of the source trip's name.
  await expect(page.getByText(`From ${sourceName}`)).toBeVisible();

  await Promise.all([
    page.waitForResponse(
      (r) =>
        /\/api\/trips\/[^/]+\/saved-days\/[^/]+$/.test(new URL(r.url()).pathname) &&
        r.request().method() === "POST" &&
        r.ok(),
    ),
    row.getByRole("button", { name: "Add to trip" }).click(),
  ]);

  // The target trip gained a day, and its stops came with it. Day columns is
  // where a day count is easiest to assert (m10-growth does the same).
  await page.getByRole("tab", { name: "Day columns" }).click();
  await expect(page.getByTestId("day-column")).toHaveCount(2);
  // The day count alone passes if the insert creates an EMPTY day, which is
  // most of what could go wrong here (CodeRabbit, PR #71). The saved stop is
  // the payload, so assert it landed in the day that just arrived.
  //
  // "Stop on day 1" is `mappedTrip`'s title for the FIRST day (the one that
  // was kept), and it is showing up here in the target trip's SECOND column —
  // which is what makes this evidence of travel rather than of the target's
  // own day 1 being re-counted.
  const inserted = page.getByTestId("day-column").nth(1);
  await expect(inserted.getByText("Stop on day 1")).toBeVisible();

  // One batch = one history entry = one undo. Undoing takes the whole
  // inserted day away, not one stop of it.
  await page.getByRole("button", { name: "History", exact: true }).click();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByTestId("day-column")).toHaveCount(1);
});

test("a day with nothing on it cannot be kept", async ({ page }) => {
  test.slow();
  const tripName = e2eTripName("Bare");
  const created = await page.request.post("/api/trips", { data: { name: tripName } });
  const { tripId } = (await created.json()) as { tripId: string };
  await page.request.post(`/api/trips/${tripId}/commands`, {
    data: { type: "AddDay", tripId, dayId: crypto.randomUUID() },
  });

  await openTimeline(page, tripId, tripName);
  const flag = page.getByRole("button", { name: "Keep day 1" }).first();
  await expect(flag).toBeDisabled();
  await expect(flag).toHaveAttribute("title", "Add a stop to this day first");
});
