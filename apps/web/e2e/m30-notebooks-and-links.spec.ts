import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures/test";
import { DEFAULT_TEMPLATES } from "@tc/pages";
import { createEmptyTripViaWizard } from "./helpers";
import { e2eTripName } from "./tripNames";

// M30 — several notebooks, an itinerary Overview, and two link widgets.
//
// Mitchell, 2026-09-26: *"Maybe the issue is trying to make the overview do
// everything, and instead we have several notebooks, with different
// purposes. A great feature we are missing is we should have a Link widget
// that lets you link to other notebooks, or pages in the website"*.
//
// Walked the way a person walks it: a new trip, its four notebooks, the
// Overview's cards to the other three, then an internal link inserted through
// the rail's search-as-you-type picker and followed, and an external link
// typed in. Every write is followed by a reload of what it wrote.

async function openNotebookIndex(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Notebooks" }).click();
  await page.getByRole("link", { name: /Browse all notebooks/ }).click();
  await expect(page.getByRole("heading", { name: "Notebooks", exact: true, level: 2 })).toBeVisible();
}

// The edit session writes once, when it ends (ADR-036).
async function finishEditing(page: Page): Promise<void> {
  await Promise.all([
    page.waitForResponse(
      (r) => /\/api\/trips\/[^/]+\/pages\/[^/]+$/.test(new URL(r.url()).pathname) && r.request().method() === "PATCH" && r.ok(),
    ),
    page.getByRole("button", { name: "Done editing" }).click(),
  ]);
}

// A caret on a line of its own under the page's first heading, then a row from
// the rail — `m14-notebook-widgets.spec.ts`' two-beat insert.
async function insertFromRail(page: Page, name: RegExp, search: string): Promise<void> {
  // **Clicked until the settings let go**, and that is a known defect rather
  // than patience: right after a link widget is bound from its settings, the
  // first click into the page sometimes leaves those settings open — 3 of 8
  // repeat runs on 2026-09-26, always here, never elsewhere in the walk.
  // KI-2026-09-26-a has the evidence; a person clicks again, and so does this.
  await expect(async () => {
    await page.locator(".tc-page-editor h2").first().click();
    await expect(page.getByTestId("widget-settings")).toHaveCount(0, { timeout: 1000 });
  }).toPass();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("widget-settings")).toHaveCount(0);
  await page.getByRole("searchbox", { name: "Search widgets" }).fill(search);
  await page.getByRole("complementary").getByRole("list").getByRole("button", { name }).click();
  await expect(page.getByTestId("widget-settings")).toBeVisible();
}

test("a new trip comes with four notebooks, and the Overview links to the other three", async ({ page }) => {
  const tripName = e2eTripName("Porto");
  await page.goto("/");
  await createEmptyTripViaWizard(page, tripName);
  await page.getByRole("link", { name: tripName }).click();
  await expect(page.getByRole("heading", { name: tripName, level: 2 })).toBeVisible();

  // -- the four, in order, each described by its own first line --
  await openNotebookIndex(page);
  const mine = page.getByRole("region", { name: "Your notebooks" });
  await expect(mine.getByRole("listitem")).toHaveText(DEFAULT_TEMPLATES.map((t) => new RegExp(t.title)));
  await expect(mine.getByRole("listitem").filter({ hasText: "Money" })).toContainText("What the trip costs, day by day");

  // -- the Overview's cards find their notebooks, and go there --
  await mine.getByRole("link", { name: /^Overview/ }).click();
  await expect(page.getByRole("heading", { name: "Overview", level: 1 })).toBeVisible();
  const moneyCard = page.getByRole("link", { name: /Money/ });
  await expect(moneyCard).toContainText("What the trip costs, day by day, against the budget.");
  await moneyCard.click();
  await expect(page.getByRole("heading", { name: "Money", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Spend by day" })).toBeVisible();
});

test("insert an internal link to Money and follow it; insert a link to a website", async ({ page }) => {
  const tripName = e2eTripName("Evora");
  await page.goto("/");
  await createEmptyTripViaWizard(page, tripName);
  await page.getByRole("link", { name: tripName }).click();
  await expect(page.getByRole("heading", { name: tripName, level: 2 })).toBeVisible();
  await openNotebookIndex(page);
  await page.getByRole("region", { name: "Your notebooks" }).getByRole("link", { name: /^Before you go/ }).click();
  await expect(page.getByRole("heading", { name: "Before you go", level: 1 })).toBeVisible();
  // The weather's answer lands after the page does; clicking into the page
  // before it has would be clicking a page that may yet move.
  await expect(page.getByText("loading weather")).toHaveCount(0);
  await page.getByRole("button", { name: "Edit page" }).click();

  // -- internal: the picker opens on insert, searches what exists, stores the id --
  await insertFromRail(page, /Link to a notebook or tab/, "link");
  const picker = page.getByTestId("widget-settings").getByRole("combobox");
  await expect(picker).toBeFocused();
  await expect(page.getByRole("option", { name: /Money/ })).toBeVisible();
  await expect(page.getByRole("option", { name: /^Map/ })).toBeVisible();
  await picker.fill("mon");
  await expect(page.getByRole("option")).toHaveCount(1);
  await page.keyboard.press("Enter");
  // The card appears in the document with the notebook's own words.
  await expect(page.getByTestId("link-card").filter({ hasText: "Money" })).toContainText("What the trip costs");

  // -- external: an address and words, checked before they are stored --
  await insertFromRail(page, /Link to a website/, "website");
  const address = page.getByTestId("widget-settings").getByRole("textbox", { name: /Web address/ });
  await expect(address).toBeFocused();
  await address.fill("javascript:alert(1)");
  await address.press("Enter");
  await expect(page.getByTestId("widget-settings").getByRole("alert")).toContainText("https://");
  await address.fill("www.jreast.co.jp/e/pass");
  await address.press("Enter");
  const words = page.getByTestId("widget-settings").getByRole("textbox", { name: /Link text/ });
  await words.fill("JR East rail pass");
  await words.press("Enter");
  await finishEditing(page);

  // -- both survive a reload, and read as what they are --
  await page.reload();
  await expect(page.getByRole("heading", { name: "Before you go", level: 1 })).toBeVisible();
  const external = page.getByRole("link", { name: "JR East rail pass" });
  await expect(external).toHaveAttribute("href", "https://www.jreast.co.jp/e/pass");
  await expect(external).toHaveAttribute("target", "_blank");
  await expect(external).toHaveAttribute("rel", "noopener noreferrer");

  await page.getByTestId("link-card").filter({ hasText: "Money" }).click();
  await expect(page.getByRole("heading", { name: "Money", level: 1 })).toBeVisible();
});
