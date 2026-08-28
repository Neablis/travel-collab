import { expect, test } from "@playwright/test";
import { e2eTripName } from "./tripNames";

test("optimistic add renders instantly and persists", async ({ page }) => {
  // Distinct prefix from other specs' trip names — parallel workers share the
  // "alice" dev user's trip list, and a same-millisecond Date.now() would
  // otherwise make specs' trip names collide (see m3/m4's comment).
  const tripName = e2eTripName("Oslo");
  await page.goto("/");

  await page.getByRole("button", { name: "New trip" }).click();
  await page.getByLabel("Trip name").fill(tripName);
  await page.getByRole("button", { name: "Create empty" }).click();
  await page.getByRole("link", { name: tripName }).click();
  await expect(page.getByRole("heading", { name: tripName, level: 2 })).toBeVisible();

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
  await page.getByRole("button", { name: "Add a day", exact: true }).click();
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

test("a rejected change stays visible, shows an error, and can be retried", async ({ page }) => {
  const tripName = e2eTripName("Bergen");
  await page.goto("/");

  await page.getByRole("button", { name: "New trip" }).click();
  await page.getByLabel("Trip name").fill(tripName);
  await page.getByRole("button", { name: "Create empty" }).click();
  await page.getByRole("link", { name: tripName }).click();
  await expect(page.getByRole("heading", { name: tripName, level: 2 })).toBeVisible();

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

  await page.getByRole("button", { name: "Add a day", exact: true }).click();
  // Applied optimistically first...
  await expect(days).toHaveCount(before + 1);
  // ...and KI-36: it STAYS applied when the send fails. The queue is retained
  // with a recorded failure instead of discarded, so the user's work is still
  // on screen and still sendable. This assertion previously read
  // `toHaveCount(before)` — it encoded the silent discard KI-36 is about, and
  // was accurate about the code rather than right about the product.
  await expect(days).toHaveCount(before + 1);
  await expect(page.getByText("boom")).toBeVisible();
  // The failure is visible in the sync indicator, with a way out of it.
  await expect(page.getByRole("status")).toHaveAttribute("aria-label", /Couldn't save/);
  const retry = page.getByRole("button", { name: /^Retry saving/ });
  await expect(retry).toBeVisible();

  // Retry drains the retained queue once the server stops failing — the half
  // that makes retention worth anything. Without this, a retained queue is
  // just a stuck queue.
  await page.unroute("**/api/trips/*/commands");
  // Wait on the retried POST's own 2xx, not on the indicator's label. The label
  // is a render away from the response and reloading on it races the write:
  // observed once in a full-suite run as a reload that found zero days.
  const retried = page.waitForResponse(
    (r) => r.url().includes("/commands") && r.request().method() === "POST" && r.ok(),
  );
  await retry.click();
  await retried;
  await expect(page.getByRole("status")).toHaveAttribute("aria-label", "All changes saved");

  // The strong check: reload discards all in-memory optimistic state, so a day
  // still here came from the server's event log, not the client's prediction.
  await page.reload();
  await expect(page.getByTestId("day-column")).toHaveCount(before + 1);
});
