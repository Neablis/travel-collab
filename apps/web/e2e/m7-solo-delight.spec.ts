import { expect, type Page, test } from "@playwright/test";
import { DEFAULT_TEMPLATES } from "@tc/pages";
import { openHistory } from "./helpers";
import { e2eTripName } from "./tripNames";

// The two seeds a new trip is planted with, read from `@tc/pages` rather than
// typed here. Renaming one ("Day Sheet" → "Day overview", 2026-09-06) failed
// three integration assertions for a reason that was not a defect; this spec is
// about the notebooks EXISTING and RENDERING, not about the words on them.
// `!` rather than a fallback: a seed that has stopped existing is a real
// failure and should crash the spec loudly at load, not quietly assert nothing.
const [TRIP_OVERVIEW, DAY_OVERVIEW] = DEFAULT_TEMPLATES as [
  (typeof DEFAULT_TEMPLATES)[number],
  (typeof DEFAULT_TEMPLATES)[number],
];

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

// The Notebook index's own heading, named exactly and by level. Both are
// needed: `getByRole` name matching is substring-and-case-insensitive, and
// this route now has an h2 "Notebooks" AND an h3 "Your notebooks", so a bare
// { name: "Notebook" } matches two headings and trips strict mode.
async function expectNotebookIndex(page: Page): Promise<void> {
  await expect(page.getByRole("heading", { name: "Notebooks", exact: true, level: 2 })).toBeVisible();
}

// The way into the Notebook index since SPEC §11: the Notebooks pill at the far
// right of the view row, then its pinned footer link. The plain text
// `<Link>Notebook</Link>` this replaced sat in the trip header's nav row.
async function openNotebookIndex(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Notebooks" }).click();
  await page.getByRole("link", { name: /Browse all notebooks/ }).click();
  await expectNotebookIndex(page);
}

// M7 exit-gate demo, scripted: the Notebook route reached from the Notebooks
// pill, and the two lazily-instantiated default pages rendering their starter
// text. See docs/milestones/M7-solo-delight.md's exit gate.
//
// Rewritten post-Wave-B (M8, commit 5f8683a): macro *authoring* left the
// primary editing surface, and the seeded templates became plain starter text
// with no macro nodes. Every assertion this spec used to make about macro
// resolution against those default pages stopped being reachable through the
// UI, and that note ended *"macro authoring returns in M14; this spec should
// regain that coverage then."*
//
// **It has (2026-09-06, ADR-041).** The picker, the slash menu and the chrome
// row all shipped in M14, so `templates.ts` plants widgets again — and the
// seeds are read from `DEFAULT_TEMPLATES` below rather than typed here, so the
// next rename of one is not three failing assertions about a word. What this
// spec asserts about them is deliberately the EMPTY case: these trips are
// created with no dates and no stops, so every widget resolves to its
// `emptyText` chip. That is the state a brand-new trip's notebook is actually
// in, it is the one this spec can reach without building a trip first, and
// "renders its empty chip rather than erroring or rendering blank" is exactly
// what the exit-gate line asks for.
//
// AI: the exit gate's "AI demo" step (prompt → composed page / atomic batch)
// deliberately has NO e2e coverage here. Playwright drives a real running
// dev server, and there is no test-mode seam today to swap in a mocked
// `LanguageModel` for a live Next.js process without real infra work
// (env-gated test routing, an in-server MSW setup, etc.) — out of scope for
// this task. Mitchell's hard constraint: no e2e test may ever make a real
// call to the Vercel AI Gateway or any model provider (token cost). So this
// spec only asserts the assistant rail OPENS on a page (composer + Ask
// button); what a turn actually does is covered by
// apps/web/src/app/api/trips/[tripId]/ask/route.int.test.ts and, on the client
// side, by PageAssistant.test.tsx.
test("solo delight: the Notebook and its default pages", async ({ page }) => {
  // Distinct prefix from other specs' trip names — parallel workers share the
  // "alice" dev user's trip list, and a same-millisecond Date.now() would
  // otherwise make specs' trip names collide (see m3/m4's comment).
  const tripName = e2eTripName("Faro");
  await page.goto("/");

  await page.getByRole("button", { name: "New trip" }).click();
  await page.getByLabel("Trip name").fill(tripName);
  await page.getByRole("button", { name: "Create empty" }).click();
  await page.getByRole("link", { name: tripName }).click();
  await expect(page.getByRole("heading", { name: tripName, level: 2 })).toBeVisible();

  // -- open the trip's Notebooks: the two default notebooks exist --
  // Via the Notebooks pill in the view row (SPEC §11), which replaced the plain
  // text link that used to sit in the trip header's nav row.
  await openNotebookIndex(page);
  const overviewLink = page.getByRole("link", { name: new RegExp(TRIP_OVERVIEW.title) });
  const dayLink = page.getByRole("link", { name: new RegExp(DAY_OVERVIEW.title) });
  await expect(overviewLink).toBeVisible();
  await expect(dayLink).toBeVisible();

  // -- Trip Overview: its starter text AND its widgets --
  await overviewLink.click();
  await expect(page.getByRole("heading", { name: TRIP_OVERVIEW.title })).toBeVisible();
  await expect(page.getByText(/what's this trip about/i)).toBeVisible();
  await expect(page.getByText(/sketch the shape of the trip/i)).toBeVisible();
  // The widgets resolved. This trip has no dates, no cities and no stops, so
  // each one is its own empty chip — a resolved answer, not a blank and not an
  // error. `dates` and `city` are on this template; "no days to show" is
  // `day.rows` deciding it has nothing to list.
  await expect(page.getByText("no dates set")).toBeVisible();
  await expect(page.getByText("no cities yet")).toBeVisible();
  await expect(page.getByText("no days to show")).toBeVisible();

  // -- the assistant opens on a page, in EITHER mode (no real AI call) --
  // It used to be an editing-only control, hidden in Reading because what it
  // inserts is autosaved. Mitchell reversed that on the preview — *"it should
  // be on the bottom right on desktop, floating till open, and always
  // available in both editing and reading more"* — so a page that has never
  // been put into Editing can open it, and leaving Editing does not close it.
  // Reading still cannot be written into; that is the insert guard's job now,
  // walked in `PageAssistant.test.tsx`.
  //
  // The panel replaced the prompt box in M14 link 8 (Mitchell: *"This should be
  // the same style AI Assistant as on the trip page, not the top of the UI
  // input box"*), which became possible when the page tools stopped replacing
  // the document and started inserting into it (ADR-035 decision 5).
  await page.getByRole("button", { name: /Assistant/ }).click();
  await expect(page.getByRole("complementary", { name: "Assistant" })).toBeVisible();
  await expect(page.getByPlaceholder(/add to this page/i)).toBeVisible();
  await page.getByRole("button", { name: /hide/i }).click();
  await expect(page.getByRole("complementary", { name: "Assistant" })).toBeHidden();
  await page.getByRole("button", { name: "Edit page" }).click();
  await page.getByRole("button", { name: /Assistant/ }).click();
  await expect(page.getByRole("complementary", { name: "Assistant" })).toBeVisible();
  await page.getByRole("button", { name: "Done editing" }).click();
  // Still open across the mode change — the reversal, stated as an assertion.
  await expect(page.getByRole("complementary", { name: "Assistant" })).toBeVisible();
  await page.getByRole("button", { name: /hide/i }).click();

  // -- Day overview: its own starter text --
  // The day-binding control this used to drive went with SPEC §18: a page has
  // no scope, and a day is a widget's own input (M14 link 2). The binding UI
  // returns as the chrome row on a widget, which is M14 link 4's to cover.
  await page.getByRole("link", { name: "← Notebooks" }).click();
  await expectNotebookIndex(page);
  await dayLink.click();
  await expect(page.getByRole("heading", { name: DAY_OVERVIEW.title })).toBeVisible();
  await expect(page.getByText(/point the widgets below at a day/i)).toBeVisible();
  await expect(page.getByText("no times set")).toBeVisible();
});

// Exit-gate line "Open a fresh empty trip's Notebook → default pages render
// as a legible skeleton". They carry widgets again (see the header), so the
// skeleton is now starter text PLUS each widget's empty chip — which is what a
// brand-new trip's notebook actually looks like, and what "legible" has to mean
// for it.
test("fresh trip: Notebook default pages render their starter text", async ({ page }) => {
  const tripName = e2eTripName("Lagos");
  await page.goto("/");

  await page.getByRole("button", { name: "New trip" }).click();
  await page.getByLabel("Trip name").fill(tripName);
  await page.getByRole("button", { name: "Create empty" }).click();
  await page.getByRole("link", { name: tripName }).click();
  await expect(page.getByRole("heading", { name: tripName, level: 2 })).toBeVisible();

  await openNotebookIndex(page);
  await page.getByRole("link", { name: new RegExp(TRIP_OVERVIEW.title) }).click();
  await expect(page.getByRole("heading", { name: TRIP_OVERVIEW.title })).toBeVisible();
  await expect(page.getByText(/what's this trip about/i)).toBeVisible();
  await expect(page.getByText(/sketch the shape of the trip/i)).toBeVisible();
  await expect(page.getByText("no dates set")).toBeVisible();

  await page.getByRole("link", { name: "← Notebooks" }).click();
  await expectNotebookIndex(page);
  await page.getByRole("link", { name: new RegExp(DAY_OVERVIEW.title) }).click();
  await expect(page.getByRole("heading", { name: DAY_OVERVIEW.title })).toBeVisible();
  await expect(page.getByText(/point the widgets below at a day/i)).toBeVisible();
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
// page's hand-written prose. The "macros update" half is no longer
// e2e-reachable (see the file-header note — default pages carry no macros
// post-B3); this keeps the half that's still true and still the actual
// point of ADR-014 — hand-typed prose survives untouched regardless of what
// happens to the trip's event-sourced plan state around it.
test("undo a trip revert: hand-typed prose survives untouched", async ({ page }) => {
  const tripName = e2eTripName("Sintra");
  await page.goto("/");

  await page.getByRole("button", { name: "New trip" }).click();
  await page.getByLabel("Trip name").fill(tripName);
  await page.getByRole("button", { name: "Create empty" }).click();
  await page.getByRole("link", { name: tripName }).click();
  // Wait for the real SPA navigation, not just a heading with this name
  // becoming visible: since M10's home-page restyle, a brand-new trip's name
  // can transiently render as a heading on the HOME page too (NextTripHero's
  // own `Heading` for the "next trip"), so `getByRole("heading", { name:
  // tripName })` alone can resolve before the click's navigation actually
  // lands — `page.url()` read right after would then capture "/" instead of
  // the trip's real URL, which this spec relies on for its later `goto`
  // back to the trip. Waiting for the URL pattern first makes the assertion
  // and the `tripUrl` capture below both trustworthy.
  await page.waitForURL(/\/trips\/[^/]+$/);
  await expect(page.getByRole("heading", { name: tripName, level: 2 })).toBeVisible();
  const tripUrl = page.url();

  // Day 1 is the state we'll revert back to.
  await waitForConfirmedCommand(page, () => page.getByRole("button", { name: "Add a day", exact: true }).click());
  await expect(page.getByTestId("day-column")).toHaveCount(1);

  // -- open Trip Overview, add hand-typed prose --
  await openNotebookIndex(page);
  await page.getByRole("link", { name: /Trip Overview/ }).click();
  await expect(page.getByRole("heading", { name: "Trip Overview" })).toBeVisible();

  // A notebook opens in READING now (Mitchell, 2026-09-04, walking the M14
  // preview), so typing into it is a deliberate act here as it is for a person.
  //
  // This spec is why the default was Editing for a while: making Reading the
  // default the first time turned this walk red, and I read that as the product
  // telling me the default was wrong. It was telling me this line was missing.
  // A spec that walks authoring should enter Editing itself rather than lean on
  // whichever side the toggle happens to start on — otherwise the default is
  // defended by a test instead of by a reason.
  await page.getByRole("button", { name: "Edit page" }).click();

  const proseText = `Hand-typed notes ${Date.now()}`;
  await page.locator(".tc-page-editor h2", { hasText: "Overview" }).click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await waitForPageSaved(page, () => page.keyboard.type(proseText));
  await expect(page.getByText(proseText)).toBeVisible();
  const overviewUrl = page.url();

  // -- add a second day, then revert to the 1-day state via the History panel --
  await page.goto(tripUrl);
  await expect(page.getByRole("heading", { name: tripName, level: 2 })).toBeVisible();
  await waitForConfirmedCommand(page, () => page.getByRole("button", { name: "Add a day", exact: true }).click());
  await expect(page.getByTestId("day-column")).toHaveCount(2);

  await openHistory(page);
  await page.getByRole("button", { name: "Added Day 1" }).click();
  await expect(page.getByText(/Viewing version \d+ \(read-only\)/)).toBeVisible();
  await waitForConfirmedCommand(page, () => page.getByRole("button", { name: "Revert to here" }).click());
  await expect(page.getByTestId("day-column")).toHaveCount(1);

  // -- reopen Trip Overview: the hand-typed prose survived the revert untouched --
  await page.goto(overviewUrl);
  await expect(page.getByText(proseText)).toBeVisible();

  // -- undo the revert itself (the most recent batch): back to 2 days,
  // prose still untouched --
  await page.goto(tripUrl);
  await expect(page.getByRole("heading", { name: tripName, level: 2 })).toBeVisible();
  await openHistory(page);
  await waitForConfirmedCommand(page, () => page.getByRole("button", { name: "Undo" }).click());
  await expect(page.getByTestId("day-column")).toHaveCount(2);

  await page.goto(overviewUrl);
  await expect(page.getByText(proseText)).toBeVisible();
});
