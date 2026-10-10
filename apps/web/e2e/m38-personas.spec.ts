import { randomUUID } from "node:crypto";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures/test";
import { grantCollaborators } from "./adminBootstrap";
import { createMappedTrip, openAccountPage, personRow, signInAsDevUser } from "./helpers";
import { e2eTripName } from "./tripNames";

// M38's e2e gate box, walked as one flow across two people: the owner picks an
// avatar and a colour, invites someone, and that someone reads the trip before
// joining (D4: the route and the total, never a stop's cost), picks the SAME
// colour, joins, and finds both chips in People — their own shifted for this
// trip (D3), with the tooltip saying why.
//
// **Two fresh dev users, not the shared alice session.** A persona written onto
// alice would show on every other spec that renders her — several assert her
// initials or her `dev-alice` name — so the owner is minted here and granted
// `trip.collaborators` the way m11-invites grants alice (inviting needs it
// since M20 link 6). `storageState: undefined` for m17's reason: the desktop
// project otherwise pins alice's session onto `page`.
test.use({ storageState: undefined });

const OWNER_NAME = "Rowan Persona";
const GUEST_NAME = "Juno Persona";

// Two priced stops on one dated day, so the trip has a total that is neither
// stop's cost: the page may print $60.50 and must print neither $42.50 nor
// $18.00. One stop would make the total and the stop's cost the same string,
// and "no stop cost anywhere" could not be asserted at all.
const usd = (amountMinor: number) => ({ amountMinor, currency: "USD" });
const TRIP_SHAPE = {
  activitiesPerDay: 2,
  timeWindows: [
    { start: "09:00", end: "10:00" },
    { start: "11:00", end: "12:00" },
  ],
  costs: [usd(4250), usd(1800)],
  locations: [
    { name: "Fushimi Inari Taisha", city: "Kyoto", lat: 34.9671, lng: 135.7727, countryCode: "JP" },
    { name: "Kiyomizu-dera", city: "Kyoto", lat: 34.9949, lng: 135.785, countryCode: "JP" },
  ],
};
const TOTAL = "$60.50";
const STOP_COSTS = /\$42\.50|\$18\.00/;

/** A dev username nobody has used, for m11-invites' `newcomer` reason. */
function newcomer(prefix: string): string {
  return `${prefix}${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

/** Waits on the preferences PATCH a persona pick or a name commit sends. */
function preferencesSaved(page: Page) {
  return page.waitForResponse(
    (r) => new URL(r.url()).pathname === "/api/account/preferences" && r.request().method() === "PATCH" && r.ok(),
  );
}

/** Account → Profile: a display name, an avatar and a colour, each waited to the server. */
async function choosePersona(page: Page, persona: { name: string; avatar: string; color: string }): Promise<void> {
  await openAccountPage(page, "profile");
  const nameField = page.getByLabel("Display name", { exact: true });
  await expect(nameField).toBeEnabled();
  await nameField.fill(persona.name);
  await Promise.all([preferencesSaved(page), nameField.press("Enter")]);
  for (const [group, option] of [
    ["Avatar", persona.avatar],
    ["Colour", persona.color],
  ] as const) {
    const radio = page.getByRole("radiogroup", { name: group }).getByRole("radio", { name: option, exact: true });
    await Promise.all([preferencesSaved(page), radio.click()]);
    await expect(radio).toHaveAttribute("aria-checked", "true");
  }
}

async function openPeople(page: Page, tripName: string): Promise<Locator> {
  await page.getByRole("button", { name: `${tripName} — Trip settings` }).click();
  await expect(page.getByRole("heading", { name: "Trip settings" })).toBeVisible();
  return page.getByTestId("people-section");
}

/** m11-invites' `inviteLinkFor`, editor role: the link is read off the dialog, not the clipboard. */
async function createInviteLink(page: Page): Promise<string> {
  await page.getByRole("button", { name: "Invite", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Invite someone" });
  await dialog.getByRole("radiogroup", { name: "Role" }).getByRole("radio", { name: "Can edit" }).click();
  await Promise.all([
    page.waitForResponse(
      (r) => /\/api\/trips\/[^/]+\/invites$/.test(new URL(r.url()).pathname) && r.request().method() === "POST",
    ),
    dialog.getByRole("button", { name: "Create invite" }).click(),
  ]);
  const field = dialog.getByRole("textbox", { name: "Invite link" });
  await expect(field).toHaveValue(/\/invite\//);
  const link = await field.inputValue();
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(dialog).toHaveCount(0);
  return link;
}

test("a persona survives a reload, shows on the invite before joining, and in People after", async ({
  page,
  browser,
}) => {
  // Two contexts, two sign-ins, a persona each and a full invite walk: about
  // three single-context specs' worth of work, m11-invites' budget reasoning.
  test.slow();
  const owner = newcomer("m38own");
  const guest = newcomer("m38guest");
  await grantCollaborators(browser, `dev-${owner}`);

  // 1. The owner's persona, and that it is stored rather than held on screen.
  await signInAsDevUser(page, owner);
  await choosePersona(page, { name: OWNER_NAME, avatar: "Tent", color: "Plum" });
  await page.reload();
  await expect(page.getByLabel("Display name", { exact: true })).toHaveValue(OWNER_NAME);
  for (const [group, option] of [
    ["Avatar", "Tent"],
    ["Colour", "Plum"],
  ] as const) {
    await expect(
      page.getByRole("radiogroup", { name: group }).getByRole("radio", { name: option, exact: true }),
    ).toHaveAttribute("aria-checked", "true");
  }

  // 2. A dated, priced trip, and a link to it.
  const tripName = e2eTripName("Personas");
  const tripId = await createMappedTrip(page, tripName, 1, TRIP_SHAPE);
  await page.goto(`/trips/${tripId}?view=Plan`);
  await expect(page.getByRole("heading", { name: tripName, level: 1 })).toBeVisible();
  await openPeople(page, tripName);
  const link = await createInviteLink(page);
  await page.keyboard.press("Escape");

  // 3. Signed out, the invite says who asked and what the trip is — and no
  // stop's price, anywhere on the page (D4).
  const context = await browser.newContext({ storageState: undefined });
  const visitor = await context.newPage();
  try {
    await visitor.goto(link);
    await expect(visitor.getByRole("heading", { name: tripName, level: 1 })).toBeVisible();
    await expect(visitor.getByText(`${OWNER_NAME} invited you`, { exact: true })).toBeVisible();
    // "Who's going" (`trip.people`): the owner's chip, titled with their name
    // and drawn with their glyph, and the sentence naming them.
    await expect(visitor.locator(`[title="${OWNER_NAME}"]`).locator(".lucide-tent")).toBeVisible();
    await expect(visitor.getByText("Rowan is going.", { exact: true })).toBeVisible();
    const plan = visitor.getByRole("region", { name: "The plan so far" });
    await expect(plan.getByText("Kyoto").first()).toBeVisible();
    await expect(plan).toContainText(`The trip so far comes to ${TOTAL}.`);
    await expect(visitor.locator("body")).not.toContainText(STOP_COSTS);

    await visitor.getByRole("link", { name: "Have a look first" }).click();
    await expect(visitor).toHaveURL(/\/invite\/[^/]+\/look$/);
    const lookPlan = visitor.getByRole("region", { name: "The plan so far" });
    await expect(lookPlan.getByText("Kyoto").first()).toBeVisible();
    await expect(lookPlan).toContainText(`The trip so far comes to ${TOTAL}.`);
    await expect(visitor.locator("body")).not.toContainText(STOP_COSTS);

    // 4. The same visitor signs in on the banked token (m11-invites'
    // `followInvite`), chooses a persona — the owner's colour too — and joins.
    await visitor.getByRole("link", { name: "Back to the invite" }).click();
    await visitor.getByRole("link", { name: "Sign in", exact: true }).click();
    await expect(visitor).toHaveURL(/\/signin\?callbackUrl=%2Finvite%2F/);
    await visitor.getByLabel("Username").fill(guest);
    await Promise.all([
      visitor.waitForURL((url) => url.pathname.startsWith("/invite/")),
      visitor.getByRole("button", { name: /sign in with dev login/i }).click(),
    ]);
    await visitor.goto("/");
    await expect(visitor.getByRole("heading", { name: "Your trips" })).toBeVisible();
    await choosePersona(visitor, { name: GUEST_NAME, avatar: "Bike", color: "Plum" });

    await visitor.goto(link);
    await visitor.getByRole("button", { name: "Join the trip" }).click();
    await expect(visitor.getByRole("heading", { name: tripName, level: 1 })).toBeVisible();
    await expect(visitor).toHaveURL(new RegExp(`/trips/${tripId}`));

    // 5. People, as the guest: both chips, and theirs shifted off plum because
    // the owner chose it first — said in the chip's own tooltip.
    const people = await openPeople(visitor, tripName);
    const ownerRow = personRow(people, `dev-${owner}`);
    await expect(ownerRow).toContainText(OWNER_NAME);
    await expect(ownerRow.locator(".lucide-tent")).toHaveCount(1);
    const guestRow = personRow(people, `dev-${guest}`);
    await expect(guestRow).toContainText(GUEST_NAME);
    const guestChip = guestRow.locator("span:has(> .lucide-bike)");
    await expect(guestChip).toHaveCount(1);
    await expect(guestChip).toHaveAttribute(
      "title",
      new RegExp(`^${OWNER_NAME} chose plum first, so you're (?!plum)[a-z]+ on this trip\\.$`),
    );
  } finally {
    await context.close();
  }

  // 6. And the owner sees the guest arrive, with their glyph.
  await page.reload();
  const people = await openPeople(page, tripName);
  const guestRow = personRow(people, `dev-${guest}`);
  await expect(guestRow).toContainText(GUEST_NAME);
  await expect(guestRow.locator(".lucide-bike")).toHaveCount(1);
  await expect(personRow(people, `dev-${owner}`).locator(".lucide-tent")).toHaveCount(1);
});
