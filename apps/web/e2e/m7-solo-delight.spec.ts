import { expect, type Page, test } from "@playwright/test";
import { dragCardTo, signInAsDevUser } from "./helpers";

// Waits for a command's confirming POST to land before returning. Needed
// anywhere this spec navigates away from the board (Notebook is a separate
// route subtree — a real navigation, not a lens tab switch) or does a hard
// `page.goto` reload: per m6-optimistic.spec.ts, a command applied
// optimistically but not yet confirmed is lost if the page reloads (and, per
// m3-place-and-time.spec.ts's undo comment, can lose a race with the trip's
// version if the next command fires before it lands). The UI shows the
// optimistic result instantly regardless, so without this wait the assertion
// right after `action()` would pass even though the change won't survive a
// later reload.
async function waitForConfirmedCommand(page: Page, action: () => Promise<void>): Promise<void> {
  await Promise.all([
    page.waitForResponse(
      (r) => /\/api\/trips\/[^/]+\/commands$/.test(new URL(r.url()).pathname) && r.request().method() === "POST" && r.ok(),
    ),
    action(),
  ]);
}

// M7 exit-gate demo, scripted: Notebook route + the two lazily-instantiated
// default pages, a trip-wide macro that reacts to a board change, a
// day-bound page rebindable via DayBindingControl, and the `{{` macro
// autocomplete. See docs/milestones/M7-solo-delight.md's exit gate.
//
// AI: the exit gate's "AI demo" step (prompt → composed page / atomic batch)
// deliberately has NO e2e coverage here. Playwright drives a real running
// dev server, and there is no test-mode seam today to swap in a mocked
// `LanguageModel` for a live Next.js process without real infra work
// (env-gated test routing, an in-server MSW setup, etc.) — out of scope for
// this task. Mitchell's hard constraint: no e2e test may ever make a real
// call to the Vercel AI Gateway or any model provider (token cost). So this
// spec only asserts `ComposePanel` renders (prompt box + submit button);
// the actual compose behavior against a mocked model is covered by
// apps/web/src/app/api/trips/[tripId]/ai/route.int.test.ts.
test("solo delight: notebook, dynamic pages, day binding, autocomplete", async ({ page }) => {
  // Distinct prefix from other specs' trip names — parallel workers share the
  // "alice" dev user's trip list, and a same-millisecond Date.now() would
  // otherwise make specs' trip names collide (see m3/m4's comment).
  const tripName = `Faro ${Date.now()}`;
  await signInAsDevUser(page, "alice");

  await page.getByLabel("Trip name").fill(tripName);
  await page.getByRole("button", { name: "Create trip" }).click();
  await page.getByRole("link", { name: tripName }).click();
  await expect(page.getByRole("heading", { name: tripName })).toBeVisible();
  const tripUrl = page.url();

  // Two days: makes Day Sheet's default day-0 binding valid the moment it's
  // lazily instantiated, and gives a second day to rebind onto later. Waited
  // (see waitForConfirmedCommand) since we navigate away to the Notebook
  // right after — an unconfirmed AddDay wouldn't survive that.
  await waitForConfirmedCommand(page, () => page.getByRole("button", { name: "+ Add day" }).click());
  await expect(page.getByTestId("day-column")).toHaveCount(1);
  await waitForConfirmedCommand(page, () => page.getByRole("button", { name: "+ Add day" }).click());
  await expect(page.getByTestId("day-column")).toHaveCount(2);

  // -- open the trip's Notebook: the two default pages exist --
  await page.getByRole("link", { name: "Notebook" }).click();
  await expect(page.getByRole("heading", { name: "Notebook" })).toBeVisible();
  const overviewLink = page.getByRole("link", { name: /Trip Overview/ });
  const daySheetLink = page.getByRole("link", { name: /Day Sheet/ });
  await expect(overviewLink).toBeVisible();
  await expect(daySheetLink).toBeVisible();

  // -- Trip Overview: name/dates/cost total + itinerary render (pre-cost) --
  await overviewLink.click();
  await expect(page.getByRole("heading", { name: "Trip Overview" })).toBeVisible();
  await expect(page.locator('[data-macro-name="trip.name"]')).toContainText(tripName);
  await expect(page.locator('[data-macro-name="trip.dates"]')).toBeVisible();
  await expect(page.locator('[data-macro-name="cost.trip"]')).toHaveText("no costs yet");
  await expect(page.locator('[data-macro-name="itinerary.trip"]')).toBeVisible();
  const overviewUrl = page.url();

  // -- ComposePanel renders (no real AI call — see the file-header note) --
  await expect(page.getByLabel("Ask AI to draft this page")).toBeVisible();
  await expect(page.getByRole("button", { name: "Generate" })).toBeVisible();

  // -- add a cost via the board, reopen Trip Overview: the total updated --
  await page.goto(tripUrl);
  await expect(page.getByRole("heading", { name: tripName })).toBeVisible();
  await page.getByRole("button", { name: "+ Add activity" }).click();
  await page.getByLabel("Activity title").fill("Museum ticket");
  await page.getByLabel("cost (USD)").last().fill("50.00");
  await waitForConfirmedCommand(page, () => page.getByRole("button", { name: "Save" }).click());
  await expect(page.getByText("Museum ticket")).toBeVisible();

  const museum = page.getByTestId(/activity-card-/).filter({ hasText: "Museum ticket" });
  const day2 = page.getByTestId("day-column").nth(1);
  await waitForConfirmedCommand(page, () => dragCardTo(museum, day2));
  await expect(day2.getByText("Museum ticket")).toBeVisible();

  await page.goto(overviewUrl);
  await expect(page.locator('[data-macro-name="cost.trip"]')).toHaveText("$50.00");
  await expect(page.locator('[data-macro-name="itinerary.trip"]')).toContainText("Museum ticket");

  // -- Day Sheet: DayBindingControl → its blocks populate --
  await page.goto(`${tripUrl}/pages`);
  await daySheetLink.click();
  await expect(page.getByRole("heading", { name: "Day Sheet" })).toBeVisible();

  // Lazily instantiated bound to day 1 (index 0), which has no cost/activities
  // yet — its macro blocks are legibly empty, not broken.
  await expect(page.getByLabel("Bind to day")).toHaveValue("0");
  await expect(page.locator('[data-macro-name="cost.day"]')).toHaveText("no costs on this day");

  // Rebind to day 2, where the museum ticket landed — blocks populate.
  await page.getByLabel("Bind to day").selectOption({ label: "Day 2" });
  await expect(page.locator('[data-macro-name="cost.day"]')).toHaveText("$50.00");
  await expect(page.locator('[data-macro-name="itinerary.day"]')).toContainText("Museum ticket");

  // -- autocomplete: type `{{` → the suggestion popover appears → insert
  // `cost.trip` → it resolves to a value in the doc --
  await page.locator(".tc-page-editor h2", { hasText: "Day plan" }).click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Grand total: ");
  await page.keyboard.type("{{");
  // The popover lists the whole macro catalog until the query narrows it —
  // both a trip-wide and a day-scoped macro are visible at this point.
  await expect(page.getByRole("button", { name: /cost\.trip/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /cost\.day/ })).toBeVisible();
  await page.keyboard.type("cost.trip");
  await expect(page.getByRole("button", { name: /cost\.trip/ })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator('[data-macro-name="cost.trip"]')).toHaveText("$50.00");
});

// Exit-gate line "Open a fresh empty trip's Notebook → default pages render
// as a legible skeleton (every macro shows its empty/unbound state)". A
// brand-new trip has no days, no activities, no dates, no costs — this
// asserts every macro in both default pages degrades to its declarative
// placeholder rather than erroring or rendering blank.
test("fresh trip: Notebook default pages render every macro's empty/unbound state", async ({ page }) => {
  const tripName = `Lagos ${Date.now()}`;
  await signInAsDevUser(page, "alice");

  await page.getByLabel("Trip name").fill(tripName);
  await page.getByRole("button", { name: "Create trip" }).click();
  await page.getByRole("link", { name: tripName }).click();
  await expect(page.getByRole("heading", { name: tripName })).toBeVisible();

  await page.getByRole("link", { name: "Notebook" }).click();
  await expect(page.getByRole("heading", { name: "Notebook" })).toBeVisible();
  await page.getByRole("link", { name: /Trip Overview/ }).click();
  await expect(page.getByRole("heading", { name: "Trip Overview" })).toBeVisible();

  // trip.name always resolves (the create-trip form requires a name); every
  // other Trip Overview macro has nothing to resolve against yet, so each
  // shows its registry-declared `emptyText` (packages/pages/src/macros/*.ts) —
  // "empty" (valid path, no data), not an error.
  await expect(page.locator('[data-macro-name="trip.name"]')).toContainText(tripName);
  await expect(page.locator('[data-macro-name="trip.dates"]')).toHaveText("no dates set");
  await expect(page.locator('[data-macro-name="cost.trip"]')).toHaveText("no costs yet");
  await expect(page.locator('[data-macro-name="itinerary.trip"]')).toHaveText("No days planned yet");
  await expect(page.locator('[data-macro-name="costs.table"]')).toHaveText("no costs yet");

  // Day Sheet's default template binds it to day index 0, but the trip has
  // zero days — that binding has nothing to resolve against, so its
  // day-scoped macros are "unbound" (needs context the page lacks), a
  // distinct state from "empty": an actionable "select a day" chip, not a
  // muted placeholder.
  await page.getByRole("link", { name: "← Notebook" }).click();
  await expect(page.getByRole("heading", { name: "Notebook" })).toBeVisible();
  await page.getByRole("link", { name: /Day Sheet/ }).click();
  await expect(page.getByRole("heading", { name: "Day Sheet" })).toBeVisible();
  await expect(page.locator('[data-macro-name="cost.day"]')).toContainText("select a day");
  await expect(page.locator('[data-macro-name="itinerary.day"]')).toContainText("select a day");
});

// Waits for a page's debounced content autosave (PageScreen.tsx's
// AUTOSAVE_DELAY_MS) to actually PATCH before returning. Needed before any
// navigation away from the editor: the debounce is cancelled outright on
// unmount (`saveContentRef.current.cancel()`), so typing and immediately
// navigating away would silently drop the keystrokes rather than persist
// them — a much stricter version of the optimistic-command race
// `waitForConfirmedCommand` guards against above.
async function waitForPageSaved(page: Page, action: () => Promise<void>): Promise<void> {
  await Promise.all([
    page.waitForResponse(
      (r) => /\/api\/trips\/[^/]+\/pages\/[^/]+$/.test(new URL(r.url()).pathname) && r.request().method() === "PATCH" && r.ok(),
    ),
    action(),
  ]);
}

// Exit-gate line "Undo a trip revert → macros update, prose persists".
// Pages are a CRUD module outside the trip command pipeline (ADR-014):
// reverting/undoing the *plan* (days/activities/etc.) must never touch a
// page's hand-written prose, while any macros on that page re-resolve live
// against whatever plan state is now current.
test("undo a trip revert: macros update, hand-typed prose persists", async ({ page }) => {
  const tripName = `Sintra ${Date.now()}`;
  await signInAsDevUser(page, "alice");

  await page.getByLabel("Trip name").fill(tripName);
  await page.getByRole("button", { name: "Create trip" }).click();
  await page.getByRole("link", { name: tripName }).click();
  await expect(page.getByRole("heading", { name: tripName })).toBeVisible();
  const tripUrl = page.url();

  // Day 1 is the state we'll revert back to.
  await waitForConfirmedCommand(page, () => page.getByRole("button", { name: "+ Add day" }).click());
  await expect(page.getByTestId("day-column")).toHaveCount(1);

  // -- open Trip Overview, add hand-typed prose alongside its macros --
  await page.getByRole("link", { name: "Notebook" }).click();
  await page.getByRole("link", { name: /Trip Overview/ }).click();
  await expect(page.getByRole("heading", { name: "Trip Overview" })).toBeVisible();
  await expect(page.locator('[data-macro-name="itinerary.trip"]').getByText("Undated day")).toHaveCount(1);

  const proseText = `Hand-typed notes ${Date.now()}`;
  await page.locator(".tc-page-editor h2", { hasText: "Overview" }).click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await waitForPageSaved(page, () => page.keyboard.type(proseText));
  await expect(page.getByText(proseText)).toBeVisible();
  const overviewUrl = page.url();

  // -- add a second day, then revert to the 1-day state via the History panel --
  await page.goto(tripUrl);
  await expect(page.getByRole("heading", { name: tripName })).toBeVisible();
  await waitForConfirmedCommand(page, () => page.getByRole("button", { name: "+ Add day" }).click());
  await expect(page.getByTestId("day-column")).toHaveCount(2);

  await page.getByRole("button", { name: "History" }).click();
  await page.getByRole("button", { name: "Added Day 1" }).click();
  await expect(page.getByText(/Viewing version \d+ \(read-only\)/)).toBeVisible();
  await waitForConfirmedCommand(page, () => page.getByRole("button", { name: "Revert to here" }).click());
  await expect(page.getByTestId("day-column")).toHaveCount(1);

  // -- reopen Trip Overview: the itinerary macro reflects the reverted
  // (1-day) plan state, and the hand-typed prose survived the revert
  // untouched --
  await page.goto(overviewUrl);
  await expect(page.locator('[data-macro-name="itinerary.trip"]').getByText("Undated day")).toHaveCount(1);
  await expect(page.getByText(proseText)).toBeVisible();

  // -- undo the revert itself (the most recent batch): back to 2 days,
  // prose still untouched --
  await page.goto(tripUrl);
  await expect(page.getByRole("heading", { name: tripName })).toBeVisible();
  await waitForConfirmedCommand(page, () => page.getByRole("button", { name: "Undo" }).click());
  await expect(page.getByTestId("day-column")).toHaveCount(2);

  await page.goto(overviewUrl);
  await expect(page.locator('[data-macro-name="itinerary.trip"]').getByText("Undated day")).toHaveCount(2);
  await expect(page.getByText(proseText)).toBeVisible();
});
