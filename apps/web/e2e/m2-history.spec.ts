import { expect, type Page, test } from "@playwright/test";
import { dragCardTo, signInAsDevUser } from "./helpers";

// M6 made every trip-mutating command optimistic: the UI (and Playwright's
// assertions against it) update instantly from a client-side prediction,
// while the actual persist happens in the background through a queue that
// sends one command at a time. That instant-apply is exactly the behavior
// M6's own e2e spec (m6-optimistic.spec.ts) verifies — but it also means
// this spec's `page.reload()` at the dismiss step can no longer rely on the
// old "dispatch awaits the round trip" timing to have implicitly confirmed
// every prior action first. Without a wait, a reload can tear down the page
// while several commands are still queued and unsent, silently dropping
// them from the server's event log with no error (reproduced locally by
// throttling the commands endpoint: the persisted history after reload
// contained only the very first command). Waiting for each mutating
// action's own confirming response keeps at most one command in flight at
// a time, so nothing is ever queued behind an unconfirmed one when we reload.
async function waitForCommandConfirmed(page: Page, action: () => Promise<void>): Promise<void> {
  await Promise.all([
    page.waitForResponse((r) => /\/api\/trips\/[^/]+\/commands$/.test(new URL(r.url()).pathname) && r.request().method() === "POST"),
    action(),
  ]);
}

test("history: dismiss persists, undo/redo, preview, revert", async ({ page }) => {
  // Distinct prefix from smoke.spec.ts's "Rome ..." — parallel workers share
  // the "alice" dev user's trip list, and a same-millisecond Date.now() would
  // otherwise make both specs' trip names collide.
  const tripName = `Venice ${Date.now()}`;
  await signInAsDevUser(page, "alice");

  // -- setup: a day with an overlap conflict (M1 vocabulary) --
  await page.getByRole("button", { name: "New trip" }).click();
  await page.getByLabel("Trip name").fill(tripName);
  await page.getByRole("button", { name: "Create trip" }).click();
  await page.getByRole("link", { name: tripName }).click();
  await expect(page.getByRole("heading", { name: tripName, level: 2 })).toBeVisible();
  await waitForCommandConfirmed(page, () => page.getByRole("button", { name: "+ Add day" }).click());
  await expect(page.getByTestId("day-column")).toHaveCount(1);

  // "Add stop" (TripHeader) is the create-with-no-dayId trigger since Task 3.3
  // deleted the Backlog column and its "+ Add activity" button; what it makes
  // is parked in the Unscheduled drawer, which starts collapsed.
  await page.getByRole("button", { name: "Add stop" }).click();
  await page.getByLabel("Activity title").fill("Colosseum");
  await page.getByLabel("Start time").fill("09:00");
  await page.getByLabel("End time").fill("11:00");
  await waitForCommandConfirmed(page, () => page.getByRole("button", { name: "Save" }).click());
  await page.getByRole("button", { name: "Add stop" }).click();
  await page.getByLabel("Activity title").fill("Vatican Museums");
  await page.getByLabel("Start time").fill("10:00");
  await page.getByLabel("End time").fill("12:00");
  await waitForCommandConfirmed(page, () => page.getByRole("button", { name: "Save" }).click());

  const rack = page.getByTestId("unscheduled-rack");
  await rack.getByRole("button", { name: /unscheduled/i }).click();
  const day1 = page.getByTestId("day-column").nth(0);
  await waitForCommandConfirmed(page, () =>
    dragCardTo(rack.getByTestId("rack-card").filter({ hasText: "Colosseum" }), day1),
  );
  await expect(day1.getByText("Colosseum")).toBeVisible();
  await waitForCommandConfirmed(page, () =>
    dragCardTo(rack.getByTestId("rack-card").filter({ hasText: "Vatican Museums" }), day1),
  );
  await expect(day1.getByText("Vatican Museums")).toBeVisible();
  await expect(page.getByText(/overlap in time/)).toBeVisible();

  // -- persistent dismissal --
  await waitForCommandConfirmed(page, () => page.getByRole("button", { name: /^Dismiss:/ }).click());
  await expect(page.getByText(/overlap in time/)).not.toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: tripName, level: 2 })).toBeVisible();
  await expect(page.getByText(/overlap in time/)).not.toBeVisible(); // survived the reload

  // -- undo / redo (dismissal is an ordinary change) --
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText(/overlap in time/)).toBeVisible();
  await page.getByRole("button", { name: "Redo" }).click();
  await expect(page.getByText(/overlap in time/)).not.toBeVisible();

  // -- history + read-only preview + revert --
  // P2 surface move (#13): History is now a Popover trigger in the trip
  // header, and its entries render inside the popover instead of an inline
  // panel pushing page content down.
  await page.getByRole("button", { name: "History" }).click();
  await expect(page.getByTestId("history-entry").first()).toContainText("Redid: Dismissed a conflict");
  // preview the moment just before Vatican Museums moved onto Day 1:
  await page.getByRole("button", { name: 'Moved "Colosseum" to Day 1' }).click();
  await expect(page.getByText(/Viewing version \d+ \(read-only\)/)).toBeVisible();
  await expect(day1.getByText("Vatican Museums")).not.toBeVisible(); // past state
  // #16b: was "Back to now". Scoped to the open History popover (role="dialog"
  // on Radix Popover.Content) — plain "Dismiss" also matches AssistantRail's
  // per-suggestion Dismiss buttons (Task 14's M9 Preview shell, always
  // mounted regardless of lens), which would otherwise make this a strict-mode
  // violation.
  await page.getByRole("dialog").getByRole("button", { name: "Dismiss", exact: true }).click();
  await expect(day1.getByText("Vatican Museums")).toBeVisible();

  await page.getByRole("button", { name: 'Moved "Colosseum" to Day 1' }).click();
  await page.getByRole("button", { name: "Revert to here" }).click();
  await expect(page.getByText(/Viewing version/)).not.toBeVisible();
  await expect(day1.getByText("Vatican Museums")).not.toBeVisible(); // reverted for real
  await expect(day1.getByText("Colosseum")).toBeVisible();
  await expect(page.getByText(/overlap in time/)).not.toBeVisible(); // no overlap in that state
  await expect(page.getByTestId("history-entry").first()).toContainText("Reverted to version");
});
