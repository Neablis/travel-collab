import { expect, test, type Page } from "@playwright/test";
import { dragCardTo } from "./helpers";

// KI-5 (C4): every command below is optimistic-first, so waiting for its
// confirming round-trip before firing the next one (same pattern as
// m6-optimistic.spec.ts) is what keeps this deterministic rather than racing
// the send queue — and it's the exact risk the "all changes saved" assertion
// near the end is checking for.
function waitForCommand(page: Page) {
  return page.waitForResponse(
    (r) => /\/api\/trips\/[^/]+\/commands$/.test(new URL(r.url()).pathname) && r.request().method() === "POST",
  );
}

test("create, name, date, build, reorder, rename, delete", async ({ page }) => {
  // Distinct prefix from other specs' trip names — parallel workers share the
  // "alice" dev user's trip list (m1/m3/m6's comment).
  const tripName = `Rochester ${Date.now()}`;

  // e2e has no real LOCATIONIQ_API_KEY — stub the app's own /api/geocode
  // route, same approach as m3-place-and-time.spec.ts.
  await page.route("**/api/geocode**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        results: [{ lat: 43.0896, lng: -79.0849, canonicalName: "Niagara Falls, ON, Canada", countryCode: "CA" }],
      }),
    });
  });

  await page.goto("/");

  await page.getByRole("button", { name: "New trip" }).click();
  await page.getByLabel("Trip name").fill(tripName);
  await page.getByRole("button", { name: "Create empty" }).click();
  await page.getByRole("link", { name: tripName }).click();
  // level:2 disambiguates TripHeader's h2 from TripCard's own h3 heading.
  await expect(page.getByRole("heading", { name: tripName, level: 2 })).toBeVisible();

  // -- a start date, then 3 real days (Task 8b.6: the end is derived, never
  // picked — TripDateControl only sets the start, so a range is built via
  // the board's own "Add a day", the same always-real control m1-board.spec.ts
  // and friends already use, not the removed end-date field). --
  // TripDateControl is reached via the Settings sheet's Dates row, which
  // opens a popover mounting it (restored, M10 Phase 4 — see
  // docs/known-issues.md's former D-2 entry).
  await page.getByRole("button", { name: /trip settings/i }).click();
  await page.getByRole("button", { name: /dates/i }).click();
  // TripDateControl commits on selection, not on Done (feedback fix,
  // 2026-08-24) — filling the complete date is the commit itself.
  await Promise.all([waitForCommand(page), page.getByLabel(/trip start date/i).fill("2026-08-03")]);
  await page.getByRole("button", { name: /close/i }).click();
  await Promise.all([waitForCommand(page), page.getByRole("button", { name: "Add a day", exact: true }).click()]);
  await Promise.all([waitForCommand(page), page.getByRole("button", { name: "Add a day", exact: true }).click()]);
  await Promise.all([waitForCommand(page), page.getByRole("button", { name: "Add a day", exact: true }).click()]);
  await expect(page.getByTestId("day-column")).toHaveCount(3);

  // -- existing activity editor (ActivityEditor.tsx), same pattern as
  // m1-board.spec.ts. Task 3.3 deleted the Backlog column that used to carry
  // the "+ Add activity" trigger; the header's "Add stop" is the same
  // openCreate() with no dayId, and it is unambiguous too (each day column's
  // own button is labelled "Add activity to Day N"). What it creates is parked
  // in the Unscheduled drawer, which starts collapsed. --
  const rack = page.getByTestId("unscheduled-rack");
  await page.getByRole("button", { name: "Add stop" }).click();
  await page.getByLabel("What or where").fill("Coffee");
  await Promise.all([waitForCommand(page), page.getByRole("button", { name: "Add stop" }).last().click()]);
  await rack.getByRole("button", { name: /unscheduled/i }).click();
  await expect(rack.getByTestId("rack-card").filter({ hasText: "Coffee" })).toBeVisible();

  // Existing location search (LocationInput.tsx), same pattern as
  // m3-place-and-time.spec.ts — no dedicated AddPlaceButton exists.
  await page.getByRole("button", { name: "Add stop" }).click();
  await page.getByLabel("What or where").fill("Niagara Falls");
  await page.getByLabel("Place name").fill("Niagara Falls");
  await page.getByRole("button", { name: "Search" }).click();
  await page.getByRole("option", { name: /niagara falls/i }).click();
  await Promise.all([waitForCommand(page), page.getByRole("button", { name: "Add stop" }).last().click()]);
  // Scoped to the rack card rather than a bare text match: a rack card shows
  // the title and the geocoded area, and the area for this place is itself
  // "Niagara Falls", so a text locator would be ambiguous.
  await expect(rack.getByTestId("rack-card").filter({ hasText: "Niagara Falls" })).toBeVisible();

  // -- reorder: existing drag-and-drop (dragCardTo), same pattern as
  // m1-board.spec.ts/m3-place-and-time.spec.ts — no per-card "move to…" menu
  // exists. --
  const coffee = rack.getByTestId("rack-card").filter({ hasText: "Coffee" });
  const day3 = page.getByTestId("day-column").nth(2);
  await Promise.all([waitForCommand(page), dragCardTo(coffee, day3)]);
  await expect(day3.getByText("Coffee")).toBeVisible();

  // -- rename --
  // Stays unique (not a fixed literal like "Rochester 2026") for the same
  // reason `tripName` itself is timestamped — a repeated local run against a
  // persistent dev DB would otherwise leave multiple same-named trips behind
  // and make the "Trip actions for …" lookup below ambiguous.
  const renamedTripName = `${tripName} renamed`;
  await page.getByRole("button", { name: /rename trip/i }).click();
  const renameInput = page.getByRole("textbox", { name: /trip name/i });
  await renameInput.fill(renamedTripName);
  await Promise.all([waitForCommand(page), renameInput.press("Enter")]);
  // getByRole("heading", ...), not getByText: the Assistant rail's real
  // context line ("Looking at {trip name}", M10 redesign-feedback follow-up)
  // now also contains the renamed trip's name as a substring — Playwright's
  // getByText matches substrings by default, so it resolves to both that
  // <div> and TripHeader's actual h2 unless scoped to the heading role.
  await expect(page.getByRole("heading", { name: renamedTripName, level: 2 })).toBeVisible();

  // Task 8b.3: the saved state no longer renders visible text (a bare dot
  // only) — "All changes saved" lives on the status element's accessible
  // name (title/aria-label) instead, so this asserts that, not text content.
  await expect(page.getByRole("status", { name: "All changes saved" })).toBeVisible(); // KI-5, C4

  // -- delete + undo, from the trip list --
  await page.goto("/");
  await page.getByRole("button", { name: new RegExp(`trip actions for ${renamedTripName}`, "i") }).click();
  await page.getByRole("menuitem", { name: /delete/i }).click();
  await page.getByRole("button", { name: /^delete$/i }).click();
  // getByRole("heading", ..., level: 3), not getByText: same substring
  // collision as the rename assertion above — the "Deleted "..."" undo toast
  // this click raises contains the trip's own name as a substring, so a bare
  // getByText(renamedTripName) transiently matches the toast itself right
  // after deletion (observed flaky in CI: the assertion raced the toast's
  // own visible window). Trip cards on the list render as level-3 headings
  // (smoke.spec.ts's own assertion already relies on this).
  await expect(page.getByRole("heading", { name: renamedTripName, level: 3 })).not.toBeVisible();

  await page.getByRole("button", { name: /undo/i }).click(); // restore
  await expect(page.getByRole("heading", { name: renamedTripName, level: 3 })).toBeVisible();
});
