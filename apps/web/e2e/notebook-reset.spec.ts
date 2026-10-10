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
  await expect(page.getByRole("heading", { name: "Notebooks", exact: true, level: 1 })).toBeVisible();
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
  await expect(page.getByRole("heading", { name: tripName, level: 1 })).toBeVisible();

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
  // Behind the notebook's `⋯` since Mitchell's PR #269 preview ("reset to
  // default shouldnt be so prominent"), so every reset below opens it first.
  await page.getByRole("button", { name: "More notebook actions" }).click();
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
  await expect(page.getByRole("heading", { name: "Notebooks", exact: true, level: 1 })).toBeVisible();
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

// Mitchell, 2026-10-03: *"A missing default notebook widget should have a call
// to action to click and generate that missing notebook."* The Overview names
// Money by its seed key, so with Money gone its card is the offer to add it;
// the owner's click adds that one notebook and the same card becomes the link.
test("the Overview's card for a missing default adds it, and then leads to it", async ({ page }) => {
  const tripName = e2eTripName("Viseu");
  await page.goto("/");
  await createEmptyTripViaWizard(page, tripName);
  await page.getByRole("link", { name: tripName }).click();
  await openNotebookIndex(page);
  const mine = page.getByRole("region", { name: "Your notebooks" });
  await mine.getByRole("button", { name: "Delete Money" }).click();
  await expect(mine.getByRole("link", { name: /^Money/ })).toHaveCount(0);

  await mine.getByRole("link", { name: /^Overview/ }).click();
  await expect(page.getByRole("heading", { name: "Overview", level: 1 })).toBeVisible();
  const offer = page.getByTestId("link-missing");
  await expect(offer).toHaveText(/Money/);
  // The other two are there, so only Money is offered.
  await expect(page.getByTestId("link-card")).toHaveText([/Before you go/, /Bookings/]);

  await offer.getByRole("button", { name: "Add Money" }).click();
  // In place, with no reload: the offer is gone and Money is the third card.
  await expect(offer).toHaveCount(0);
  await expect(page.getByTestId("link-card")).toHaveText([/Before you go/, /Bookings/, /Money/]);

  await page.getByTestId("link-card").filter({ hasText: "Money" }).click();
  await expect(page.getByRole("heading", { name: "Money", level: 1 })).toBeVisible();
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

  await page.getByRole("button", { name: "More notebook actions" }).click();
  await page.getByRole("button", { name: "Reset to default" }).click();
  await page.getByRole("dialog", { name: "Reset to default?" }).getByRole("button", { name: "Reset notebook" }).click();
  await expect(page.getByText(LETTER)).toBeVisible();

  await page.getByTestId("page-reset-undo").getByRole("button", { name: "Undo reset" }).click();
  await expect(page.getByText("Words worth keeping.")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Words worth keeping.")).toBeVisible();
  await expect(page.getByText(LETTER)).toHaveCount(0);
});

// Mitchell, 2026-09-27: *"You should be allowed to rename a default notebook,
// or delete one."* A default is known by its seed key, not its title, so
// "Money" renamed "Budget" is still the Money default: the list has nothing
// missing to add, and Reset to default still puts it back. Until then the
// rename made it an ordinary notebook, "Add missing" planted a second "Money"
// beside it, and renaming "Budget" back was refused (KI-2026-09-27-e).
test("a renamed default notebook is still that default, and resets to its template", async ({ page }) => {
  const tripName = e2eTripName("Aveiro");
  await page.goto("/");
  await createEmptyTripViaWizard(page, tripName);
  await page.getByRole("link", { name: tripName }).click();
  await openNotebookIndex(page);
  const mine = page.getByRole("region", { name: "Your notebooks" });

  await mine.getByRole("link", { name: /^Money/ }).click();
  await expect(page.getByRole("heading", { name: "Money", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "Edit page" }).click();
  // Enter commits a title (PageTitle); its PATCH is awaited.
  await page.getByRole("heading", { level: 1 }).click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("Budget");
  await Promise.all([
    page.waitForResponse(
      (r) => /\/api\/trips\/[^/]+\/pages\/[^/]+$/.test(new URL(r.url()).pathname) && r.request().method() === "PATCH" && r.ok(),
    ),
    page.keyboard.press("Enter"),
  ]);
  await expect(page.getByRole("heading", { name: "Budget", level: 1 })).toBeVisible();
  await expect(page.getByTestId("page-rename-failure")).toHaveCount(0);

  // Nothing is missing: "Budget" is the Money default.
  await page.getByRole("link", { name: "Notebook", exact: true }).click();
  await expect(mine.getByRole("link", { name: /^Budget/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add missing default notebooks" })).toHaveCount(0);
  await expect(mine.getByRole("link", { name: /^Money/ })).toHaveCount(0);

  // And it keeps its way back: the template's title and all.
  await mine.getByRole("link", { name: /^Budget/ }).click();
  await expect(page.getByRole("heading", { name: "Budget", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "More notebook actions" }).click();
  await page.getByRole("button", { name: "Reset to default" }).click();
  await page.getByRole("dialog", { name: "Reset to default?" }).getByRole("button", { name: "Reset notebook" }).click();
  await expect(page.getByRole("heading", { name: "Money", level: 1 })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Money", level: 1 })).toBeVisible();
});
