import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures/test";
import { createEmptyTripViaWizard } from "./helpers";
import { e2eTripName } from "./tripNames";

// Resetting a trip's default notebooks, and adding the ones it is missing
// (Mitchell, 2026-09-27: *"we might want a way to reset a trips default
// notebooks back to there seed and add any new seeds that didnt exist when the
// trip was made"*; owner only). Signed in as the account that makes the trip,
// so as its owner.
//
// A trip made before a seed existed is simulated the way it looks from the
// list: a seed the trip does not have, removed with the list's own Delete.

const LETTER = /^Here is your itinerary, day by day/;

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

test("the owner resets an edited Overview to its default, and adds back a missing notebook", async ({ page }) => {
  const tripName = e2eTripName("Coimbra");
  await page.goto("/");
  await createEmptyTripViaWizard(page, tripName);
  await page.getByRole("link", { name: tripName }).click();
  await expect(page.getByRole("heading", { name: tripName, level: 2 })).toBeVisible();

  // -- edit the Overview: its opening letter becomes the owner's own words --
  await openNotebookIndex(page);
  const mine = page.getByRole("region", { name: "Your notebooks" });
  await mine.getByRole("link", { name: /^Overview/ }).click();
  await expect(page.getByRole("heading", { name: "Overview", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "Edit page" }).click();
  // Three clicks select the whole paragraph; Home and Shift+End only reach
  // the end of its first wrapped line.
  await page.locator(".tc-page-editor p").filter({ hasText: LETTER }).click({ clickCount: 3 });
  await page.keyboard.type("Our own words about this trip.");
  await finishEditing(page);
  await page.reload();
  await expect(page.getByText("Our own words about this trip.")).toBeVisible();
  await expect(page.getByText(LETTER)).toHaveCount(0);

  // -- Reset to default, confirmed: the template's letter is back --
  await page.getByRole("button", { name: "Reset to default" }).click();
  const dialog = page.getByRole("dialog", { name: "Reset to default?" });
  await expect(dialog).toContainText("can undo the reset");
  await dialog.getByRole("button", { name: "Reset notebook" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(LETTER)).toBeVisible();
  await expect(page.getByText("Our own words about this trip.")).toHaveCount(0);
  // And it is what the server now holds, not only what the screen shows.
  await page.reload();
  await expect(page.getByText(LETTER)).toBeVisible();
  await expect(page.getByText("Our own words about this trip.")).toHaveCount(0);

  // -- a notebook the trip is missing, added back from the list --
  // Back up the breadcrumb: the Notebooks menu is on the trip board, not here.
  await page.getByRole("link", { name: "Notebook", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Notebooks", exact: true, level: 2 })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add missing default notebooks" })).toHaveCount(0);
  await mine.getByRole("button", { name: "Delete Money" }).click();
  await expect(mine.getByRole("link", { name: /^Money/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Add missing default notebooks" }).click();
  await expect(mine.getByRole("link", { name: /^Money/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add missing default notebooks" })).toHaveCount(0);
  await page.reload();
  await expect(mine.getByRole("link", { name: /^Money/ })).toBeVisible();

  // -- and the Overview's card for it leads to the Money that is back --
  // It comes back under the id it had, so the card the Overview already
  // carries resolves; under a fresh id it said "this notebook was deleted".
  const moneyHref = await mine.getByRole("link", { name: /^Money/ }).getAttribute("href");
  const moneyId = /\/pages\/([^/?#]+)/.exec(moneyHref ?? "")?.[1];
  expect(moneyId).toBeTruthy();
  await mine.getByRole("link", { name: /^Overview/ }).click();
  await expect(page.getByRole("heading", { name: "Overview", level: 1 })).toBeVisible();
  const card = page.getByRole("link", { name: /Money/ });
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute("href", new RegExp(`/pages/${moneyId}(?:[?#]|$)`));
  await expect(page.getByText("this notebook was deleted")).toHaveCount(0);
});

test("the reset can be undone straight afterwards", async ({ page }) => {
  const tripName = e2eTripName("Braga");
  await page.goto("/");
  await createEmptyTripViaWizard(page, tripName);
  await page.getByRole("link", { name: tripName }).click();
  await openNotebookIndex(page);
  await page.getByRole("region", { name: "Your notebooks" }).getByRole("link", { name: /^Overview/ }).click();

  await page.getByRole("button", { name: "Edit page" }).click();
  // Three clicks select the whole paragraph; Home and Shift+End only reach
  // the end of its first wrapped line.
  await page.locator(".tc-page-editor p").filter({ hasText: LETTER }).click({ clickCount: 3 });
  await page.keyboard.type("Words worth keeping.");
  await finishEditing(page);

  await page.getByRole("button", { name: "Reset to default" }).click();
  await page.getByRole("dialog", { name: "Reset to default?" }).getByRole("button", { name: "Reset notebook" }).click();
  await expect(page.getByText(LETTER)).toBeVisible();

  await page.getByTestId("page-reset-undo").getByRole("button", { name: "Undo reset" }).click();
  await expect(page.getByText("Words worth keeping.")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Words worth keeping.")).toBeVisible();
  await expect(page.getByText(LETTER)).toHaveCount(0);
});

// A seed renamed away from its template's title is not recognised, so "Add
// missing" seeds a second one; renaming the first back onto that title is then
// refused as `page-title-taken` (409). The screen used to put the old title
// back and say nothing, with the header light still reading "All changes
// saved" (PR 258's preview walk).
test("a rename onto a default notebook's title is refused, and the screen says so", async ({ page }) => {
  const tripName = e2eTripName("Aveiro");
  await page.goto("/");
  await createEmptyTripViaWizard(page, tripName);
  await page.getByRole("link", { name: tripName }).click();
  await openNotebookIndex(page);
  const mine = page.getByRole("region", { name: "Your notebooks" });

  // Enter commits a title (PageTitle); its PATCH is awaited, refused or not.
  const rename = async (to: string) => {
    await page.getByRole("heading", { level: 1 }).click();
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.type(to);
    await Promise.all([
      page.waitForResponse(
        (r) => /\/api\/trips\/[^/]+\/pages\/[^/]+$/.test(new URL(r.url()).pathname) && r.request().method() === "PATCH",
      ),
      page.keyboard.press("Enter"),
    ]);
  };

  await mine.getByRole("link", { name: /^Money/ }).click();
  await expect(page.getByRole("heading", { name: "Money", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "Edit page" }).click();
  await rename("Budget");
  await expect(page.getByRole("heading", { name: "Budget", level: 1 })).toBeVisible();
  await expect(page.getByTestId("page-rename-failure")).toHaveCount(0);

  await page.getByRole("link", { name: "Notebook", exact: true }).click();
  await page.getByRole("button", { name: "Add missing default notebooks" }).click();
  await expect(mine.getByRole("link", { name: /^Money/ })).toBeVisible();

  await mine.getByRole("link", { name: /^Budget/ }).click();
  await expect(page.getByRole("heading", { name: "Budget", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "Edit page" }).click();
  await rename("Money");

  await expect(page.getByTestId("page-rename-failure")).toContainText("A notebook called “Money” already exists in this trip.");
  await expect(page.getByRole("heading", { name: "Budget", level: 1 })).toBeVisible();
  await expect(page.getByRole("status", { name: "All changes saved" })).toHaveCount(0);
});
