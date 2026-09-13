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
// **One seeded template since SPEC §25**, not two — Mitchell, 2026-09-12:
// *"Only 1 notebook per trip is always generated."* Trip Overview and Day
// overview are gallery templates now, and the page every trip comes with is the
// Overview. Read from `DEFAULT_TEMPLATES` for the same reason it always was: a
// rename should not be a failing assertion about a word.
// The cast is a one-tuple now, and that is the point of writing it out: it was
// `[T, T]` — left over from when two templates were seeded — which typechecked
// against a one-element array and would have gone on typechecking if the list
// emptied. A tuple whose length is a claim has to state the length it claims.
const [SEEDED_PAGE] = DEFAULT_TEMPLATES as [(typeof DEFAULT_TEMPLATES)[number]];

// A heading INSIDE the seeded page, as opposed to the page's own title — this
// walk clicks one to put its cursor somewhere and types prose under it.
//
// It was "Overview", which is the page's title and used to be its first heading
// too. SPEC §25 rewrote the seed: it opens with "What needs you" over the `open`
// widget, and the prose sections come after. Picking one of THOSE, rather than
// the first heading, also keeps this walk away from the widget — a click into a
// block that holds one selects the widget instead of placing a caret.
const PROSE_HEADING = "About this trip";

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
// **It has, and deliberately not here (2026-09-06, ADR-041).** Widgets came
// back to `templates.ts` — but to the templates you CHOOSE, not the two every
// trip is seeded with. A widget-bearing Trip Overview opens a brand-new trip's
// notebook as five grey "no dates set" chips, and it stops that page being the
// blank sheet `m14-notebook-widgets.spec.ts` and `m14-mobile-notebook.spec.ts`
// both open when they need one — three of them broke on the run that proved it.
// So the seeded pair stays prose, widget coverage stays in the M14 specs, and
// this one still asserts what it always did: the two notebooks exist and render
// their starter text.
//
// What DID change here: the titles are read from `DEFAULT_TEMPLATES` rather than
// typed, so renaming a seed ("Day Sheet" → "Day overview") is not three failing
// assertions about a word.
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
  const overviewLink = page.getByRole("link", { name: new RegExp(SEEDED_PAGE.title) });
  await expect(overviewLink).toBeVisible();

  // -- the Overview: the one page a trip comes with --
  await overviewLink.click();
  await expect(page.getByRole("heading", { name: SEEDED_PAGE.title, level: 1 })).toBeVisible();
  await expect(page.getByText(/what's this trip about/i)).toBeVisible();
  await expect(page.getByText(/track budget notes/i)).toBeVisible();
  // Its one widget (SPEC §25's `w-open`), on a trip with nothing waiting: the
  // empty state is the good one here, and it is a sentence rather than a blank.
  await expect(page.getByText(/nothing is waiting on you/i)).toBeVisible();

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
  // The launcher is called "Ask" since SPEC §28 — a 92×44 bar, not a brand
  // tile. The PANEL keeps its name.
  await page.getByRole("button", { name: "Ask" }).click();
  await expect(page.getByRole("complementary", { name: "Assistant" })).toBeVisible();
  await expect(page.getByPlaceholder(/add to this page/i)).toBeVisible();
  await page.getByRole("button", { name: /hide/i }).click();
  await expect(page.getByRole("complementary", { name: "Assistant" })).toBeHidden();
  await page.getByRole("button", { name: "Edit page" }).click();
  await page.getByRole("button", { name: "Ask" }).click();
  await expect(page.getByRole("complementary", { name: "Assistant" })).toBeVisible();
  await page.getByRole("button", { name: "Done editing" }).click();
  // Still open across the mode change — the reversal, stated as an assertion.
  await expect(page.getByRole("complementary", { name: "Assistant" })).toBeVisible();
  await page.getByRole("button", { name: /hide/i }).click();

  // -- and it is the ONLY page a new trip has (SPEC §25) --
  // "Day overview" used to be walked here as the second seeded page. It is a
  // gallery template now, so the assertion that means something is that the
  // index carries exactly one page rather than that a second one renders.
  await page.getByRole("link", { name: "← Notebooks" }).click();
  await expectNotebookIndex(page);
  await expect(page.getByRole("link", { name: new RegExp(SEEDED_PAGE.title) })).toHaveCount(1);
  await expect(page.getByRole("link", { name: /Day overview/ })).toHaveCount(0);
});

// Exit-gate line "Open a fresh empty trip's Notebook → default pages render
// as a legible skeleton". The seeded pair is plain starter text — see the
// header on why widgets went to the gallery templates instead — so this checks
// that skeleton renders rather than erroring or rendering blank.
test("fresh trip: Notebook default pages render their starter text", async ({ page }) => {
  const tripName = e2eTripName("Lagos");
  await page.goto("/");

  await page.getByRole("button", { name: "New trip" }).click();
  await page.getByLabel("Trip name").fill(tripName);
  await page.getByRole("button", { name: "Create empty" }).click();
  await page.getByRole("link", { name: tripName }).click();
  await expect(page.getByRole("heading", { name: tripName, level: 2 })).toBeVisible();

  await openNotebookIndex(page);
  await page.getByRole("link", { name: new RegExp(SEEDED_PAGE.title) }).click();
  await expect(page.getByRole("heading", { name: SEEDED_PAGE.title, level: 1 })).toBeVisible();
  await expect(page.getByText(/what's this trip about/i)).toBeVisible();
  await expect(page.getByText(/track budget notes/i)).toBeVisible();

  // The gallery still offers the pages a trip is no longer seeded with, and
  // this is where that is checked: "Day overview" exists to CHOOSE now (SPEC
  // §25), so a new trip does not have one until someone asks for it.
  await page.getByRole("link", { name: "← Notebooks" }).click();
  await expectNotebookIndex(page);
  await expect(page.getByRole("link", { name: /Day overview/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Start from Day overview" }).click();
  await expect(page.getByRole("heading", { name: "Day overview", level: 1 })).toBeVisible();
  await expect(page.getByText(/what's happening today/i)).toBeVisible();
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
  // §24: a trip opens on Overview; "Add a day" lives on Plan. `tripUrl` is
  // captured BEFORE this click on purpose — the later `goto(tripUrl)` is meant
  // to re-enter the trip the way a person would, which is on Overview.
  await page.getByRole("tab", { name: "Plan" }).click();

  // Day 1 is the state we'll revert back to.
  await waitForConfirmedCommand(page, () => page.getByRole("button", { name: "Add a day", exact: true }).click());
  await expect(page.getByTestId("day-column")).toHaveCount(1);

  // -- open the Overview, add hand-typed prose --
  await openNotebookIndex(page);
  await page.getByRole("link", { name: new RegExp(SEEDED_PAGE.title) }).click();
  await expect(page.getByRole("heading", { name: SEEDED_PAGE.title, level: 1 })).toBeVisible();

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
  await page.locator(".tc-page-editor h2", { hasText: PROSE_HEADING }).click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await waitForPageSaved(page, () => page.keyboard.type(proseText));
  await expect(page.getByText(proseText)).toBeVisible();
  const overviewUrl = page.url();

  // -- add a second day, then revert to the 1-day state via the History panel --
  await page.goto(tripUrl);
  await expect(page.getByRole("heading", { name: tripName, level: 2 })).toBeVisible();
  await page.getByRole("tab", { name: "Plan" }).click();
  await waitForConfirmedCommand(page, () => page.getByRole("button", { name: "Add a day", exact: true }).click());
  await expect(page.getByTestId("day-column")).toHaveCount(2);

  await openHistory(page);
  await page.getByRole("button", { name: "Added Day 1" }).click();
  await expect(page.getByText(/Viewing version \d+ \(read-only\)/)).toBeVisible();
  await waitForConfirmedCommand(page, () => page.getByRole("button", { name: "Revert to here" }).click());
  await expect(page.getByTestId("day-column")).toHaveCount(1);

  // -- reopen the Overview: the hand-typed prose survived the revert untouched --
  await page.goto(overviewUrl);
  await expect(page.getByText(proseText)).toBeVisible();

  // -- undo the revert itself (the most recent batch): back to 2 days,
  // prose still untouched --
  await page.goto(tripUrl);
  await expect(page.getByRole("heading", { name: tripName, level: 2 })).toBeVisible();
  // Plan again: `tripUrl` is the bare trip URL on purpose (see its capture
  // above — re-entering the way a person does lands on Overview since §24), and
  // the day columns counted below are Plan's.
  await page.getByRole("tab", { name: "Plan" }).click();
  await openHistory(page);
  await waitForConfirmedCommand(page, () => page.getByRole("button", { name: "Undo" }).click());
  await expect(page.getByTestId("day-column")).toHaveCount(2);

  await page.goto(overviewUrl);
  await expect(page.getByText(proseText)).toBeVisible();
});
