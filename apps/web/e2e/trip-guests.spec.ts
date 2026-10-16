import type { Locator, Page, Response } from "@playwright/test";
import type { TripDetail } from "@tc/contracts";
import { expect, test } from "./fixtures/test";
import { createMappedTrip } from "./helpers";
import { e2eTripName } from "./tripNames";

// Trip guests, part 3 (guests spec P1): the owner names two guests in the
// People panel, marks them not travelling, and picks them in a stop's
// "Who is in" — the per-person cost then counts them (the explicit pick
// stands, ADR-065 D6), and the saved stop prices them on the server too
// (part 2's overlay).
//
// Two guests rather than one: picking a single not-travelling guest prices
// the stop for exactly one person either way, so only the second pick moves
// the line — and the move is then unambiguously the guests' doing.

function guestRow(sheet: Locator, name: string) {
  return sheet.getByTestId("guest-row").filter({ hasText: name });
}

async function addGuest(sheet: Locator, name: string, count: number) {
  await sheet.getByRole("button", { name: "Add guest" }).click();
  await sheet.getByLabel("Guest name").fill(name);
  await sheet.getByRole("button", { name: "Add", exact: true }).click();
  await expect(sheet.getByText(`Guests · ${count}`)).toBeVisible();
  await expect(guestRow(sheet, name)).toBeVisible();
}

async function markNotTravelling(page: Page, sheet: Locator, name: string) {
  await guestRow(sheet, name).getByRole("button", { name: `Actions for ${name}` }).click();
  await page.getByRole("menuitem", { name: "Mark as not travelling" }).click();
  await expect(guestRow(sheet, name).getByText("Not travelling")).toBeVisible();
}

/** The command's confirming round-trip, by what its served detail says. */
function confirmedDetail(page: Page, tripId: string, when: (detail: TripDetail) => boolean): Promise<Response> {
  return page.waitForResponse(async (r) => {
    if (new URL(r.url()).pathname !== `/api/trips/${tripId}/commands` || r.request().method() !== "POST" || !r.ok())
      return false;
    const { detail } = (await r.json()) as { detail: TripDetail };
    return when(detail);
  });
}

test("guests are picked in Who is in and count toward the stop's per-person cost", async ({ page }) => {
  const tripName = e2eTripName("Guests");
  // One stop at $100.00 a person that nobody is picked for.
  const tripId = await createMappedTrip(page, tripName, 1, {
    costs: [{ amountMinor: 10_000, currency: "USD" }],
    title: () => "Wine tasting",
  });
  await page.goto(`/trips/${tripId}?view=Plan`);

  // -- the People panel: two guests, neither travelling --
  await page.getByRole("button", { name: `${tripName} — Trip settings` }).click();
  const sheet = page.getByRole("dialog", { name: "Trip settings" });
  await expect(sheet).toBeVisible();
  const people = sheet.getByTestId("people-section");

  await addGuest(people, "Grandma", 1);
  await addGuest(people, "Baby", 2);
  await markNotTravelling(page, people, "Grandma");
  await markNotTravelling(page, people, "Baby");
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);

  // -- the stop editor: both guests are offered under "Not travelling" --
  const card = page.getByTestId(/activity-card-/).filter({ hasText: "Wine tasting" });
  await card.getByRole("button", { name: /^Edit / }).click();
  const editor = page.getByRole("dialog", { name: "Edit activity" });
  await expect(editor).toBeVisible();

  const notTravelling = editor.getByRole("group", { name: "Not travelling" });
  const grandma = notTravelling.getByRole("button", { name: /Grandma/ });
  const baby = notTravelling.getByRole("button", { name: /Baby/ });
  // The badge says what they are — the name alone would read as a member.
  await expect(grandma.getByText("Guest")).toBeVisible();
  await expect(baby.getByText("Guest")).toBeVisible();

  // Nobody picked is every traveller: the owner alone, $100.00.
  const total = editor.getByTestId("activity-cost-total");
  await expect(total).toHaveText("× 1 person = $100.00");

  // Picking one guest prices the stop for exactly one person — the explicit
  // pick stands (D6) — and the second pick is the one that moves the line.
  await grandma.click();
  await expect(total).toHaveText("× 1 person = $100.00");
  await baby.click();
  await expect(total).toHaveText("× 2 people = $200.00");

  // -- save: the command's confirmed detail prices the stop for both guests --
  // (the response's detail is the server's overlaid one, part 2's path).
  const saved = confirmedDetail(page, tripId, (detail) => detail.tripCostTotal === 20_000);
  await editor.getByRole("button", { name: "Save" }).click();
  const { detail } = (await (await saved).json()) as { detail: TripDetail };
  expect(detail.tripCostTotal).toBe(20_000);
  const stop = Object.values(detail.activities).find((a) => a.title === "Wine tasting");
  expect(stop?.participants).toHaveLength(2);
  expect(stop?.participants.every((id) => id.startsWith("guest_"))).toBe(true);
});
