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
// e2e test may make a real model call). ADR-037 decision 4's sidebar is the
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
  return tripName;
}

async function openTripOverview(page: Page): Promise<void> {
  await openNotebookIndex(page);
  await page.getByRole("link", { name: /Trip Overview/ }).click();
  await expect(page.getByRole("heading", { name: "Trip Overview" })).toBeVisible();
}

test("insert a widget from the sidebar, point it at a day, and reload to find it there", async ({ page }) => {
  await tripWithTwoDays(page);
  await openTripOverview(page);

  // A notebook opens ready to edit, so the sidebar is already there. Making
  // Reading the default broke m7's hand-typed-prose walk, which is the
  // behaviour everyone already has.
  const sidebar = page.getByRole("complementary", { name: "Widgets" });
  await expect(sidebar).toBeVisible();

  // Search, because a flat list of sixteen is what the widget model's own
  // success looks like.
  await sidebar.getByRole("searchbox", { name: "Search widgets" }).fill("day costs");
  const dayCost = sidebar.getByRole("button", { name: /What a day costs/ });
  await expect(dayCost).toBeVisible();

  // Put the caret in the document first: `insertContent` inserts at the
  // selection, and a click on the sidebar moves focus out of the editor.
  await page.locator(".tc-page-editor h2").first().click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");

  await waitForPageSaved(page, () => dayCost.click());

  // It lands UNBOUND — never quietly on day 1 (ADR-037 decision 6). This is
  // the assertion a "sensible default" would break, and the one that makes the
  // chrome row necessary rather than decorative.
  await expect(page.getByText("no day set").or(page.getByRole("button", { name: "select a day" }))).toBeVisible();

  const daySelect = page.getByRole("combobox", { name: /What a day costs/ });
  await expect(daySelect).toHaveValue("");
  await waitForPageSaved(page, () => daySelect.selectOption("1"));

  // The whole point: reload and the binding is still there. The unit tests
  // assert the PATCH body; only this asserts the round trip.
  await page.reload();
  await expect(page.getByRole("heading", { name: "Trip Overview" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: /What a day costs/ })).toHaveValue("1");
});

test("two widgets on one page read two different days", async ({ page }) => {
  // ADR-037 open question 1, settled by Mitchell: "i should be able to have a
  // notebook that shows day 1, day 3 and day 9". Each widget carries its own
  // binding, which is the thing an aggregated page-level control would break —
  // and did, before SPEC §18 removed the page's scope.
  await tripWithTwoDays(page);
  await openTripOverview(page);

  const sidebar = page.getByRole("complementary", { name: "Widgets" });
  await page.locator(".tc-page-editor h2").first().click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");

  await waitForPageSaved(page, () => sidebar.getByRole("button", { name: /What a day costs/ }).click());
  await waitForPageSaved(page, () => sidebar.getByRole("button", { name: /A day's stops/ }).click());

  const selects = page.getByRole("combobox");
  await expect(selects).toHaveCount(2);
  await waitForPageSaved(page, () => selects.nth(0).selectOption("0"));
  await waitForPageSaved(page, () => selects.nth(1).selectOption("1"));

  await page.reload();
  await expect(page.getByRole("heading", { name: "Trip Overview" })).toBeVisible();
  const afterReload = page.getByRole("combobox");
  await expect(afterReload.nth(0)).toHaveValue("0");
  await expect(afterReload.nth(1)).toHaveValue("1");
});

test("Reading takes the whole authoring surface away, and the widget stays", async ({ page }) => {
  // SPEC §18: Reading is the traveller's view. No insert affordance, no chrome
  // row — but the widget itself is still resolved and still on the page, which
  // is the difference between "hidden" and "removed".
  await tripWithTwoDays(page);
  await openTripOverview(page);

  const sidebar = page.getByRole("complementary", { name: "Widgets" });
  await page.locator(".tc-page-editor h2").first().click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await waitForPageSaved(page, () => sidebar.getByRole("button", { name: /The trip's name/ }).click());

  await page.getByRole("button", { name: "Done editing" }).click();
  await expect(page.getByRole("complementary", { name: "Widgets" })).toBeHidden();
  await expect(page.getByRole("combobox")).toHaveCount(0);

  await page.getByRole("button", { name: "Edit page" }).click();
  await expect(page.getByRole("complementary", { name: "Widgets" })).toBeVisible();
});

test("a repeater renders one line per day", async ({ page }) => {
  // M14's gate line for repeaters. `day.line` takes no inputs, so it is
  // finished the moment it lands — and the two days created above are exactly
  // what tells one line per day apart from one line.
  await tripWithTwoDays(page);
  await openTripOverview(page);

  const sidebar = page.getByRole("complementary", { name: "Widgets" });
  await sidebar.getByRole("searchbox", { name: "Search widgets" }).fill("every day");
  await page.locator(".tc-page-editor h2").first().click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await waitForPageSaved(page, () => sidebar.getByRole("button", { name: /A line for every day/ }).click());

  await expect(page.getByText("Day 1", { exact: true })).toBeVisible();
  await expect(page.getByText("Day 2", { exact: true })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { name: "Trip Overview" })).toBeVisible();
  await expect(page.getByText("Day 2", { exact: true })).toBeVisible();
});
