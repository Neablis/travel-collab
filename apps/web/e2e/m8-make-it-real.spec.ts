import { expect, test, type Page } from "@playwright/test";
import { dragCardTo } from "./helpers";
import { e2eTripName, escapeForRegExp } from "./tripNames";

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
  const tripName = e2eTripName("Rochester");

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
  // the former D-2 entry in docs/known-issues/).
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
  // Renaming moved into Trip settings: the header's pencil is gone and the
  // trip title itself is the button that opens the sheet (design RULES pass,
  // 2026-08-25 — "the trip name + state badge are one button that opens Trip
  // settings, where the name field already lived"). The title's accessible
  // name is "<trip name> — Trip settings", which this substring matches.
  await page.getByRole("button", { name: /trip settings/i }).click();
  const renameInput = page.getByRole("textbox", { name: /trip name/i });
  await renameInput.fill(renamedTripName);
  // Commit-on-blur, so Enter (which blurs) is still what sends the command.
  await Promise.all([waitForCommand(page), renameInput.press("Enter")]);
  // Close the sheet so the assertions below see the header, not the overlay.
  await page.keyboard.press("Escape");
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
  // KI-28: the home page fans out one `GET /api/trips/:id` per visible card to
  // fill in each card's cost line, and that line landing grows the target
  // card's *own* row (~73px, measured 2026-08-24). The actions menu is
  // anchored to that row, and Radix positions it with `strategy: "fixed"` and
  // `shift({ limiter: limitShift() })` — so an open menu *follows* its anchor
  // instead of repositioning, and a row that grows underneath it lands the
  // Delete item either behind a neighbouring card (a hit-target interception)
  // or off-screen entirely ("element is outside of the viewport"). Waiting for
  // this card's own cost line settles the anchor before the gesture starts,
  // the same way KI-21's pre-drag `scrollIntoViewIfNeeded` settled both ends
  // of a drag rather than widening a timing budget. Either branch of
  // `plannedOfBudgetLine` (lib/cost.ts) proves the fetch resolved.
  const tripCard = page.getByTestId("trip-card").filter({ hasText: renamedTripName });
  await expect(tripCard.getByText(/planned of|No budget yet/)).toBeVisible();
  await page.getByRole("button", { name: new RegExp(`trip actions for ${escapeForRegExp(renamedTripName)}`, "i") }).click();
  await page.getByRole("menuitem", { name: /delete/i }).click();
  await page.getByRole("button", { name: /^delete$/i }).click();
  // getByRole("heading", ..., level: 3), not getByText: same substring
  // collision as the rename assertion above — the "Deleted "..."" undo toast
  // this click raises contains the trip's own name as a substring, so a bare
  // getByText(renamedTripName) transiently matches the toast itself right
  // after deletion (observed flaky in CI: the assertion raced the toast's
  // own visible window). Trip cards on the list render as level-3 headings
  // (smoke.spec.ts's own assertion already relies on this).
  // eslint-disable-next-line playwright/no-useless-not -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
  await expect(page.getByRole("heading", { name: renamedTripName, level: 3 })).not.toBeVisible();

  await page.getByRole("button", { name: /undo/i }).click(); // restore
  await expect(page.getByRole("heading", { name: renamedTripName, level: 3 })).toBeVisible();
});

// KI-28 regression (the product-side half). The home page fans out one
// `GET /api/trips/:id` per visible card — plus one for the hero above the
// grid — to fill in each "planned of budget" line. Those responses used to
// GROW the row they land in: 24px per card, 27px on the hero. Radix positions
// the per-card actions menu with `strategy: "fixed"` and
// `shift({ limiter: limitShift() })`, so an already-open menu FOLLOWS its
// anchor instead of repositioning — every one of those pixels moved the open
// menu out from under wherever the pointer was aimed. Measured on the trip
// list before the fix: 27px of drift for a card in the first grid row, 75px
// for one further down, with the point aimed at "Delete" landing on
// "Duplicate", or on a neighbouring card entirely — which is the
// `<h3 …> intercepts pointer events` / `element is outside of the viewport`
// pair the CI flake reported.
//
// The fix reserves the cost line's height (TripCard/NextTripHero), so this
// test does what waiting cannot: it holds the whole fan-out until the menu is
// already open, then releases it and asserts nothing moved. Deterministic —
// it fails on the un-fixed build every run, not one run in twenty.
test("an open trip-actions menu does not drift when the cost lines land", async ({ page }) => {
  const tripName = e2eTripName("Anchor");

  await page.goto("/");
  await page.getByRole("button", { name: "New trip" }).click();
  await page.getByLabel("Trip name").fill(tripName);
  await page.getByRole("button", { name: "Create empty" }).click();
  await expect(page.getByRole("heading", { name: tripName, level: 3 })).toBeVisible();

  // Hold every per-card TripDetail response until `release()`, then reload:
  // that is the cold-load state the drift needs, produced on purpose instead
  // of waited for. Only the detail fetches are held — the list request
  // (`/api/trips`) has no id segment and passes straight through.
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(/\/api\/trips\/[^/?]+$/, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    await held;
    await route.continue();
  });
  await page.goto("/");

  const card = page.getByTestId("trip-card").filter({ hasText: tripName });
  await expect(card).toBeVisible();
  const cardBefore = (await card.boundingBox())!;

  await page.getByRole("button", { name: new RegExp(`trip actions for ${escapeForRegExp(tripName)}`, "i") }).click();
  const deleteItem = page.getByRole("menuitem", { name: /delete/i });
  await expect(deleteItem).toBeVisible();
  const menuBefore = (await deleteItem.boundingBox())!;
  // The point a click aimed at "Delete" would use, captured while the cost
  // lines are still in flight.
  const aim = { x: menuBefore.x + menuBefore.width / 2, y: menuBefore.y + menuBefore.height / 2 };

  release();
  await expect(card.getByText(/planned of|No budget yet/)).toBeVisible();
  // Two frames, not a sleep: enough for layout plus any repositioning Radix
  // would do in response, and it ends at a real event rather than a guess.
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(null)))),
  );

  const cardAfter = (await card.boundingBox())!;
  const menuAfter = (await deleteItem.boundingBox())!;
  // 3px, not 0: the reserved slot and the filled line differ by ~0.2px of
  // line box, which accumulates to ~2px across a long list. The defect this
  // guards starts at 24px (one card's own growth) and was measured at 75px.
  expect(Math.abs(cardAfter.height - cardBefore.height)).toBeLessThan(3);
  expect(Math.abs(menuAfter.y - menuBefore.y)).toBeLessThan(3);

  // The sharp end of it: whatever the pointer was aimed at must still be
  // under the pointer. Before the fix this resolved to the "Duplicate" item
  // or to a neighbouring trip card.
  const underAim = await page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    if (!el) return "(nothing — outside the viewport)";
    const item = el.closest('[role="menuitem"]');
    return item ? (item.textContent ?? "").trim() : `not a menu item: <${el.tagName.toLowerCase()}>`;
  }, aim);
  expect(underAim).toBe("Delete");

  // ...and it is still a working Delete, not merely a stationary one.
  // Deleting for real also keeps this test from leaving a card behind in the
  // shared "alice" trip list.
  await deleteItem.click();
  await page.getByRole("button", { name: /^delete$/i }).click();
  // eslint-disable-next-line playwright/no-useless-not -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
  await expect(page.getByRole("heading", { name: tripName, level: 3 })).not.toBeVisible();
});
