import { expect, type Page, test } from "@playwright/test";
import { e2eTripName } from "./tripNames";

// M14's builder half, walked the way a person walks it.
//
// `m7-solo-delight.spec.ts`'s header has been carrying an IOU since M8:
//
// > Macro authoring returns in M14; this spec should regain that coverage then.
//
// This is that coverage, in its own file because the flow is no longer M7's.
// M8 removed `{{` autocomplete and left NO manual insertion path at all — the
// assistant was the only remaining author, and it is off-limits to e2e (no
// e2e test may make a real model call). ADR-037 decision 4's insert surface is
// path back, and everything below is reachable by clicking.
//
// What this covers that the unit tests cannot: the unit suites each prove one
// seam with the others mocked. This proves they are actually joined — a real
// Next build, a real Postgres, a real ProseMirror document, a real PATCH — and
// that what was saved is what comes back after a reload. A widget that renders
// beautifully and does not survive a refresh is the failure mode that matters,
// and it is invisible to every test that never reloads.

async function waitForConfirmedCommand(page: Page, action: () => Promise<unknown>): Promise<void> {
  await Promise.all([
    page.waitForResponse(
      (r) => /\/api\/trips\/[^/]+\/commands$/.test(new URL(r.url()).pathname) && r.request().method() === "POST" && r.ok(),
    ),
    action(),
  ]);
}

// The autosave is debounced, so an assertion made straight after a click can
// pass on the optimistic DOM and still describe a document that never reached
// the server. Every write below goes through this.
async function waitForPageSaved(page: Page, action: () => Promise<unknown>): Promise<void> {
  await Promise.all([
    page.waitForResponse(
      (r) => /\/api\/trips\/[^/]+\/pages\/[^/]+$/.test(new URL(r.url()).pathname) && r.request().method() === "PATCH" && r.ok(),
    ),
    action(),
  ]);
}

async function openNotebookIndex(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Notebooks" }).click();
  await page.getByRole("link", { name: /Browse all notebooks/ }).click();
  await expect(page.getByRole("heading", { name: "Notebooks", exact: true, level: 2 })).toBeVisible();
}

// A trip with two days, so "point it at a day" has a choice to make and
// "two widgets read two different days" has two days to read.
async function tripWithTwoDays(page: Page): Promise<string> {
  const tripName = e2eTripName("Porto");
  await page.goto("/");
  await page.getByRole("button", { name: "New trip" }).click();
  await page.getByLabel("Trip name").fill(tripName);
  await page.getByRole("button", { name: "Create empty" }).click();
  await page.getByRole("link", { name: tripName }).click();
  await page.waitForURL(/\/trips\/[^/]+$/);
  await expect(page.getByRole("heading", { name: tripName, level: 2 })).toBeVisible();

  await waitForConfirmedCommand(page, () => page.getByRole("button", { name: "Add a day", exact: true }).click());
  await expect(page.getByTestId("day-column")).toHaveCount(1);
  await waitForConfirmedCommand(page, () => page.getByRole("button", { name: "Add a day", exact: true }).click());
  await expect(page.getByTestId("day-column")).toHaveCount(2);

  // **A start date, because the days filter writes a DATE range.** Mitchell's
  // call on the PR 141 preview: one control for "which days", and it stores
  // `dates` — so a day only becomes selectable once the trip has dates for its
  // days to derive. "Create empty" leaves a trip undated, which is the state
  // `an undated trip cannot be filtered by day` below pins deliberately; every
  // other walk here is about binding, so it gets a dated trip to bind against.
  // `TripDateControl` lives in the Settings sheet (#15), reached through the
  // header's gear, and the sheet is a full-height overlay that has to be closed
  // again before anything behind it is clickable — same dance `m3` documents.
  await page.getByRole("button", { name: "Trip settings" }).click();
  await page.getByRole("button", { name: "Dates" }).click();
  await Promise.all([
    page.waitForResponse((r) => r.url().includes("/commands") && r.request().method() === "POST" && r.ok()),
    page.getByLabel("Trip start date").fill("2027-06-01"),
  ]);
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  return tripName;
}

// Opens the page AND enters Editing. A notebook opens in Reading now
// (Mitchell, 2026-09-04), so a walk about authoring clicks the control a person
// clicks rather than depending on which side the toggle starts on.
// Adds a stop carrying one tag, so the trip's globals projection reports that
// tag and the chrome row can offer it. UNSCHEDULED is enough: `globals.tags`
// counts every activity on the trip, not only the scheduled ones — which is
// also the cheapest way to get a selectable tag without touching a day.
async function addTaggedStop(page: Page, title: string, tagLabel: string): Promise<void> {
  await page.getByRole("button", { name: "Add stop" }).click();
  await page.getByLabel("What or where").fill(title);
  await page.getByRole("group", { name: "Tags" }).getByRole("button", { name: tagLabel }).click();
  await waitForConfirmedCommand(page, () => page.getByRole("button", { name: "Add stop" }).last().click());
}

async function openTripOverview(page: Page): Promise<void> {
  await openNotebookIndex(page);
  await page.getByRole("link", { name: /Trip Overview/ }).click();
  await expect(page.getByRole("heading", { name: "Trip Overview" })).toBeVisible();
  await page.getByRole("button", { name: "Edit page" }).click();
  await expect(page.getByRole("button", { name: "Insert a widget" })).toBeVisible();
}

// The widget list is a portalled Popover now, not an `<aside>` beside the
// document — Mitchell, walking the preview: *"The widgets should be more of a
// popover side bar so they dont interrupt the document flow when open"*. It
// closes behind each insert, because the insert puts the caret back in the
// document, so every insert is the same three beats: put the caret where the
// widget should land, open the list, click a row.
//
// The caret goes first for the reason it always did: `insertContent` inserts at
// the selection, and opening the list moves focus out of the editor. TipTap
// keeps the selection across that blur, which is what makes this work at all.
async function insertFromList(page: Page, name: RegExp, search?: string): Promise<void> {
  await page.locator(".tc-page-editor h2").first().click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Insert a widget" }).click();
  const list = page.getByRole("dialog");
  await expect(list).toBeVisible();
  if (search !== undefined) {
    await list.getByRole("searchbox", { name: "Search widgets" }).fill(search);
  }
  await waitForPageSaved(page, () => list.getByRole("button", { name }).click());
  await expect(list).toBeHidden();
}

test("insert a widget from the widget list, narrow it to a day, and reload to find it there", async ({ page }) => {
  await tripWithTwoDays(page);
  await openTripOverview(page);

  // Searched, because a flat list of eighteen presets is what the widget
  // model's own success looks like.
  await insertFromList(page, /What it costs/, "costs");

  // **It lands WIDE, and that is what ADR-039 decision 2 changed.** Mitchell,
  // on the preview: *"where we have a tool that you can select a day, it can
  // also select All at the top, and it gives you a sum."* The old walk asserted
  // "no day set" here; a widget that still said that would be waiting for a
  // choice it does not need.
  // ONE control for "which days" — Mitchell, on the preview: *"I dont think we
  // need the date pickers, and the dropdown for all days/specific day, and the
  // range. Combine them into one experience."*
  const days = page.getByRole("button", { name: /What it costs: dates/ });
  await expect(days).toHaveText("All days");
  await expect(page.getByText("no day set")).toHaveCount(0);
  await days.click();
  await waitForPageSaved(page, () =>
    page.getByRole("group", { name: "Trip days" }).getByRole("button", { name: /Day 2/ }).click(),
  );
  await page.keyboard.press("Escape");

  // The whole point: reload and the binding is still there. The unit tests
  // assert the PATCH body; only this asserts the round trip.
  await page.reload();
  await expect(page.getByRole("heading", { name: "Trip Overview" })).toBeVisible();
  // Reading is the default, so the chrome row is not on screen until Editing —
  // which is the point of Reading. The BINDING is what survived; the control
  // that shows it is an authoring affordance.
  await page.getByRole("button", { name: "Edit page" }).click();
  await expect(page.getByRole("button", { name: /What it costs: dates/ })).not.toHaveText("All days");
});

test("two widgets on one page read two different days", async ({ page }) => {
  // ADR-037 open question 1, settled by Mitchell: "i should be able to have a
  // notebook that shows day 1, day 3 and day 9". Each widget carries its own
  // binding, which is the thing an aggregated page-level control would break —
  // and did, before SPEC §18 removed the page's scope.
  await tripWithTwoDays(page);
  await openTripOverview(page);

  await insertFromList(page, /What it costs/);
  await insertFromList(page, /The days, in detail/);

  // Each widget's OWN day select, found by the widget's name rather than by
  // position: a primitive declares up to five controls now (ADR-039 decision
  // 1), so "the first two comboboxes on the page" are both the first widget's.
  const pickDay = async (widget: RegExp, day: RegExp) => {
    await page.getByRole("button", { name: widget }).click();
    await waitForPageSaved(page, () =>
      page.getByRole("group", { name: "Trip days" }).getByRole("button", { name: day }).click(),
    );
    await page.keyboard.press("Escape");
  };
  await pickDay(/What it costs: dates/, /Day 1/);
  await pickDay(/The days in detail: dates/, /Day 2/);

  await page.reload();
  await expect(page.getByRole("heading", { name: "Trip Overview" })).toBeVisible();
  await page.getByRole("button", { name: "Edit page" }).click();
  // Each widget kept ITS OWN binding, which is the assertion an aggregated
  // page-level control would break.
  await expect(page.getByRole("button", { name: /What it costs: dates/ })).not.toHaveText("All days");
  await expect(page.getByRole("button", { name: /The days in detail: dates/ })).not.toHaveText("All days");
  await expect(page.getByRole("button", { name: /What it costs: dates/ })).not.toHaveText(
    await page.getByRole("button", { name: /The days in detail: dates/ }).innerText(),
  );
});

test("Reading takes the whole authoring surface away, and the widget stays", async ({ page }) => {
  // SPEC §18: Reading is the traveller's view. No insert affordance, no chrome
  // row, no compose box — but the widget itself is still resolved and still on
  // the page, which is the difference between "hidden" and "removed".
  const tripName = await tripWithTwoDays(page);
  await openTripOverview(page);

  await insertFromList(page, /The trip's name/);

  await page.getByRole("button", { name: "Done editing" }).click();
  await expect(page.getByRole("button", { name: "Insert a widget" })).toBeHidden();
  await expect(page.getByRole("combobox")).toHaveCount(0);
  // **The assistant is NOT one of the controls Reading takes away**, and that
  // is a reversal: it used to be hidden here on the argument that what it
  // inserts is autosaved. Mitchell asked for the opposite — *"always available
  // in both editing and reading mode"* — so the write is refused by the insert
  // guard instead of by hiding the surface, and the bubble stays.
  //
  // `toHaveCount(1)` rather than `toBeVisible()`, for the reason the previous
  // version of this line was written: the assertion has to name the number it
  // expects, or a locator that has drifted to matching nothing keeps passing
  // (CodeRabbit, PR 139).
  await expect(page.getByRole("button", { name: /Assistant/ })).toHaveCount(1);
  await expect(page.getByRole("complementary", { name: "Assistant" })).toHaveCount(0);
  // And the widget itself STAYS. That is the difference between hidden and
  // removed, and the assertion this test claimed to make and did not.
  await expect(page.getByText(tripName, { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Edit page" }).click();
  await expect(page.getByRole("button", { name: "Insert a widget" })).toBeVisible();
});

test("a repeater renders one line per day", async ({ page }) => {
  // M14's gate line for repeaters. `day.rows` needs no filters set, so it is
  // finished the moment it lands — and the two days created above are exactly
  // what tells one line per day apart from one line.
  await tripWithTwoDays(page);
  await openTripOverview(page);

  await insertFromList(page, /A line for every day/, "every day");

  // **Exactly two rows, one per day.** Asserting only that both labels appear
  // allows a renderer that duplicates a row or puts both leads in one — and
  // "one line per day" is precisely the claim those break (CodeRabbit, PR 139).
  // A repeater renders as an ARIA list, which is what makes a ROW queryable
  // without asserting on classes.
  const rows = page.locator(".tc-page-editor [role='listitem']");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("Day 1");
  await expect(rows.nth(1)).toContainText("Day 2");

  // **A resolved value reads as a word with room around it, not flush against
  // the prose.** Mitchell, on the preview: *"These inline elements should have
  // a natural space at the start and end, otherwise ill need to go in and put a
  // unnatural space."* A widget node is an inline atom, so its tinted
  // background butted straight against the character beside it.
  //
  // Asserted in e2e rather than in a unit test because it is genuinely
  // presentational: `toHaveClass` and `.className` are eslint errors in
  // `src/**/*.test.tsx` outside `components/ui/**`, and rightly — but a
  // computed margin is a real measurement, and e2e is where this repo already
  // measures rendered geometry (§13's 44px floor is checked the same way).
  //
  // A repeater's rows are where a value definitely renders: this trip has days
  // and dates but no costs, so an inline `cost` would resolve to its empty
  // chip and there would be no value to measure.
  const value = page.locator(".tc-page-editor [data-widget-value]").first();
  await expect(value).toBeVisible();
  const gaps = await value.evaluate((el) => {
    const style = getComputedStyle(el);
    return { left: parseFloat(style.marginLeft), right: parseFloat(style.marginRight) };
  });
  expect(gaps.left).toBeGreaterThan(0);
  expect(gaps.right).toBeGreaterThan(0);

  await page.reload();
  await expect(page.getByRole("heading", { name: "Trip Overview" })).toBeVisible();
  // And the same two after a round trip — not just that Day 2 survived, which
  // a reload that lost Day 1 would also satisfy.
  const afterReload = page.locator(".tc-page-editor [role='listitem']");
  await expect(afterReload).toHaveCount(2);
  await expect(afterReload.nth(0)).toContainText("Day 1");
  await expect(afterReload.nth(1)).toContainText("Day 2");
});

test("a multi-filter widget keeps every binding, and each survives a reload", async ({ page }) => {
  // `stop.rows` is the widest widget in the registry — entity `stop`, which the
  // legality matrix gives all six dimensions — so it is the one that proves the
  // model. The failure it exists to catch is not visible in any single-filter
  // walk: setting the second binding must not disturb the first. The chrome row
  // replaced its whole params object before this widget existed, so choosing a
  // tag would have silently unbound the day.
  await tripWithTwoDays(page);
  // A selectable tag has to exist before the chrome row can offer one.
  await addTaggedStop(page, "Ramen", "Meal");
  await openTripOverview(page);

  await insertFromList(page, /A line for every stop/, "every stop");

  // Two controls, one per declared input.
  const days = page.getByRole("button", { name: /A line for every stop: dates/i });
  const tags = page.getByRole("combobox", { name: /A line for every stop: tags/i });
  await expect(days).toBeVisible();
  await expect(tags).toBeVisible();
  // `stop.rows` is entity `stop`, and the matrix gives that entity every
  // dimension — reaching the row as FOUR controls, because `day` and `dates`
  // are one. `person` is the one with no control, and deliberately so: no stop
  // carries a person (decision 7).
  await expect(page.getByRole("combobox", { name: /A line for every stop: city/i })).toBeVisible();
  await expect(page.getByRole("combobox", { name: /A line for every stop: kind/i })).toBeVisible();
  await expect(page.getByRole("combobox", { name: /A line for every stop: who/i })).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: /A line for every stop: day/i })).toHaveCount(0);

  // A tag input reads "every stop, or one" (§18), so unset is a real answer
  // rather than an unfilled blank.
  await expect(tags).toHaveValue("");

  // **Both bindings, and the ORDER is the test.** The first version of this
  // walk set only the day, left the tag unset throughout, and called itself
  // proof that two bindings survive — so the replace-instead-of-merge bug it
  // was written to catch would have passed it. Both reviewers said so on PR 139
  // and both were right: a test that never exercises the second input cannot
  // witness the second input clobbering the first.
  await days.click();
  await waitForPageSaved(page, () =>
    page.getByRole("group", { name: "Trip days" }).getByRole("button", { name: /Day 2/ }).click(),
  );
  await page.keyboard.press("Escape");
  await expect(days).not.toHaveText("All days");
  await waitForPageSaved(page, () => tags.selectOption("meal"));
  await expect(tags).toHaveValue("meal");
  // The days binding is still there AFTER the tag was set. This is the
  // assertion the whole widget exists to make possible.
  await expect(days).not.toHaveText("All days");

  await page.reload();
  await expect(page.getByRole("heading", { name: "Trip Overview" })).toBeVisible();
  await page.getByRole("button", { name: "Edit page" }).click();
  await expect(page.getByRole("button", { name: /A line for every stop: dates/i })).not.toHaveText("All days");
  await expect(page.getByRole("combobox", { name: /A line for every stop: tags/i })).toHaveValue("meal");
});

// **The stated cost of storing a date range, pinned so it cannot become a
// surprise.** The days filter writes `dates` (Mitchell's call when the two
// options were put to him), and a date range resolves against real dates — so
// on a trip created with "Create empty", which leaves it undated, there is
// nothing to select. The popover says so rather than offering cells that would
// store a range matching nothing, and All days stays reachable so an undated
// trip is never a dead end.
//
// This walk exists because the regression is easy to hide: every other walk
// here now gives its trip a start date, and without this one the suite would go
// green while a freshly created trip could not filter a widget at all.
test("an undated trip says it has no days to filter by, and is not a dead end", async ({ page }) => {
  const tripName = e2eTripName("Undated");
  await page.goto("/");
  await page.getByRole("button", { name: "New trip" }).click();
  await page.getByLabel("Trip name").fill(tripName);
  await page.getByRole("button", { name: "Create empty" }).click();
  await page.getByRole("link", { name: tripName }).click();
  await page.waitForURL(/\/trips\/[^/]+$/);
  await waitForConfirmedCommand(page, () => page.getByRole("button", { name: "Add a day", exact: true }).click());

  await openTripOverview(page);
  await insertFromList(page, /What it costs/, "costs");

  await page.getByRole("button", { name: /What it costs: dates/ }).click();
  await expect(page.getByText(/no dates yet/i)).toBeVisible();
  await expect(page.getByRole("group", { name: "Trip days" })).toHaveCount(0);
  // The way out is still there.
  await expect(page.getByRole("button", { name: "All days" })).toBeVisible();
});
