import { expect, type Page, test } from "@playwright/test";
import { e2eTripName } from "./tripNames";
import { createEmptyTripViaWizard } from "./helpers";

// M14 link 10's gate box, walked in a real browser: *"A notebook is saved as a
// template from one trip and instantiated into a different trip."*
//
// What this proves that the unit and integration suites cannot: the three
// seams are joined — the page's Save as template reaches the library, the
// library reaches ANOTHER trip's gallery, and what that gallery makes is a real
// page that survives a reload (it went through the page command path, so the
// projection row exists because the event does).

async function newTrip(page: Page, label: string): Promise<string> {
  const tripName = e2eTripName(label);
  await page.goto("/");
  await createEmptyTripViaWizard(page, tripName);
  await page.getByRole("link", { name: tripName }).click();
  await page.waitForURL(/\/trips\/[^/]+$/);
  await expect(page.getByRole("heading", { name: tripName, level: 2 })).toBeVisible();
  return tripName;
}

async function openNotebookIndex(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Notebooks" }).click();
  await page.getByRole("link", { name: /Browse all notebooks/ }).click();
  await expect(page.getByRole("heading", { name: "Notebooks", exact: true, level: 2 })).toBeVisible();
}

test("a notebook saved as a template in one trip starts a notebook in another", async ({ page }) => {
  // Unique per run: every worker signs in as the same `alice`, so her library
  // is shared across parallel specs and a fixed name could match someone else's.
  const templateName = `Packing list ${crypto.randomUUID().slice(0, 8)}`;
  const line = "Pack the rail passes and a spare charger.";

  // ── Trip A: write a notebook and keep it ──────────────────────────────────
  const tripA = await newTrip(page, "Porto");
  await openNotebookIndex(page);
  await page.getByRole("button", { name: "Start from Blank notebook" }).click();
  await expect(page.getByRole("heading", { name: "Untitled notebook", level: 1 })).toBeVisible();

  await page.getByRole("button", { name: "Edit page" }).click();
  await page.locator(".tc-page-editor").click();
  await page.keyboard.type(line);
  // The edit session writes once, on leaving Editing (ADR-036) — and Save as
  // template keeps what is STORED, so the PATCH has to land first.
  await Promise.all([
    page.waitForResponse((r) => /\/api\/trips\/[^/]+\/pages\/[^/]+$/.test(new URL(r.url()).pathname) && r.request().method() === "PATCH" && r.ok()),
    page.getByRole("button", { name: "Done editing" }).click(),
  ]);

  await page.getByRole("button", { name: "Save as template" }).click();
  const name = page.getByLabel("Name");
  // The name defaults to the page's title.
  await expect(name).toHaveValue("Untitled notebook");
  await name.fill(templateName);
  await Promise.all([
    page.waitForResponse((r) => new URL(r.url()).pathname === "/api/saved-notebooks" && r.request().method() === "POST" && r.status() === 201),
    page.getByRole("button", { name: "Save template" }).click(),
  ]);
  await expect(page.getByRole("status").filter({ hasText: `Saved “${templateName}” to your templates` })).toBeVisible();

  // ── Trip B: start a notebook from it ──────────────────────────────────────
  await newTrip(page, "Lisbon");
  await openNotebookIndex(page);
  const yours = page.getByRole("region", { name: "Your templates" });
  const card = yours.getByRole("listitem").filter({ hasText: templateName });
  await expect(card).toContainText(`From ${tripA}`);
  await card.getByRole("button", { name: `Start from your template ${templateName}` }).click();

  await page.waitForURL(/\/trips\/[^/]+\/pages\/[^/]+$/);
  await expect(page.getByRole("heading", { name: templateName, level: 1 })).toBeVisible();
  await expect(page.getByText(line)).toBeVisible();

  // It is a real notebook of trip B, not a view of the template: it survives a
  // reload and is listed in B's own notebooks.
  await page.reload();
  await expect(page.getByRole("heading", { name: templateName, level: 1 })).toBeVisible();
  await expect(page.getByText(line)).toBeVisible();
  const tripB = new URL(page.url()).pathname.split("/")[2]!;
  await page.goto(`/trips/${tripB}/pages`);
  await expect(page.getByRole("region", { name: "Your notebooks" }).getByRole("link", { name: new RegExp(templateName) })).toBeVisible();
});
