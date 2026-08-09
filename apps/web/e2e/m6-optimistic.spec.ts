import { expect, test } from "@playwright/test";
import { signInAsDevUser } from "./helpers";

test("optimistic add renders instantly and persists", async ({ page }) => {
  // Distinct prefix from other specs' trip names — parallel workers share the
  // "alice" dev user's trip list, and a same-millisecond Date.now() would
  // otherwise make specs' trip names collide (see m3/m4's comment).
  const tripName = `Oslo ${Date.now()}`;
  await signInAsDevUser(page, "alice");

  await page.getByRole("button", { name: "New trip" }).click();
  await page.getByLabel("Trip name").fill(tripName);
  await page.getByRole("button", { name: "Create trip" }).click();
  await page.getByRole("link", { name: tripName }).click();
  await expect(page.getByRole("heading", { name: tripName })).toBeVisible();

  const days = page.getByTestId("day-column");
  const before = await days.count();

  // Capture the confirming round-trip before clicking, but don't await it
  // yet — the assertion right below must NOT wait on it. The enqueued AddDay
  // command is predicted and applied to local state synchronously (Task
  // 11/12's optimistic overlay), so the new column is already present the
  // moment the click resolves, well before this POST round-trips.
  const confirmed = page.waitForResponse(
    (r) => /\/api\/trips\/[^/]+\/commands$/.test(new URL(r.url()).pathname) && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "+ Add day" }).click();
  await expect(days).toHaveCount(before + 1);

  // Only now wait for the command to actually land server-side — reloading
  // before this resolves would cancel the in-flight request (the browser
  // aborts pending fetches on navigation) and the day would never persist,
  // which is a test race, not an app bug.
  await confirmed;

  // Persisted server-side: a reload re-fetches the confirmed trip detail
  // (no optimistic overlay involved) and the extra day is still there.
  await page.reload();
  await expect(days).toHaveCount(before + 1);
});

test("a rejected change reverts and shows an error", async ({ page }) => {
  const tripName = `Bergen ${Date.now()}`;
  await signInAsDevUser(page, "alice");

  await page.getByRole("button", { name: "New trip" }).click();
  await page.getByLabel("Trip name").fill(tripName);
  await page.getByRole("button", { name: "Create trip" }).click();
  await page.getByRole("link", { name: tripName }).click();
  await expect(page.getByRole("heading", { name: tripName })).toBeVisible();

  // Force the single-command endpoint (AddDay is sent via sendTripCommand,
  // not the batch endpoint — see apiClient.ts) to fail server-side. A short
  // artificial delay is added before fulfilling: without it, the forced 500
  // comes back and the optimistic apply-then-revert cycle completes faster
  // than the assertion below can observe the intermediate "applied" state
  // (a test-timing issue, not an app bug — the revert itself is correct).
  await page.route("**/api/trips/*/commands", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    await new Promise((r) => setTimeout(r, 300));
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "boom" }),
    });
  });

  const days = page.getByTestId("day-column");
  const before = await days.count();

  await page.getByRole("button", { name: "+ Add day" }).click();
  // Applied optimistically first...
  await expect(days).toHaveCount(before + 1);
  // ...then reverted once the forced 500 comes back.
  await expect(days).toHaveCount(before);
  await expect(page.getByText("boom")).toBeVisible();
});
