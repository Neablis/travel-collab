import { expect, test } from "@playwright/test";
import { createMappedTrip } from "./helpers";
import { e2eTripName } from "./tripNames";

// M10 Wave 2 Phase 6's own gate, scripted: "adding a day appends it, scrolls
// to it, and it renders correctly in Timeline, Day columns, Calendar and Map."
//
// This spec exists because the phase file's Step 4 asks for that walk in a real
// browser and the container this phase was built in has no interactive one. It
// is deliberately a gate script rather than a unit test: every claim in it —
// that AddDay reaches the server, that the appended day comes back dated the
// day after the last, that all four views agree about it — is a claim about the
// whole stack, and the empty-day copy is only honest if the day really is empty
// in the projection rather than in a fixture.

test("adding a day appends it and every view renders it as an empty day", async ({ page }) => {
  // Distinct prefix from other specs' trip names — parallel workers share a DB.
  const tripName = e2eTripName("Growth");
  await page.goto("/");
  const tripId = await createMappedTrip(page, tripName, 2);
  await page.goto(`/trips/${tripId}`);

  // -- Timeline: the end-of-trip block closes the plan --
  // The trip page lands on Day columns, not Timeline (LensRouter.tsx defaults
  // `lens` to "Board"), so the Timeline tab is a real navigation step here.
  await page.getByRole("tab", { name: "Timeline" }).click();
  await expect(page.getByTestId("end-of-trip")).toBeVisible();
  await expect(page.getByText("End of the trip")).toBeVisible();
  // createMappedTrip gives every day exactly one stop, so before the add there
  // is no empty day anywhere and none of the empty-day copy may appear.
  await expect(page.getByText("Nothing planned yet")).toHaveCount(0);
  await expect(page.getByTestId(/timeline-row-/)).toHaveCount(2);

  // -- "Add a day" is real --
  // exact: the same block also carries the inert "Add a saved day", which a
  // substring match (Playwright's default for `name`) would collide with.
  await page.getByRole("button", { name: "Add a day", exact: true }).click();
  await expect(page.getByTestId(/timeline-row-/)).toHaveCount(3);

  // The appended day is empty, and says so in the two places the copy table
  // names — the day's route line and the day's body.
  await expect(page.getByText("No stops yet — add one, or drop a saved day onto it")).toBeVisible();
  await expect(page.getByText("Nothing planned yet")).toBeVisible();
  // ...and offers the first stop rather than a stop "after" a time it hasn't got.
  await expect(page.getByRole("button", { name: "Add the first stop" })).toBeVisible();

  // The new day scrolled into view. `scrollIntoView({ block: "center" })` is
  // what the lens calls, so assert the day header is actually in the viewport
  // rather than merely attached — the whole point of the scroll.
  const newDayHeader = page.getByTestId(/timeline-dayhead-/).last();
  await expect(newDayHeader).toBeInViewport();

  // -- Day columns --
  await page.getByRole("tab", { name: "Day columns" }).click();
  await expect(page.getByTestId("day-column")).toHaveCount(3);
  // The trailing column replaced the loose "+ Add day" button.
  await expect(page.getByTestId("one-more-day-column")).toBeVisible();
  await expect(page.getByText("One more day?")).toBeVisible();
  await expect(page.getByRole("button", { name: "+ Add day" })).toHaveCount(0);
  // The empty column is not a blank gap: it carries a route to a stop.
  const lastColumn = page.getByTestId("day-column").last();
  await expect(lastColumn.getByRole("button", { name: /^Add activity to / })).toBeVisible();

  // -- Calendar --
  await page.getByRole("tab", { name: "Calendar" }).click();
  // Exactly one in-trip cell says it: the two seeded days each have a stop.
  await expect(page.getByText("Nothing planned yet")).toHaveCount(1);
  // The day the add appended, dated the day after the last — three in-trip
  // cells now, which is also the proof AddDay reached the projection.
  await expect(page.locator('[data-testid="calendar-cell"][data-in-trip="true"]')).toHaveCount(3);

  // -- Map --
  await page.getByRole("tab", { name: "Map" }).click();
  // Same locator m10-map-rail.spec.ts uses — the rail has no testid, it is
  // identified by its own aria-label.
  const rail = page.locator('[aria-label="Days"]');
  await expect(rail).toBeVisible();
  // The rail's own empty-day copy, which is deliberately NOT the focus card's.
  await expect(rail.getByText("Nothing planned yet")).toBeVisible();
  // Focusing that day swaps to the focus card's wording for the same day.
  await rail.locator("[data-day-index]").last().click();
  await expect(page.getByText("No stops yet")).toBeVisible();
});

// Mitchell, 2026-09-01: *"Scrolling down the timeline or Left/Right in the days
// column should change the selected day in the header bar."*
//
// Only a real browser can prove either half — jsdom has no layout, so the
// scroll spy has nothing to measure there and the pure arithmetic behind it
// (`centralDay.ts`) is all a unit test can reach. What this asserts is the
// wiring: a scroll and an arrow key both move the ring on the day-chips row.
test("the header's selected day follows the timeline's scroll and the columns' arrow keys", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const tripName = e2eTripName("FollowDay");
  // Enough days that the last one is far off the bottom of any viewport, so
  // scrolling to it is a real scroll rather than a no-op.
  const tripId = await createMappedTrip(page, tripName, 12);

  /** The 0-based index of the chip currently ringed, or null. */
  const selectedChip = () =>
    page.locator('[aria-label="Days"] button[aria-pressed="true"]');

  // ── The timeline, vertically ──────────────────────────────────────────────
  await page.goto(`/trips/${tripId}?lens=Schedule&view=Timeline`);
  await expect(page.getByTestId("timeline-lens")).toBeVisible();
  // Every day header, not merely the lens: the spy measures the headers, and
  // scrolling before the last one has laid out scrolls a document that is still
  // one screen tall — which lands back on day 1 and fires no further event to
  // correct it. That is a race in the TEST, not in the page, and waiting for
  // the count is what removes it.
  await expect(page.locator('[data-testid^="timeline-dayhead-"]')).toHaveCount(12);
  // Nothing is selected on arrival — the ring only appears once something has
  // said which day you are on, which is exactly what the scroll is about to do.
  await expect(selectedChip()).toHaveCount(0);

  await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight }));
  // The spy coalesces to one measurement per frame, so these are retrying
  // assertions rather than waits on a duration.
  await expect
    .poll(async () => Number(await selectedChip().getAttribute("data-day-index")))
    .toBeGreaterThan(0);
  const atBottom = Number(await selectedChip().getAttribute("data-day-index"));

  await page.evaluate(() => window.scrollTo({ top: 0 }));
  await expect
    .poll(async () => Number(await selectedChip().getAttribute("data-day-index")))
    .toBeLessThan(atBottom);

  // ── The day columns, horizontally ─────────────────────────────────────────
  await page.goto(`/trips/${tripId}?lens=Board`);
  const columns = page.getByTestId("day-column");
  await expect(columns.first()).toBeVisible();

  // Pick day 1 from its own column header, then walk right with the keyboard.
  await columns.first().getByRole("button", { name: /^Day 1/ }).click();
  await expect(selectedChip()).toHaveAttribute("data-day-index", "0");
  await page.keyboard.press("ArrowRight");
  await expect(selectedChip()).toHaveAttribute("data-day-index", "1");
  await page.keyboard.press("ArrowLeft");
  await expect(selectedChip()).toHaveAttribute("data-day-index", "0");
  // Clamped, not wrapped: arrowing off the first day back to the last would be
  // a jump the length of the trip.
  await page.keyboard.press("ArrowLeft");
  await expect(selectedChip()).toHaveAttribute("data-day-index", "0");
});

