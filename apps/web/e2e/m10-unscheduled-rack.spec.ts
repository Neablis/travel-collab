import { expect, test } from "@playwright/test";
import { createMappedTrip, dragCardTo, openHistory } from "./helpers";

// The rack's own drag behaviour can only be tested in a real browser:
// @atlaskit/pragmatic-drag-and-drop is driven by native HTML5 drag events, and
// jsdom 29 has neither DataTransfer nor DragEvent to produce them. The routing
// decision a drop resolves to (rack vs. day vs. card edge) and the drawer's
// auto-open ownership are unit-tested as pure functions instead —
// src/components/board/resolveDrop.test.ts and
// src/components/trip/rackDisclosure.test.ts.

test("a stop can be dragged into the unscheduled rack and back onto a day", async ({ page }) => {
  // Drag sequences with settle waits at both ends run well past the 30s default.
  test.setTimeout(90_000);
  // Distinct prefix from other specs' trip names — parallel workers share a DB.
  const tripName = `Rack ${Date.now()}`;
  await page.goto("/");
  const tripId = await createMappedTrip(page, tripName, 3);

  await page.goto(`/trips/${tripId}`);
  const rack = page.getByTestId("unscheduled-rack");
  // ActivityCard's testid carries the activity id (`activity-card-<uuid>`), so
  // every spec in this suite matches it by regex — there is no bare
  // "activity-card" testid to match exactly.
  const card = page.getByTestId(/activity-card-/).first();
  await card.waitFor({ state: "visible" });
  // createMappedTrip titles each day's single stop "Stop on day N", and the
  // board renders day columns in order, so the first card is day 1's. Match on
  // that title alone rather than the card's innerText: a day card also renders
  // its time window and place ("Stop on day 1\n09:00-10:00 . Place 1"), none
  // of which the rack card shows once the stop is unscheduled.
  const title = "Stop on day 1";

  // -- the drawer is present (collapsed) before the drag, and empty --
  await expect(rack).toBeVisible();
  await expect(page.getByTestId("rack-card")).toHaveCount(0);

  // The drawer auto-opens as the drag starts (Board's monitor drives the
  // rackDisclosure reducer), so this drop lands on an open drawer even though
  // the drawer was shut when the drag began.
  await dragCardTo(card, rack);

  // -- dropping on the rack unschedules and strips the time window --
  await expect(page.getByTestId("rack-card")).toHaveCount(1);
  await expect(rack.getByText(title, { exact: false })).toBeVisible();
  await expect(rack.getByText(/no time yet/i)).toBeVisible();

  // -- and back out onto a day --
  await dragCardTo(page.getByTestId("rack-card").first(), page.getByTestId("day-column").nth(1));

  // Assert the actual destination, not just that the rack emptied — a failed
  // assignment that dropped the activity from the backlog without landing it
  // on day 2 would also leave the rack at 0.
  await expect(page.getByTestId("rack-card")).toHaveCount(0);
  await expect(page.getByTestId("day-column").nth(1).getByText(title, { exact: false })).toBeVisible();
});

test("undo reverses an unschedule", async ({ page }) => {
  test.setTimeout(90_000);
  // Deliberately not "RackUndo": trip names land in the trips-list aria-label
  // ("Trip actions for <name>"), and m8-make-it-real locates the undo control
  // with getByRole("button", { name: /undo/i }) — a leftover "RackUndo ..."
  // trip matches that regex and breaks that spec with a strict-mode violation.
  const tripName = `RackHistory ${Date.now()}`;
  await page.goto("/");
  const tripId = await createMappedTrip(page, tripName, 2);

  await page.goto(`/trips/${tripId}`);
  await dragCardTo(page.getByTestId(/activity-card-/).first(), page.getByTestId("unscheduled-rack"));
  await expect(page.getByTestId("rack-card")).toHaveCount(1);

  // Unscheduling is two commands (MoveActivity, then UpdateActivity clearing
  // the window) dispatched separately, so the event log holds two user batches
  // and undo — which is per-batch (domain/src/trip/history.ts deriveUndoRedo)
  // — takes two clicks. The first restores the 09:00–10:00 window createMappedTrip
  // gave the stop while it is still parked; the second puts it back on its day.
  // They are deliberately NOT batched: batching would need dispatchBatch and
  // would make unscheduling atomic in a way that scheduling from the rack
  // (assignFromRack, also two dispatches) is not.
  await openHistory(page);
  const undo = page.getByRole("button", { name: /undo/i });
  await undo.click();
  await expect(page.getByTestId("rack-card")).toHaveCount(1);
  await expect(page.getByTestId("rack-card").first()).toContainText("09:00–10:00");

  await undo.click();
  // Assert the stop actually landed back on its original day, not just that
  // the rack emptied — same reasoning as the round-trip test above.
  await expect(page.getByTestId("rack-card")).toHaveCount(0);
  await expect(page.getByTestId("day-column").first().getByText("Stop on day 1", { exact: false })).toBeVisible();
});

test("a stop dragged out of the rack lands with a real time, taken from what it was dropped under", async ({
  page,
}) => {
  test.setTimeout(90_000);
  // Mitchell, preview feedback on PR #55: "dragging a unscheduled element into
  // the UI should set the time between the elements it was dropped between".
  // Before the fix the drag dispatched a bare MoveActivity, so a stop dragged
  // from the rack arrived on the day holding no time at all — while the day
  // dropdown (assignFromRack) gave the same stop a time. One action, two
  // outcomes, depending on how you performed it.
  const name = `RackTime ${Date.now()}`;
  const tripId = await createMappedTrip(page, name, 2);
  await page.goto(`/trips/${tripId}?lens=Board`);
  await expect(page.getByTestId("day-column")).toHaveCount(2);

  // Park day 2's stop. Unscheduling strips the window, so what comes back out
  // of the rack genuinely has no time of its own to fall back on.
  await dragCardTo(page.getByTestId("day-column").nth(1).getByTestId(/activity-card-/).first(), page.getByTestId("unscheduled-rack"));
  await expect(page.getByTestId("rack-card")).toHaveCount(1);

  // Drop it on day 1, which already holds "Stop on day 1" at 09:00-10:00.
  await dragCardTo(page.getByTestId("rack-card").first(), page.getByTestId("day-column").first());
  await expect(page.getByTestId("rack-card")).toHaveCount(0);

  // fitIntoDay searches forward from the end of the stop above it (10:00) and
  // owes 30 minutes of air where a stop butts up against the window before it,
  // so the first hour it can offer is 10:30-11:30. Asserting the exact window
  // rather than merely "has a time": the point of the fix is that the time is
  // derived from the drop's neighbour, and any window would pass a weaker
  // check — including the 09:00-10:00 one that would mean it had overlapped.
  const landed = page.getByTestId("day-column").first().getByText("Stop on day 2", { exact: false });
  await expect(landed).toBeVisible();
  await expect(page.getByTestId("day-column").first()).toContainText("10:30–11:30");
});
