import { expect, type Locator, type Page, test } from "@playwright/test";
import { newPageDoc } from "@tc/contracts";
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
  // SPEC §24: a trip opens on Overview, which is read-only. "Add a day" is on
  // Plan, the one view that edits.
  await page.getByRole("tab", { name: "Plan" }).click();

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

// Adds a stop carrying a LOCATION, so the trip's globals projection reports a
// city and the chrome row can offer one.
//
// Unscheduled is enough, and that is `buildTripGlobals`' own rule rather than a
// shortcut: its second pass attributes a stop to its OWN city whether or not a
// day is behind it, precisely so a backlog stop in a city the trip plans to
// visit is still in the collection. So this needs no drag onto a day.
//
// The geocoder is stubbed because e2e has no `LOCATIONIQ_API_KEY` (same reason
// and same shape as `m3-place-and-time`), and the stub is where `city` comes
// from: `LocationInput` copies the result's `city` field straight onto the
// Location, so a result without one produces a stop with no city and no option
// in the select.
async function addStopInCity(page: Page, title: string, cityName: string): Promise<void> {
  await page.route("**/api/geocode**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        results: [
          { lat: 35.0116, lng: 135.7681, canonicalName: `${cityName}, Japan`, countryCode: "JP", city: cityName },
        ],
      }),
    });
  });
  await page.getByRole("button", { name: "Add stop" }).click();
  await page.getByLabel("What or where").fill(title);
  await page.getByLabel("Place name").fill(cityName);
  await page.getByRole("button", { name: "Search" }).click();
  await page.getByRole("option", { name: `${cityName}, Japan` }).click();
  await waitForConfirmedCommand(page, () => page.getByRole("button", { name: "Add stop" }).last().click());
}

// **The seeded page is "Overview" since SPEC §25**, and there is exactly one of
// them — Trip Overview and Day overview are gallery templates now, so a new
// trip's notebook has a single page and this is it.
async function openSeededPage(page: Page): Promise<void> {
  await openNotebookIndex(page);
  await page.getByRole("link", { name: /Overview/ }).first().click();
  await expect(page.getByRole("heading", { name: "Overview", level: 1 })).toBeVisible();
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
  // Clicking into the heading also DESELECTS whatever widget was selected,
  // which since SPEC §26 is what returns the right column to the insert rail —
  // while a widget is selected the column shows its settings instead, so the
  // rail is simply not on screen after any previous insert. Waiting for the
  // rail rather than clicking straight through is what makes a second insert
  // reliable; the caret click and the React state it drives are two different
  // ticks.
  await page.locator(".tc-page-editor h2").first().click();
  await page.keyboard.press("End");
  // **Escape with the caret in the editor**, which is the product's own way out
  // of a node selection (§26 added it). The click above puts focus back in the
  // document, which is what makes this reach the editor's keymap at all — an
  // Escape pressed while focus is still in the settings panel is consumed
  // there and never arrives.
  await page.keyboard.press("Escape");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("widget-settings")).toHaveCount(0);
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
  await openSeededPage(page);

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
  await expect(page.getByRole("heading", { name: "Overview", level: 1 })).toBeVisible();
  // Reading is the default, so no widget control is on screen until Editing —
  // which is the point of Reading. The BINDING is what survived; the control
  // that shows it is an authoring affordance, and since §26 it lives in the
  // side channel rather than beside the value.
  // The widget's own rendered value is what survived, and it is what a reader
  // sees: a cost bound to Day 2 of a trip with no costs renders that day's
  // empty text rather than the whole trip's total. Reading it here — in
  // Reading, before any authoring control exists — is the round trip this test
  // is named for.
  await expect(page.locator('[data-macro-name="cost"]')).toBeVisible();
  await expect(page.getByText("no costs yet")).toBeVisible();
});

/**
 * Walk the pointer to a block widget's bind control, the way a person does.
 *
 * Since 2026-09-06 a block widget's controls are a popover revealed on hover or
 * focus of the widget — Mitchell: *"I dont care about always visible, people
 * editing the one they are focusing on. Reveal on hover/focus."* Until then
 * they are `opacity-0 pointer-events-none`, so a click on one waits out its
 * actionability check.
 *
 * **The stepped move is the point, not a flourish.** Playwright's own `hover()`
 * and `click()` teleport the pointer, so they would cross any dead space
 * between the widget and its popover without ever landing in it. A person's
 * pointer cannot. The first cut of this popover had `mt-1` — a 4px band that
 * hit-tests as neither element — so travelling to the control dropped
 * `group-hover` and the panel vanished as it was being reached; Copilot caught
 * it by reading, and a teleporting test never would. Moving in steps makes
 * every walk below a regression test for that gap.
 *
 * A `single` widget's chrome is still inline and always visible, so this is
 * harmless there too — no caller needs to know which shape it has.
 */
async function boxOf(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error("expected an on-screen element, got one with no box");
  return box;
}

// **Selects a widget so its settings open in the side channel (SPEC §26).**
//
// This replaces `reachChrome`, which hovered the widget to reveal a chrome row
// rendered beside it in the document. There is no chrome row: §26 moved every
// widget control out of the flow, and the way to reach one is to select the
// widget it belongs to. Clicking the widget's rendered value is what a person
// does, and it is what ProseMirror reads as a node selection.
// **The settings panel for the widget that is currently selected.**
//
// It does NOT select one, and that is deliberate rather than a gap. Clicking a
// widget inside a `contenteditable` is not something Playwright will do without
// `force`: its actionability check resolves the hit target at the click point,
// and inside ProseMirror that is always the editor's own `.tiptap` div, which
// owns pointer events for the whole document. `force` is exactly what the
// `playwright/no-force-option` wall forbids, and the wall is right — a forced
// click is a test asserting against a target it could not actually reach.
//
// So these walks lean on the behaviour §26 introduced instead: **inserting a
// widget selects it**, so the panel is already open on the thing that just
// landed. Where a walk needs to read a binding it did not just make — after a
// reload, say — it reads the DOCUMENT, which is the stronger witness anyway:
// the control is an authoring affordance, and what persisted is the widget's
// own rendered value.
function settingsPanel(page: Page): Locator {
  return page.getByTestId("widget-settings");
}

test("two widgets on one page read two different days", async ({ page }) => {
  // ADR-037 open question 1, settled by Mitchell: "i should be able to have a
  // notebook that shows day 1, day 3 and day 9". Each widget carries its own
  // binding, which is the thing an aggregated page-level control would break —
  // and did, before SPEC §18 removed the page's scope.
  await tripWithTwoDays(page);
  await openSeededPage(page);

  // **Bound one at a time, in insert order.** §26 shows one widget's settings at
  // a time, and inserting selects what it inserted — so each widget's panel is
  // open at the moment it lands, and that is when it gets pointed.
  const bindSelectedTo = async (control: RegExp, day: RegExp) => {
    await settingsPanel(page).getByRole("button", { name: control }).click();
    await waitForPageSaved(page, () =>
      page.getByRole("group", { name: "Trip days" }).getByRole("button", { name: day }).click(),
    );
    await page.keyboard.press("Escape");
  };

  await insertFromList(page, /What it costs/);
  await bindSelectedTo(/What it costs: dates/, /Day 1/);
  await expect(settingsPanel(page).getByRole("button", { name: /What it costs: dates/ })).toHaveText("2027-06-01");

  await insertFromList(page, /The days, in detail/);
  await bindSelectedTo(/The days in detail: dates/, /Day 2/);
  await expect(
    settingsPanel(page).getByRole("button", { name: /The days in detail: dates/ }),
  ).toHaveText("2027-06-02");

  await page.reload();
  await expect(page.getByRole("heading", { name: "Overview", level: 1 })).toBeVisible();
  // Each widget kept ITS OWN binding, which is the assertion an aggregated
  // page-level control would break — and after a reload the DOCUMENT is what
  // says so. The two widgets are pointed at different days, so they resolve
  // differently: `day.detail` names the day it is bound to, and `cost` does
  // not, which is exactly the divergence an aggregated control would erase.
  //
  // Read in Reading, before any authoring control exists, which is the
  // stronger place to read it from: what a traveller sees is what persisted.
  await expect(page.locator('[data-macro-name="cost"]')).toBeVisible();
  await expect(page.locator('[data-macro-name="day.detail"]')).toBeVisible();
  await expect(page.getByText("Day 2")).toBeVisible();
});

test("Reading takes the whole authoring surface away, and the widget stays", async ({ page }) => {
  // SPEC §18: Reading is the traveller's view. No insert affordance, no chrome
  // row, no compose box — but the widget itself is still resolved and still on
  // the page, which is the difference between "hidden" and "removed".
  const tripName = await tripWithTwoDays(page);
  await openSeededPage(page);

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
  // §28 renamed the collapsed launcher: a 92×44 bar reading "Ask", not a brand
  // tile. The PANEL keeps its name, which is the next line.
  await expect(page.getByRole("button", { name: "Ask" })).toHaveCount(1);
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
  await openSeededPage(page);

  await insertFromList(page, /A line for every day/, "every day");

  // **Exactly two rows, one per day.** Asserting only that both labels appear
  // allows a renderer that duplicates a row or puts both leads in one — and
  // "one line per day" is precisely the claim those break (CodeRabbit, PR 139).
  // A repeater renders as an ARIA TABLE since 2026-09-06 ("These were always
  // meant to be tables with columns"), so a row is `role="row"` rather than
  // `role="listitem"`. Either way the point stands: the role is what makes a
  // ROW queryable without asserting on classes.
  //
  // **Scoped to the widget that was just inserted, not to the page.** The
  // seeded Overview carries `open` ("What needs you", SPEC §25), which is also
  // a repeater and also renders rows — so a page-wide row count is counting
  // two widgets. The page stopped being a blank canvas when §25 gave every
  // trip a real document.
  const rows = page.locator('[data-macro-name="day.rows"] [role=\'row\']');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("Day 1");
  await expect(rows.nth(1)).toContainText("Day 2");

  await page.reload();
  await expect(page.getByRole("heading", { name: "Overview", level: 1 })).toBeVisible();
  // And the same two after a round trip — not just that Day 2 survived, which
  // a reload that lost Day 1 would also satisfy.
  const afterReload = page.locator('[data-macro-name="day.rows"] [role=\'row\']');
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
  // A selectable tag has to exist before the chrome row can offer one, and a
  // selectable city likewise — `globals.tags` and `globals.cities` are both
  // "what this trip actually has", never the whole enum.
  await addTaggedStop(page, "Ramen", "Meal");
  await addStopInCity(page, "Kinkaku-ji", "Kyoto");
  await openSeededPage(page);

  await insertFromList(page, /A line for every stop/, "every stop");

  // **Its controls are in the side channel (SPEC §26)**, and it is already the
  // selected widget because inserting selects what it inserted.
  const panel = settingsPanel(page);
  await expect(panel).toBeVisible();
  const days = panel.getByRole("button", { name: /A line for every stop: dates/i });
  const tags = panel.getByRole("combobox", { name: /A line for every stop: tags/i });
  await expect(days).toBeVisible();
  await expect(tags).toBeVisible();
  // `stop.rows` is entity `stop`, and the matrix gives that entity every
  // dimension — reaching the row as FOUR controls, because `day` and `dates`
  // are one. `person` is the one with no control, and deliberately so: no stop
  // carries a person (decision 7).
  const cities = panel.getByRole("combobox", { name: /A line for every stop: city/i });
  const kinds = panel.getByRole("combobox", { name: /A line for every stop: kind/i });
  await expect(cities).toBeVisible();
  await expect(kinds).toBeVisible();
  await expect(panel.getByRole("combobox", { name: /A line for every stop: who/i })).toHaveCount(0);
  await expect(panel.getByRole("combobox", { name: /A line for every stop: day/i })).toHaveCount(0);

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

  // **And the other two dimensions, bound rather than merely rendered.** This
  // walk used to assert that the city and kind controls were VISIBLE and stop
  // there, then claim in its own name that every binding survives a reload —
  // so a broken city or kind binding path passed it (CodeRabbit, PR 141). Four
  // declared filters, four bound, four checked after the round trip.
  //
  // The city comes off the control rather than being typed in: the trip has
  // exactly one, from the located stop above, and what a geocoded result
  // reduces to is the geocoder's business, not this test's.
  // Index 1 is the first real city — index 0 is "All cities", the unbound
  // answer every filter control leads with (ADR-039 decision 2).
  await waitForPageSaved(page, () => cities.selectOption({ index: 1 }));
  await expect(cities).not.toHaveValue("");
  await waitForPageSaved(page, () => kinds.selectOption("booked"));
  await expect(kinds).toHaveValue("booked");
  // Every earlier binding still standing after the last one was set — the
  // replace-instead-of-merge failure, checked at the widest point.
  await expect(tags).toHaveValue("meal");
  await expect(days).not.toHaveText("All days");

  await page.reload();
  await expect(page.getByRole("heading", { name: "Overview", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "Edit page" }).click();
  // **After the reload nothing is selected**, so the bindings are read from the
  // document rather than from controls that are not on screen. That is the
  // stronger reading anyway: four filters survived a round trip, and what
  // proves it is the widget resolving to the one stop that matches all four.
  await expect(page.locator('[data-macro-name="stop.rows"]')).toBeVisible();
  await expect(page.getByText("Ramen")).toBeVisible();
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
  // §24: a trip opens on Overview; "Add a day" lives on Plan.
  await page.getByRole("tab", { name: "Plan" }).click();
  await waitForConfirmedCommand(page, () => page.getByRole("button", { name: "Add a day", exact: true }).click());

  await openSeededPage(page);
  await insertFromList(page, /What it costs/, "costs");

  await page.getByRole("button", { name: /What it costs: dates/ }).click();
  await expect(page.getByText(/no dates yet/i)).toBeVisible();
  await expect(page.getByRole("group", { name: "Trip days" })).toHaveCount(0);
  // The way out is still there.
  await expect(page.getByRole("button", { name: "All days" })).toBeVisible();
});

test("a block widget's bindings are reachable by keyboard, not only by hover", async ({ page }) => {
  // The regression this exists for shipped and was caught by review, not by a
  // test: the popover was hidden with `visibility: hidden`, which drops a
  // subtree out of the accessibility tree AND out of the tab order. So the
  // focus half of "reveal on hover/focus" could never fire — there was nothing
  // focusable to fire it. Every other walk in this file reaches the chrome by
  // pointer, which is exactly why none of them noticed.
  //
  // The pointer never goes near the widget here. That is the whole test.
  await tripWithTwoDays(page);
  await openSeededPage(page);
  await insertFromList(page, /The days, in detail/);

  const days = page.getByRole("button", { name: /The days in detail: dates/ });
  await days.focus();
  await days.press("Enter");
  // The day list itself is a portalled dialog, not part of the popover, so
  // clicking in it says nothing about the reveal either way.
  await waitForPageSaved(page, () =>
    page.getByRole("group", { name: "Trip days" }).getByRole("button", { name: /Day 2/ }).click(),
  );
  await page.keyboard.press("Escape");
  await expect(days).toHaveText("2027-06-02");
});

test("a repeat widget is one table as wide as the card it sits in", async ({ page }) => {
  // Geometry, because the roles cannot see this. `MacroView` builds a repeat's
  // table out of grid and subgrid on spans — a real `<table>` would be closed
  // out of the paragraph by the parser — and a Tailwind `block` utility on the
  // container silently beat the display type it started with, because v4 orders
  // `utilities` after `components`. The rows then formed their own shrink-to-fit
  // anonymous table inside a full-width card: same roles, same text, same
  // passing suite, and a value column floating 369px short of the card's right
  // edge.
  //
  // `stop.rows` rather than a `day.detail`: only the `rows` render kind goes
  // through this path. The block widgets next to it (`ItineraryTripBlock` and
  // friends) carry the same roles over their own flex layout and are untouched
  // by any of this.
  await tripWithTwoDays(page);
  await addTaggedStop(page, "Ramen", "Meal");
  await addStopInCity(page, "Kinkaku-ji", "Kyoto");
  await openSeededPage(page);
  await insertFromList(page, /A line for every stop/, "every stop");

  const table = page.getByRole("table").first();
  const tableBox = await boxOf(table);

  // `px-3` on the cells, so the LAST cell of a row ends 12px inside the card's
  // border. Anything narrower means the table is not the card's width.
  //
  // The last, not every one: since 2026-09-06 a row has a cell per column —
  // *"The date and the city and the text shouldnt all be rolled into each
  // other. Introduce real columns"* — and only the rightmost reaches the edge.
  const rows = await table.getByRole("row").all();
  expect(rows.length).toBeGreaterThan(1);
  for (const row of rows) {
    const cells = await row.getByRole("cell").all();
    const last = await boxOf(cells[cells.length - 1]!);
    expect(Math.abs(tableBox.x + tableBox.width - (last.x + last.width))).toBeLessThan(16);
  }

  // And the lead column is one column: same left edge, same width, every row.
  // (Whether the columns AFTER it line up is the walk below's, which has the
  // ragged rows that can tell the difference — every stop here is unscheduled
  // and uncosted, so each row's cells are equally empty.)
  const leads = await Promise.all((await table.getByRole("rowheader").all()).map(boxOf));
  expect(leads.length).toBeGreaterThan(1);
  const [firstLead, ...otherLeads] = leads;
  for (const lead of otherLeads) {
    expect(lead.x).toBe(firstLead?.x);
  }
});

// Adds a stop straight through the command API, because this is the one walk
// that needs a SCHEDULED stop and dragging one onto a day column is a whole
// board interaction to prove a table's geometry. Everything the walk is about
// happens after the trip is loaded, so how the stop got there is incidental.
async function addStopViaApi(
  page: Page,
  tripId: string,
  title: string,
  extra: { dayId?: string; timeWindow?: { start: string; end: string } } = {},
): Promise<void> {
  const response = await page.request.post(`/api/trips/${tripId}/commands`, {
    data: { type: "AddActivity", tripId, activityId: crypto.randomUUID(), title, ...extra },
  });
  expect(response.ok()).toBe(true);
}

// Runs in the page: whether anything between this element and the document
// clips its overflow.
//
// It replaces a `spillPastClipper` that measured how far a popover spilled PAST
// its clipping ancestor — a measurement that only means something while the
// controls are inside the card. Since SPEC §26 they are in a sibling column, so
// the question worth asking is the structural one: is there a clipping ancestor
// at all? `false` is what makes the PR 149 finding unable to recur.
function isInsideAClippingAncestor(el: Element): boolean {
  for (let node = el.parentElement; node !== null; node = node.parentElement) {
    if (getComputedStyle(node).overflow !== "visible") return true;
  }
  return false;
}

test("the bindings of the last widget in a page are reachable, not clipped by the card", async ({ page }) => {
  // **CodeRabbit's PR 149 finding, and SPEC §26's answer to it.**
  //
  // The finding: `PageScreen` puts the editor inside a `Card` with
  // `overflow-hidden`, and `WidgetChrome`'s popover was `absolute top-full` —
  // so a widget at the very bottom of the document opened its controls into a
  // strip the card cut off, with nothing in the roles to show it.
  //
  // §26 removes the cause rather than tuning the popover: no widget control is
  // in the document at all, so there is nothing inside the clipping card to
  // clip. This walk keeps the case that produced the finding — a widget at the
  // very END of the document, at the width where the editor is widest — and
  // asserts what must now be true of it: the settings are on screen and inside
  // the viewport.
  //
  // Still geometry, not `toBeVisible`, for the original reason: an element cut
  // off by `overflow: hidden` still has a box and is still `visible` to
  // Playwright. The first cut of this walk passed with the popover pushed 900px
  // down.
  //
  // 1100px because that is inside the band the finding named (768–1179px).
  await page.setViewportSize({ width: 1100, height: 800 });
  await tripWithTwoDays(page);
  await openSeededPage(page);

  // The END of the document, not after the first heading: `insertFromList`
  // inserts under the `h2`, which leaves the whole rest of the page below the
  // widget and no card edge anywhere near it.
  await page.locator(".tc-page-editor").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Insert a widget" }).click();
  const list = page.getByRole("dialog");
  await expect(list).toBeVisible();
  await waitForPageSaved(page, () => list.getByRole("button", { name: /The days, in detail/ }).click());
  await expect(list).toBeHidden();

  // Inserting selects what it inserted (§26), so the panel is already showing
  // the widget that just landed at the end of the document.
  const panel = page.getByTestId("widget-settings");
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("button", { name: /The days in detail: dates/ })).toBeVisible();

  // Wholly inside the viewport: a panel pushed below the fold by a document
  // that ends near the bottom edge would be the same defect in a new place.
  const box = await panel.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.height).toBeGreaterThan(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(800);
  expect(box!.x + box!.width).toBeLessThanOrEqual(1100);

  // And it is NOT inside the card that does the clipping — which is the
  // structural reason the finding cannot recur, stated as an assertion rather
  // than left to the comment above.
  const insideClipper = await panel.evaluate(isInsideAClippingAncestor);
  expect(insideClipper).toBe(false);
});

test("a group header in a repeat table is as wide as the table", async ({ page }) => {
  // `stop.rows` groups under day headers as soon as the selection spans more
  // than one day (`rows.ts`: *"a header is due whenever the day changes"*), and
  // nothing walked that path before this — every other repeat walk here uses
  // unscheduled stops, which are one group and get no headers at all.
  //
  // Geometry again, and for the same reason as the walk above: a header row's
  // single cell is a lone cell in a two-column layout, and where it stops is
  // invisible to the roles. It used to stop at the label column's edge, because
  // `display: table` has no way to span columns without an HTML `colspan` and a
  // span cannot carry one — so a group label longer than the stop titles under
  // it wrapped inside a column instead of using the row it has to itself.
  // CodeRabbit found that on PR 149; the layout is subgrid now, and the lone
  // cell spans `1 / -1`.
  await tripWithTwoDays(page);
  const tripId = new URL(page.url()).pathname.split("/")[2]!;
  const detail = await page.request.get(`/api/trips/${tripId}`);
  expect(detail.ok()).toBe(true);
  const { trip } = (await detail.json()) as { trip: { days: { dayId: string }[] } };
  const dayId = trip.days[0]!.dayId;

  // A time on the scheduled stop, so the VALUE column has a width. Without one
  // both columns' content is a title and an empty values array, the value
  // column collapses to nothing, and a lead cell reaching the table's right
  // edge would prove nothing about spanning.
  await addStopViaApi(page, tripId, "Breakfast at the market", {
    dayId,
    timeWindow: { start: "09:00", end: "10:00" },
  });
  await addStopViaApi(page, tripId, "Someday: the tram museum");

  await openSeededPage(page);
  await insertFromList(page, /A line for every stop/, "every stop");

  const table = page.getByRole("table").first();
  // Day 1 and Unscheduled: two groups, so two headers.
  const header = table.getByRole("rowheader").filter({ hasText: "Day 1" }).first();
  const stopLead = table.getByRole("rowheader").filter({ hasText: "Breakfast at the market" }).first();
  await expect(header).toBeVisible();
  await expect(stopLead).toBeVisible();

  const tableBox = await boxOf(table);
  const headerBox = await boxOf(header);
  const leadBox = await boxOf(stopLead);

  // `px-3` on every cell, so a cell filling the row ends 12px inside the
  // table's border — the same tolerance the walk above uses.
  expect(Math.abs(tableBox.x + tableBox.width - (headerBox.x + headerBox.width))).toBeLessThan(16);
  // …and an ordinary lead stops well short of it, because the time is over
  // there. This is the half that fails if the columns silently collapse.
  expect(tableBox.x + tableBox.width - (leadBox.x + leadBox.width)).toBeGreaterThan(40);

  // **The columns line up across ragged rows**, which is what Mitchell asked
  // for on 2026-09-06: *"The date and the city and the text shouldnt all be
  // rolled into each other. Introduce real columns"*. This trip is the case
  // that can tell: the scheduled stop has a time, the backlog stop does not, so
  // a renderer that skipped a row's empty cells would start the second row's
  // cells where the first row's times begin. Only the data rows — a group
  // header is one cell spanning the lot, by design.
  const dataRows = table.getByRole("row").filter({ hasNot: page.getByRole("rowheader", { name: /^(Day 1|Unscheduled)$/ }) });
  const edges = await Promise.all(
    (await dataRows.all()).map(async (row) =>
      Promise.all((await row.getByRole("cell").all()).map(async (cell) => (await boxOf(cell)).x)),
    ),
  );
  expect(edges.length).toBeGreaterThan(1);
  const [firstEdges, ...otherEdges] = edges;
  expect(firstEdges?.length).toBeGreaterThan(1);
  for (const rowEdges of otherEdges) expect(rowEdges).toEqual(firstEdges);
});

test("a widget's settings follow the selection, and leave with it", async ({ page }) => {
  // **This was "a selected block widget shows its bindings with the pointer
  // nowhere near it", and SPEC §26 changed what it is testing.**
  //
  // It used to isolate the third of `WidgetChrome`'s three reveal paths — hover,
  // focus, or the caret being in the widget — because a regression that made
  // the SELECTED popover invisible would pass the hover and focus walks
  // (CodeRabbit, PR 149). §26 deleted all three: there is no popover, no hover
  // reveal, and no control in the document at all.
  //
  // What survives is the claim underneath, and it is now the whole mechanism
  // rather than one path into it: **a widget's settings are on screen exactly
  // when that widget is selected.** Both directions, because the second is the
  // one that rots — without it every widget on a page would end up showing its
  // controls at once, which is the state SPEC §18 removed and Mitchell asked
  // not to have back.
  await tripWithTwoDays(page);
  await openSeededPage(page);
  await insertFromList(page, /The days, in detail/);

  // Inserting selects what it inserted, so the panel opens on it — and the
  // panel names the widget, which is what says the settings belong to THIS one
  // rather than to whatever was selected before.
  const panel = page.getByTestId("widget-settings");
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("heading", { name: "The days in detail" })).toBeVisible();
  await expect(panel.getByRole("button", { name: /The days in detail: dates/ })).toBeVisible();

  // And they go when the caret leaves, returning the column to the insert rail.
  //
  // A heading with text in it, not the empty leading paragraph: clicking an
  // empty block leaves the node selection where it was, which is how the
  // previous version of this assertion first read as "stuck".
  await page.locator(".tc-page-editor h2").last().click();
  await expect(panel).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Insert a widget" })).toBeVisible();
});

test("a repeat widget's rows are striped, and its values are text rather than chips", async ({ page }) => {
  // Mitchell, 2026-09-06, on two widgets in a row: *"text in a widget table
  // shouldn't be color coded like inline text, also add row strips to show
  // it's a table"* and *"all tables should have row stripping, and not
  // color.code the text like other inline text"*.
  //
  // Both halves are computed background colours, which is what they are:
  // "striped" and "not tinted" have no other observable. The roles cannot see
  // either, and the repo's lint forbids asserting the classes.
  // `day.rows` rather than `stop.rows` or `cost.rows`: the second half of this
  // walk needs rows that actually carry values, and this trip has neither
  // costs (so `cost.rows` renders `empty`) nor scheduled stops (so a
  // `stop.rows` line is a lead and nothing else). Every day here is dated, and
  // a dated day's row carries its date as a value.
  await tripWithTwoDays(page);
  await openSeededPage(page);
  await insertFromList(page, /A line for every day/, "every day");

  const table = page.getByRole("table").first();
  const backgrounds = await table
    .getByRole("row")
    .evaluateAll((rows) => rows.map((row) => getComputedStyle(row).backgroundColor));
  expect(backgrounds.length).toBeGreaterThan(1);
  // Adjacent rows differ — that is what a stripe is, whichever two colours it
  // is drawn in.
  for (let i = 1; i < backgrounds.length; i += 1) {
    expect(backgrounds[i]).not.toBe(backgrounds[i - 1]);
  }

  // And a value in a cell is not wearing the inline widget chip's tint. The
  // chip is right in a sentence, where it says which words came from the trip;
  // in a table every cell did, so it marks nothing and reads as a button.
  const values = await table
    .locator("[data-widget-value]")
    .evaluateAll((els) => els.map((el) => getComputedStyle(el).backgroundColor));
  expect(values.length).toBeGreaterThan(0);
  for (const background of values) {
    expect(background).toBe("rgba(0, 0, 0, 0)");
  }
});

// Runs in the page: the tinted chip's own height against the line box it sits
// in. Module-level so the walk keeps no conditional in its body.
function chipAgainstLine(el: Element): { chip: number; line: number; block: string } {
  const block = el.closest("h1, h2, h3, h4, h5, h6, p, li");
  if (block === null) throw new Error("the value is in no block at all, so this walk proves nothing");
  return {
    chip: el.getBoundingClientRect().height,
    line: parseFloat(getComputedStyle(block).lineHeight),
    block: block.tagName,
  };
}

test("a widget value fits the line it is on, in a heading and in prose", async ({ page }) => {
  // Mitchell, 2026-09-06. First on a heading full of city chips: *"The second
  // line is overtop the top line"*. Then, thirty-five minutes later, on an
  // `hours` chip in an ordinary PARAGRAPH: *"This is overlapping to, lets just
  // make sure that all widgets that do inline text consider the border touching
  // the text above or below. expectially if theres another inline text above or
  // below it"*.
  //
  // The second report is why this walk covers both. A chip is inline, so its
  // tint and its `border-b-2` are painted over the font's content area plus
  // 2px, and vertical padding on an inline box adds nothing to the line box.
  // The heading scale is the obvious offender (`--text-2xl--line-height: 1.15`)
  // but prose was only ever a fraction clear — `--text-base` is 14px at 1.45,
  // about 20px, against a chip that paints about the same. Two chips on
  // consecutive lines touched.
  //
  // **One chip, and no wrapping needed.** Whether two lines collide is decided
  // by whether ONE chip is taller than the line it sits on, and a single widget
  // measures that. Reproducing a wrap would need eleven cities in an e2e trip
  // to test the same inequality.
  await tripWithTwoDays(page);
  await openSeededPage(page);

  // Into the block itself, not under it: `insertFromList` presses Enter first,
  // which puts the widget in a paragraph of its own. The click lands at the
  // END of the block rather than its centre, because a click in the middle of a
  // block that already holds a widget selects that widget — an inline atom —
  // and the next insert REPLACES it. That cost this walk a run.
  const insertInto = async (block: Locator) => {
    await block.click();
    await page.keyboard.press("End");
    // Escape with the caret in the editor — the product's own way out of a
    // node selection, and what returns the right column to the insert rail
    // (SPEC §26). Waiting for it is what makes the SECOND insert reliable.
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("widget-settings")).toHaveCount(0);
    await page.getByRole("button", { name: "Insert a widget" }).click();
    const list = page.getByRole("dialog");
    await expect(list).toBeVisible();
    await list.getByRole("searchbox", { name: "Search widgets" }).fill("dates");
    await waitForPageSaved(page, () => list.getByRole("button", { name: /The dates/ }).click());
    await expect(list).toBeHidden();
  };

  // Prose first, then the heading: inserting into the heading last means no
  // later click has to find its way around the widget already in it.
  //
  // **`.last()`, not `.first()`, and that is SPEC §25's doing.** The seeded page
  // opens with "What needs you" and the `open` widget in the paragraph under
  // it — so the FIRST paragraph already holds a widget, and inserting there
  // would put two on one line and make the measurement below read the wrong
  // one. The last heading and paragraph ("Costs") are the empty prose this
  // walk wants.
  await insertInto(page.locator(".tc-page-editor p").last());
  await insertInto(page.locator(".tc-page-editor h2").last());

  // Scoped to the widget this walk inserted, for the same reason.
  const inHeading = page.locator('.tc-page-editor h2 [data-macro-name="dates"] [data-widget-value]').first();
  const inProse = page.locator('.tc-page-editor p [data-macro-name="dates"] [data-widget-value]').first();
  await expect(inHeading).toBeVisible();
  await expect(inProse).toBeVisible();

  for (const value of [inHeading, inProse]) {
    const box = await value.evaluate(chipAgainstLine);
    expect(box.chip, `no box at all in ${box.block}`).toBeGreaterThan(0);
    // **Two pixels of room, not merely "does not overlap".** A chip that clears
    // its line by three tenths of a pixel satisfies `chip <= line` and is
    // exactly what Mitchell reported as *"the border touching the text above or
    // below"* — prose measured 20px in a 20.3px line and passed the weaker
    // assertion. The gap has to be visible for the claim to be worth anything.
    expect(box.line - box.chip, `the chip has no room in ${box.block}`).toBeGreaterThanOrEqual(2);
  }
});

test("an inline value keeps a natural space on each side of it", async ({ page }) => {
  // Mitchell, on the PR 141 preview: *"These inline elements should have a
  // natural space at the start and end, otherwise ill need to go in and put a
  // unnatural space."* A widget node is an inline atom, so its tinted
  // background butted straight against the character beside it and the
  // author's own typed space landed outside the tint.
  //
  // **`The dates`, an inline widget, and not a repeater.** This assertion used
  // to live inside "a repeater renders one line per day", on the reasoning
  // that a repeat row was where a value definitely rendered. That stopped
  // being true on 2026-09-06: a value inside a TABLE is drawn as plain text
  // now, with no tint and no margin — Mitchell, *"not color.code the text like
  // other inline text"* — so the margin the walk measured was the one thing
  // the table was supposed to have dropped, and it kept passing right up until
  // it was dropped. The claim is about a value in a SENTENCE, and it belongs
  // on one.
  //
  // Measured in e2e rather than in a unit test because it is genuinely
  // presentational: `toHaveClass` and `.className` are eslint errors in
  // `src/**/*.test.tsx` outside `components/ui/**`, and rightly — but a
  // computed margin is a real measurement, and e2e is where this repo already
  // measures rendered geometry (§13's 44px floor is checked the same way).
  await tripWithTwoDays(page);
  await openSeededPage(page);
  await insertFromList(page, /The dates/, "dates");

  const value = page.locator(".tc-page-editor [data-widget-value]").first();
  await expect(value).toBeVisible();
  const gaps = await value.evaluate((el) => {
    const style = getComputedStyle(el);
    return { left: parseFloat(style.marginLeft), right: parseFloat(style.marginRight) };
  });
  expect(gaps.left).toBeGreaterThan(0);
  expect(gaps.right).toBeGreaterThan(0);
});

test("a notebook is renamed by editing its own heading, and the index follows", async ({ page }) => {
  // Mitchell, 2026-09-06 on a 411px phone, pointing at the index's Rename
  // button: *"rename shouldn't be a button here, the title should be at the top
  // of the notebook as a h1 and when you edit the title it does the actual
  // edit/rename"*.
  //
  // In a real browser, because that is the only place the interaction exists:
  // the heading is a `contentEditable`, and jsdom implements none of the
  // editing behaviour a person uses on one — `PageTitle.test.tsx` can prove the
  // commit and the guards, and nothing below the browser can prove that typing
  // into the thing works at all.
  await tripWithTwoDays(page);
  await openSeededPage(page);

  const heading = page.getByRole("heading", { name: "Overview", level: 1 });
  await expect(heading).toBeVisible();

  // Select the whole title and type over it, which is what a person does to a
  // name they are replacing.
  await heading.click();
  await page.keyboard.press("ControlOrMeta+a");
  await waitForPageSaved(page, async () => {
    await page.keyboard.type("Kyoto notes");
    // Enter commits, and is the reason this heading refuses a newline.
    await page.keyboard.press("Enter");
  });
  await expect(page.getByRole("heading", { name: "Kyoto notes", level: 1 })).toBeVisible();

  // The index is the other half of the claim: a rename that only shows on the
  // page it was typed on has not renamed anything. Back via the page's own
  // link, not `openNotebookIndex` — that helper starts from the trip board, and
  // the board's "Notebooks" button is not on this screen.
  await page.getByRole("link", { name: /Notebooks/ }).click();
  await expect(page.getByRole("heading", { name: "Notebooks", exact: true, level: 2 })).toBeVisible();
  await expect(page.getByRole("link", { name: /Kyoto notes/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /^Overview/ })).toHaveCount(0);
  // And the button it replaced is gone.
  await expect(page.getByRole("button", { name: /^Rename/ })).toHaveCount(0);
});

// KI-2026-09-05-b: the Reading/Editing toggle used to sit only in normal
// document flow at the top of the page, so on a notebook taller than the
// viewport it scrolled out of view with everything else — the one place a
// long page's author could not change the mode from was wherever they had
// just finished typing, at the bottom. Proven here rather than in a unit
// test: jsdom has no layout engine, so "is this element still in the
// viewport after a real scroll" is not something `PageScreen.test.tsx` can
// observe.
test("the mode toggle stays reachable after scrolling to the bottom of a long page (KI-2026-09-05-b)", async ({
  page,
}) => {
  const tripName = e2eTripName("Setubal");
  const trip = await page.request.post("/api/trips", { data: { name: tripName } }).then((r) => r.json());
  const tripId = trip.tripId as string;

  // Long enough to clear the 900px desktop viewport several times over —
  // built directly against `PageDoc`'s own shape rather than typed through
  // the editor, which this test has no need to exercise.
  const paragraphs = Array.from({ length: 60 }, (_, i) => ({
    type: "paragraph" as const,
    content: [{ type: "text" as const, text: `Paragraph ${i + 1} of a notebook page long enough to scroll.` }],
  }));
  const created = await page.request
    .post(`/api/trips/${tripId}/pages`, {
      data: { title: "A very long page", context: { tripId }, content: newPageDoc(paragraphs) },
    })
    .then((r) => r.json());
  const pageId = created.page.id as string;

  await page.goto(`/trips/${tripId}/pages/${pageId}`);
  await expect(page.getByRole("heading", { name: "A very long page", level: 1 })).toBeVisible();

  const toggle = page.getByRole("button", { name: "Edit page" });
  await expect(toggle).toBeVisible();
  await toggle.click();
  await expect(page.getByRole("button", { name: "Done editing" })).toBeVisible();

  await page.mouse.wheel(0, 100_000);
  await expect(page.getByText("Paragraph 60 of a notebook page long enough to scroll.")).toBeVisible();

  // The claim: after scrolling all the way down, the toggle is still on
  // screen — reachable from wherever the reader/author actually is, not
  // only from the top of the document.
  await expect(page.getByRole("button", { name: "Done editing" })).toBeInViewport();
});
