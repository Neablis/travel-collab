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
  await page.goto(`/trips/${tripId}?view=Plan`);

  // **The Timeline leg of this walk is gone with the lens** (SPEC §24 deletes
  // it rather than hiding it), and with it the end-of-trip block, the
  // `timeline-row` count and the scroll-into-view assertion — all three were
  // that lens's own markup. What the leg was really proving is that `AddDay`
  // reaches the projection and that EVERY remaining view renders the appended
  // day as empty, which is what the three legs below do.

  // -- Plan (was "Day columns" — §24 renamed the tab on both surfaces) --
  await page.getByRole("tab", { name: "Plan" }).click();
  await page.getByRole("button", { name: "Add a day", exact: true }).click();
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
// **The timeline half of this walk is gone with the timeline** (SPEC §24
// deletes the lens rather than hiding it), so what is left is the day columns'
// half — which is the half that still has a surface. The vertical scroll-spy it
// used to drive was `TimelineLens`' own; `FocusProvider`'s day-sync contract is
// unchanged and its remaining containers are the chips row and the columns.
test("the header's selected day follows the columns' arrow keys", async ({
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

  // ── The day columns, horizontally ─────────────────────────────────────────
  await page.goto(`/trips/${tripId}?view=Plan`);
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


// The day-sync contract, end to end. `FocusProvider`'s header states it; this
// is where it is actually proved, because every clause in it is about layout:
//
//   1. scrolling a day container moves the selection;
//   2. selecting a day scrolls it into view in every day container on screen;
//   3. switching tabs scrolls the newly-shown lens to the selected day.
//
// Mitchell filed it as two toolbar comments from a phone (2026-09-01) — "*this
// is the modus operandi for every tab that can scroll and a day is
// selectable*" — so these run at his width, 411px, where the chips row is the
// primary day control and everything is narrow enough that "in view" is a real
// question rather than a formality.
//
// The jsdom lane can reach none of it: no layout means no reading line, no
// scroll position, and no `scrollIntoView`. What IS unit-tested is the pure
// arithmetic (`centralDay.test.ts`) and the state machine that decides who
// follows whom (`FocusProvider.test.tsx`); the wiring between them is here.
test("every day container follows the selection, and any of them can move it", async ({ page }) => {
  test.setTimeout(90_000);
  const tripName = e2eTripName("DaySync");
  // Ten days: enough that at this width most of them are off-screen in every
  // container, so "scrolled into view" cannot pass by accident.
  //
  // 800px, not the 411px this used to use. Two reasons, and the second is the
  // one that matters:
  //
  // 1. SPEC §10 ("two views, not four") keeps Day columns off the phone, so a
  //    Day-columns test below 768px is a combination the product no longer has
  //    — the lens strip clause 3 drives is hidden there.
  // 2. **411px was hiding a real defect.** A centre reading line
  //    (`centralDay.ts`, `READING_LINE.horizontal`) cannot name the first or
  //    last day once more than about two 268px columns fit. Measured at 800px:
  //    the line sits at 400 and the first three column centres are 158 / 438 /
  //    718, so with the row scrolled fully left the spy honestly reports day 2
  //    — and it used to overwrite an explicit pick of day 1 the moment the
  //    jump lock was released. At 411px only ~1.5 columns fit, day 1 IS the
  //    central day, and the whole class of bug was invisible. Clicking "Day 1"
  //    and watching it snap to "Day 2" is what a reader saw at every desktop
  //    width; the fix is in `FocusProvider`'s `jumpTo` (a jump that could not
  //    move because it was clamped keeps its lock instead of releasing it).
  const tripId = await createMappedTrip(page, tripName, 10);
  await page.setViewportSize({ width: 800, height: 760 });
  await page.goto(`/trips/${tripId}?view=Plan`);

  // The chips row and the day columns are both `role="group"`, told apart by
  // their names — the rail on the Map lens is a bare `aria-label="Days"` div
  // with no role, so it can never collide with this.
  const chips = page.getByRole("group", { name: "Days" });
  const columns = page.getByTestId("day-column");
  await expect(columns).toHaveCount(10);
  const selectedChip = () => chips.locator('button[aria-pressed="true"]');
  const dayIndexOf = async (locator: ReturnType<typeof selectedChip>) =>
    Number(await locator.getAttribute("data-day-index"));

  // ── Clause 1, on the surface Mitchell selected ────────────────────────────
  // "scrolling here should also change the selected date below"
  await expect(selectedChip()).toHaveCount(0);
  await chips.evaluate((row) => {
    row.scrollLeft = row.scrollWidth;
  });
  // Retrying assertions rather than waits on a duration: the spy coalesces to
  // one measurement per frame.
  await expect.poll(async () => dayIndexOf(selectedChip())).toBeGreaterThan(0);
  const fromScroll = await dayIndexOf(selectedChip());

  // ── Clause 2, the half that was missing entirely ──────────────────────────
  // "sync the scrolling between the two": the columns followed the row that
  // was scrolled, without the columns' own spy then dragging the selection
  // back — that loop is what the jump lock exists to break, and a failure here
  // is what it would look like.
  await expect(columns.nth(fromScroll)).toBeInViewport();
  await expect.poll(async () => dayIndexOf(selectedChip())).toBe(fromScroll);

  // ── Clause 2, the other direction ─────────────────────────────────────────
  // "Clicking a day selects and scrolls to that day in both containers."
  // Day 1 is off-screen in both by now, so both have somewhere to go.
  await columns.first().getByRole("button", { name: /^Day 1/ }).click();
  await expect(selectedChip()).toHaveAttribute("data-day-index", "0");
  await expect(columns.nth(0)).toBeInViewport();
  await expect(chips.locator('[data-day-index="0"]')).toBeInViewport();

  // ── Clause 3 ──────────────────────────────────────────────────────────────
  // "Changing the tab jumps to the selected day." Selected from a column, then
  // read in two lenses that were not even mounted when the choice was made.
  //
  // No viewport change here: the whole test runs at the 800px set at the top.
  // This clause is the one that drives the LENS STRIP, and SPEC §10 ("two
  // views, not four") hides that strip below 768px — which is the other reason
  // 411px is no longer a viable width for this test, alongside the reading-line
  // geometry described up there.
  await columns.last().getByRole("button", { name: /^Day 10/ }).click();
  await expect(selectedChip()).toHaveAttribute("data-day-index", "9");

  // The Timeline leg of clause 3 went with the lens (SPEC §24). Calendar below
  // is the surviving "a view that was not mounted when the choice was made
  // still opens on the chosen day", which is the whole of what this clause
  // claims — and it is the stricter of the two, because Calendar is driven-only
  // and cannot accidentally satisfy the assertion by having driven the choice.

  // The calendar is driven but never driving (see `DayContainer`): it scrolls
  // on two axes and neither of them is the trip-day axis, so it takes clause 3
  // without taking clause 1.
  await page.getByRole("tab", { name: "Calendar" }).click();
  await expect(page.locator('[data-testid="calendar-cell"][data-day-index="9"]')).toBeInViewport();
});

// Mitchell's second comment, on `/demo?view=Map` from the same phone:
// *"scrolling here on mobile should change the selected day"*. The strip used
// to focus by tap only.
test("scrolling the phone map's day strip changes the selected day", async ({ page }) => {
  test.setTimeout(90_000);
  const tripId = await createMappedTrip(page, e2eTripName("MapStripScroll"), 10);
  await page.setViewportSize({ width: 411, height: 760 });
  await page.goto(`/trips/${tripId}?view=Map`);

  const strip = page.getByTestId("map-day-strip");
  await expect(strip).toBeVisible();
  const track = strip.getByRole("group", { name: "Days" });
  const selected = () => track.locator('button[aria-pressed="true"]');

  // Arriving at the map picks day 1 when nothing is selected (MapLens), which
  // also makes this the case that would break if the jump lock were held for a
  // scroll that moved nothing: that default focus scrolls the strip to a chip
  // already at scrollLeft 0, and a lock left standing there would swallow the
  // first 300ms of the flick this test then performs.
  await expect(selected()).toHaveAttribute("data-day-index", "0");

  await track.evaluate((row) => {
    row.scrollLeft = row.scrollWidth;
  });
  await expect
    .poll(async () => Number(await selected().getAttribute("data-day-index")))
    .toBeGreaterThan(0);
  // The detail line under the strip is the focused day's, so it moved too —
  // the strip's selection is the map's selection, not a second one.
  await expect(page.getByTestId("map-day-strip-detail")).toContainText(/stop|km/);
});
