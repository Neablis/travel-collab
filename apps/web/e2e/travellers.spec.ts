import { randomUUID } from "node:crypto";
import type { Browser, Page, Response } from "@playwright/test";
import type { TripDetail } from "@tc/contracts";
import { expect, test } from "./fixtures/test";
import { grantCollaborators } from "./adminBootstrap";
import { createMappedTrip, personRow } from "./helpers";
import { e2eTripName } from "./tripNames";

// The travellers spec's journey (docs/specs/2026-10-05-travellers-and-people-
// panel-design.md): the owner invites someone to SUGGEST, they join,
// and the per-person totals do not move until the owner says they are coming.
// That is #314's case — a suggester who joined to advise doubled the trip from
// $9,130 to $18,260 — and KI-2026-10-04-b's: the owner's open panel did not see
// the join at all without a reload.
//
// Two real browser contexts for the reason m11-invites.spec.ts gives, and its
// `newcomer` and `signedInAs`, kept local as suggester.spec.ts keeps them.

function newcomer(prefix: string): string {
  return `${prefix}${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

// Signed out, onto the link, and in on the banked token (m11-invites' M11a note).
async function signedInAs(browser: Browser, username: string, link: string): Promise<Page> {
  const page = await (await browser.newContext({ storageState: undefined })).newPage();
  await page.goto(link);
  await page.getByRole("link", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/signin\?callbackUrl=%2Finvite%2F/);
  await page.getByLabel("Username").fill(username);
  await Promise.all([
    page.waitForURL((url) => !/^\/sign(in|up)$/.test(url.pathname)),
    page.getByRole("button", { name: /sign in with dev login/i }).click(),
  ]);
  return page;
}

/**
 * The owner's next read of the trip whose members satisfy `when`.
 *
 * The board's figures are the server's (`overlay.ts` recosts on read), and the
 * re-read that brings them is fire-and-forget beside the access read — so a
 * total asserted only on screen could be read in the instant before a wrong
 * one lands. Waiting for the read itself, by what it says rather than by when
 * it came, makes the figure checked the figure served, whichever poll or write
 * triggered it.
 */
function detailRead(page: Page, tripId: string, when: (members: TripDetail["members"]) => boolean): Promise<Response> {
  return page.waitForResponse(async (r) => {
    if (new URL(r.url()).pathname !== `/api/trips/${tripId}` || r.request().method() !== "GET" || !r.ok()) return false;
    const { trip } = (await r.json()) as { trip: TripDetail };
    return when(trip.members);
  });
}

async function tripCostTotal(read: Promise<Response>): Promise<number> {
  return ((await (await read).json()) as { trip: TripDetail }).trip.tripCostTotal;
}

/**
 * The header's avatar stack opens Trip settings at People (D10) — at `sm` and
 * up only: below it the stack is hidden (W20) and the title is the way in.
 * A no-op there, so the journey above it still runs at every width.
 */
async function peopleFromHeader(page: Page): Promise<void> {
  if (page.viewportSize()!.width < 640) return;
  await page.getByRole("button", { name: "Travellers on this trip" }).click();
  const sheet = page.getByRole("dialog", { name: "Trip settings" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByTestId("people-section")).toBeInViewport();
}

// Inviting needs the owner's `trip.collaborators` (M20 link 6; m11-invites).
test.beforeAll(async ({ browser }) => {
  await grantCollaborators(browser, "dev-alice");
});

test("a suggester joins without moving the totals, and counts once marked as travelling", async ({
  page,
  browser,
}) => {
  // Two contexts, two sign-ins, two page loads: the budget m11-invites gives.
  test.slow();
  const tripName = e2eTripName("Travellers");
  // One stop at $9,130.00 a person that nobody is picked for, so it is priced
  // for every traveller — #314's figure. The budget is only there because the
  // sheet states the total as "<total> of <budget>"; it never comes into play.
  const tripId = await createMappedTrip(page, tripName, 1, {
    costs: [{ amountMinor: 913_000, currency: "USD" }],
    budget: { amountMinor: 5_000_000, currency: "USD" },
  });
  await page.goto(`/trips/${tripId}?view=Plan`);
  await page.getByRole("button", { name: `${tripName} — Trip settings` }).click();
  const sheet = page.getByRole("dialog", { name: "Trip settings" });
  await expect(sheet).toBeVisible();
  const people = sheet.getByTestId("people-section");
  await expect(people.getByText("Costs are split across 1 traveller.")).toBeVisible();
  await expect(sheet.getByText("$9,130.00 of $50,000.00")).toBeVisible();

  // D3: "Coming on the trip" is preset by the role — on for an editor, off for
  // a suggester. Both halves, so a preset that is simply always off fails.
  await people.getByRole("button", { name: "Invite", exact: true }).click();
  const invite = page.getByRole("dialog", { name: "Invite someone" });
  const coming = invite.getByRole("checkbox", { name: /Coming on the trip/ });
  await expect(coming).toBeChecked();
  await invite.getByRole("radiogroup", { name: "Role" }).getByRole("radio", { name: "Can suggest" }).click();
  await expect(coming).not.toBeChecked();
  await Promise.all([
    page.waitForResponse(
      (r) => new URL(r.url()).pathname === `/api/trips/${tripId}/invites` && r.request().method() === "POST",
    ),
    invite.getByRole("button", { name: "Create invite" }).click(),
  ]);
  // Off the "Invite link" field, not the clipboard — m11-invites says why.
  const field = invite.getByRole("textbox", { name: "Invite link" });
  await expect(field).toHaveValue(/\/invite\//);
  const link = await field.inputValue();
  await invite.getByRole("button", { name: "Done" }).click();
  await expect(invite).toHaveCount(0);

  const name = newcomer("advisor");
  const userId = `dev-${name}`;
  // Registered before the join, so the read cannot slip past unwatched.
  const joined = detailRead(page, tripId, (members) => members.some((m) => m.userId === userId));
  const advisor = await signedInAs(browser, name, link);
  try {
    await advisor.goto(link);
    await advisor.getByRole("button", { name: "Join the trip" }).click();
    await expect(advisor.getByRole("heading", { name: tripName, level: 2 })).toBeVisible();
  } finally {
    await advisor.context().close();
  }

  // The owner's sheet, NOT reloaded: it was open before the invite was
  // accepted and hears about it on the poll's `accessRev` (D11). One poll
  // interval and the reads it triggers; a reload would be ~0.
  const notTravelling = people.getByRole("list", { name: "Not travelling · 1" });
  await expect(personRow(notTravelling, userId)).toBeVisible({ timeout: 15_000 });
  await expect(personRow(notTravelling, userId)).toContainText("Can suggest · helping plan");
  // The served total is the owner's alone, and so is the one on screen.
  expect(await tripCostTotal(joined)).toBe(913_000);
  await expect(sheet.getByText("$9,130.00 of $50,000.00")).toBeVisible();
  await expect(people.getByText("Costs are split across 1 traveller.")).toBeVisible();

  // Marked as travelling from their row's one control: the total doubles.
  const travelling = detailRead(page, tripId, (members) =>
    members.some((m) => m.userId === userId && m.travelling === true),
  );
  await personRow(notTravelling, userId).getByRole("button", { name: /^Actions for / }).click();
  await page.getByRole("menuitem", { name: "Mark as travelling" }).click();
  expect(await tripCostTotal(travelling)).toBe(1_826_000);
  await expect(sheet.getByText("$18,260.00 of $50,000.00")).toBeVisible();
  await expect(people.getByText("Costs are split across 2 travellers.")).toBeVisible();
  await expect(personRow(people.getByRole("list", { name: "Travelling · 2" }), userId)).toBeVisible();
  await expect(people.getByRole("list", { name: /^Not travelling/ })).toHaveCount(0);

  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  await peopleFromHeader(page);
});
