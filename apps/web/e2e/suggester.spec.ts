import { randomUUID } from "node:crypto";
import type { Browser, Page } from "@playwright/test";
import { expect, test } from "./fixtures/test";
import { grantCollaborators } from "./adminBootstrap";
import { createMappedTrip, dragCardTo, openHistory, openPlan } from "./helpers";
import { e2eTripName } from "./tripNames";
import { SUGGESTER_APPROVAL } from "../src/lib/tripRole";

// The suggester spec's §5 walk (docs/specs/2026-10-03-suggester-role-design.md):
// the owner invites someone as "Can suggest", they move a stop and send it,
// and the owner accepts it. Two real browser contexts, for the reason
// m11-invites.spec.ts gives — a role is only proven by a second person.
//
// `newcomer`, `signedInAs` and `inviteLinkFor` are m11-invites' own, cut down
// to the invite path this walk takes; that file keeps them local, and this one
// follows suit rather than reshaping a spec it does not own.

function newcomer(prefix: string): string {
  return `${prefix}${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

async function inviteLinkFor(page: Page, tripName: string, role: "Can suggest"): Promise<string> {
  await page.getByRole("button", { name: `${tripName} — Trip settings` }).click();
  await expect(page.getByRole("heading", { name: "Trip settings" })).toBeVisible();
  await page.getByRole("combobox", { name: "Invite role" }).selectOption({ label: role });
  await Promise.all([
    page.waitForResponse(
      (r) => /\/api\/trips\/[^/]+\/invites$/.test(new URL(r.url()).pathname) && r.request().method() === "POST",
    ),
    page.getByRole("button", { name: "Invite someone" }).click(),
  ]);
  // Off the row's `title`, not the clipboard — m11-invites says why.
  const copy = page.getByRole("button", { name: "Copy invite link" }).first();
  await expect(copy).toHaveAttribute("title", /\/invite\//);
  return (await copy.getAttribute("title"))!;
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

// Inviting needs the owner's `trip.collaborators` (M20 link 6; m11-invites).
test.beforeAll(async ({ browser }) => {
  await grantCollaborators(browser, "dev-alice");
});

test("a suggester's move waits for the owner, and Accept makes it", async ({ page, browser }) => {
  // Two contexts, two sign-ins, two page loads: the budget m11-invites gives.
  test.slow();
  const tripName = e2eTripName("Suggest");
  // Two days, each with a timed 09:00-10:00 stop, so a move between them is a
  // change of DAY — a same-day retime is only an update, drawn as a marker
  // with no ghost (W47).
  const tripId = await createMappedTrip(page, tripName, 2);
  const stop = "Stop on day 1";
  await page.goto(`/trips/${tripId}?view=Plan`);
  await expect(page.getByRole("heading", { name: tripName, level: 2 })).toBeVisible();
  const link = await inviteLinkFor(page, tripName, "Can suggest");

  const suggesterName = newcomer("sam");
  const sam = await signedInAs(browser, suggesterName, link);
  try {
    await sam.goto(link);
    // The one clause every invite surface reads (W64), so copy edits to it
    // are the clause's business, not this walk's.
    await expect(sam.getByText(`You can suggest stops and changes ${SUGGESTER_APPROVAL}.`)).toBeVisible();
    await sam.getByRole("button", { name: "Join the trip" }).click();
    await expect(sam.getByRole("heading", { name: tripName, level: 2 })).toBeVisible();
    await expect(sam.getByText("Suggester", { exact: true })).toBeVisible();
    await openPlan(sam);

    // Every command a suggester's board posts is a failure of this feature,
    // whether or not the server would have refused it — so count them all.
    const commands: string[] = [];
    sam.on("request", (r) => {
      if (r.method() === "POST" && /\/api\/trips\/[^/]+\/commands$/.test(new URL(r.url()).pathname)) commands.push(r.url());
    });

    const day1 = sam.getByTestId("day-column").nth(0);
    const day2 = sam.getByTestId("day-column").nth(1);
    await dragCardTo(day1.getByTestId(/activity-card-/).filter({ hasText: stop }), day2);
    // Their own board shows the move at once; the tray says it has not gone.
    await expect(day2.getByTestId(/activity-card-/).filter({ hasText: stop })).toBeVisible();
    const tray = sam.getByRole("region", { name: "Suggestion draft" });
    await expect(tray).toContainText("1 change not sent");

    await Promise.all([
      sam.waitForResponse(
        (r) => new URL(r.url()).pathname === `/api/trips/${tripId}/suggestions` && r.request().method() === "POST" && r.ok(),
      ),
      tray.getByRole("button", { name: "Send suggestion" }).click(),
    ]);
    await expect(tray).toHaveCount(0);
    expect(commands).toEqual([]);
  } finally {
    await sam.context().close();
  }

  // The owner's board, fresh: the stop has NOT moved — a suggestion is not
  // planning state until it is accepted (spec §2) — and the move is a ghost
  // where it would land, with the header's count beside it.
  await page.goto(`/trips/${tripId}?view=Plan`);
  const day1 = page.getByTestId("day-column").nth(0);
  const day2 = page.getByTestId("day-column").nth(1);
  await expect(day1.getByTestId(/activity-card-/).filter({ hasText: stop })).toBeVisible();
  await expect(day2.getByTestId(/activity-card-/).filter({ hasText: stop })).toHaveCount(0);
  const chip = page.getByRole("button", { name: "1 suggestion", exact: true });
  await expect(chip).toBeVisible();
  const ghost = day2.getByRole("button", { name: /^Suggested: / });
  await expect(ghost).toBeVisible();

  await ghost.click();
  await page.getByRole("button", { name: /^Accept: / }).click();

  await expect(day2.getByTestId(/activity-card-/).filter({ hasText: stop })).toBeVisible();
  await expect(day1.getByTestId(/activity-card-/).filter({ hasText: stop })).toHaveCount(0);
  await expect(chip).toHaveCount(0);
  await expect(day2.getByRole("button", { name: /^Suggested: / })).toHaveCount(0);

  // History says who asked for it, by name — not "Suggested" alone, and not
  // "a former traveler" (W49).
  await openHistory(page);
  await expect(page.getByText(`Suggested by ${suggesterName}`)).toBeVisible();

  // ...and says it beside the description rather than in place of it. On one
  // line, the attribution took the width and the row read `Moved "St…`
  // (PR #311's preview walk). jsdom has no layout, so this is measured here:
  // overflow on a `truncate` span is the ellipsis.
  const description = page
    .getByTestId("history-entry")
    .filter({ hasText: `Suggested by ${suggesterName}` })
    .getByTestId("history-entry-description");
  await expect(description).toContainText(stop);
  await expect.poll(() => description.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
});
