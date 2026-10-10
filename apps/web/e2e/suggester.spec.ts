import { randomUUID } from "node:crypto";
import type { Browser, Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures/test";
import { grantCollaborators } from "./adminBootstrap";
import { createMappedTrip, dragCardTo, openAssistantRail, openHistory, openPlan } from "./helpers";
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
  await page.getByRole("button", { name: "Invite", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Invite someone" });
  await dialog.getByRole("radiogroup", { name: "Role" }).getByRole("radio", { name: role }).click();
  await Promise.all([
    page.waitForResponse(
      (r) => /\/api\/trips\/[^/]+\/invites$/.test(new URL(r.url()).pathname) && r.request().method() === "POST",
    ),
    dialog.getByRole("button", { name: "Create invite" }).click(),
  ]);
  // Off the dialog's "Invite link" field, not the clipboard — m11-invites says why.
  await expect(dialog.getByRole("button", { name: "Copy invite link" })).toBeVisible();
  const field = dialog.getByRole("textbox", { name: "Invite link" });
  await expect(field).toHaveValue(/\/invite\//);
  const link = await field.inputValue();
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(dialog).toHaveCount(0);
  return link;
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
  const gelato = (day: Locator) => day.getByTestId(/activity-card-/).filter({ hasText: "Gelato" });
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
    await expect(sam.getByText("1 not sent", { exact: true })).toBeVisible();

    // W75 (Mitchell's production test, 2026-10-04): a stop added and then
    // moved read "2 changes not sent". The move joins the change that added
    // it. Timed, because a suggester's board draws no untimed stop (W71).
    await sam.getByRole("button", { name: "Add stop" }).click();
    await sam.getByLabel("What or where").fill("Gelato");
    await sam.getByLabel("Start", { exact: true }).fill("13:00");
    await sam.getByRole("button", { name: "Add stop" }).last().click();
    await expect(gelato(day1)).toBeVisible();
    // A placeholder until it is sent and accepted (W76; Mitchell's preview
    // comment, 2026-10-04), and it says so in words.
    await expect(gelato(day1).getByText("Not sent", { exact: true })).toBeVisible();
    await expect(tray).toContainText("2 changes not sent");
    await dragCardTo(gelato(day1), day2);
    await expect(gelato(day2)).toBeVisible();
    await expect(tray).toContainText("2 changes not sent");

    // Mitchell's production test, 2026-10-04 (W69): the tray sat in the page
    // flow under the header, so a suggester working further down the board
    // never saw it. It is the bottom bar now, on screen wherever they are.
    // The scroll is witnessed, or "in the viewport" would hold of a page that
    // never moved — and at the suite's 1280x900 this two-day board fits
    // without scrolling, so the window is a short laptop's.
    await sam.setViewportSize({ width: 1280, height: 540 });
    await sam.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect.poll(() => sam.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    await expect(tray).toBeInViewport({ ratio: 1 });
    // ...and on top. `toBeInViewport` ignores what is painted over the box, and
    // the old tray, scrolled under the sticky header, still passed it.
    const onTop = (box: Locator) => () =>
      box.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
      });
    await expect.poll(onTop(tray)).toBe(true);
    // A phone's bar sits on the tab bar, as the rack's does: each on top of
    // its own box, neither under the other.
    await sam.setViewportSize({ width: 390, height: 844 });
    const tabs = sam.getByRole("navigation", { name: "Phone navigation" });
    await expect(tabs).toBeVisible();
    await expect.poll(onTop(tray)).toBe(true);
    await expect.poll(onTop(tabs)).toBe(true);
    // ...one row of it, as W69 has it (the #314 preview walk measured two:
    // Send wrapped under the count, 115px of a phone's board).
    const send = tray.getByRole("button", { name: "Send suggestion" });
    const oneRow = async () => (await tray.boundingBox())!.height < 2 * (await send.boundingBox())!.height;
    await expect.poll(oneRow).toBe(true);

    // With the assistant docked, the bar stops short of the rail (`.assistant-open`
    // keeps 356px from 768px up), so at the bar's height its own right end is
    // the bar and the rail's left edge is the rail: neither paints over the
    // other (CodeRabbit on #314). Sampled at the bar's height because that is
    // the only place the two can meet.
    await sam.setViewportSize({ width: 1100, height: 900 });
    await openAssistantRail(sam);
    const rail = sam.getByRole("complementary", { name: "Assistant" });
    const sideBySide = () =>
      tray.evaluate((bar) => {
        const dock = document.querySelector('[aria-label="Assistant"]');
        if (!dock) return false;
        const b = bar.getBoundingClientRect();
        const y = b.top + b.height / 2;
        const atRail = document.elementFromPoint(dock.getBoundingClientRect().left + 2, y);
        return bar.contains(document.elementFromPoint(b.right - 2, y)) && dock.contains(atRail);
      });
    await expect.poll(sideBySide).toBe(true);
    await rail.getByRole("button", { name: "Hide" }).click();
    await expect(rail).toHaveCount(0);
    await sam.setViewportSize({ width: 1280, height: 900 });

    await Promise.all([
      sam.waitForResponse(
        (r) => new URL(r.url()).pathname === `/api/trips/${tripId}/suggestions` && r.request().method() === "POST" && r.ok(),
      ),
      tray.getByRole("button", { name: "Send suggestion" }).click(),
    ]);
    await expect(tray).toContainText("No changes yet");
    expect(commands).toEqual([]);
    // Empty, it is one row on a phone too.
    await sam.setViewportSize({ width: 390, height: 844 });
    await expect.poll(oneRow).toBe(true);
    await sam.setViewportSize({ width: 1280, height: 900 });
  } finally {
    await sam.context().close();
  }

  // The owner's board, NOT reloaded: it was open before the suggester joined,
  // and it hears about the suggestion on its own (W73; Mitchell's production
  // test, 2026-10-04, where it showed only after a reload). The stop has NOT
  // moved — a suggestion is not planning state until it is accepted (spec §2)
  // — and the move is a ghost where it would land, with the header's count.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const day1 = page.getByTestId("day-column").nth(0);
  const day2 = page.getByTestId("day-column").nth(1);
  const chip = page.getByRole("button", { name: "2 suggestions", exact: true });
  // One poll interval and the list read it triggers; a reload would be ~0.
  await expect(chip).toBeVisible({ timeout: 15_000 });
  // The chip opens on the first click the moment it appears (the #314
  // preview walk: aria-expanded stayed false, and it took a second click).
  await chip.click();
  await expect(chip).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Escape");
  await expect(chip).toHaveAttribute("aria-expanded", "false");
  await expect(day1.getByTestId(/activity-card-/).filter({ hasText: stop })).toBeVisible();
  await expect(day2.getByTestId(/activity-card-/).filter({ hasText: stop })).toHaveCount(0);
  const ghost = day2.getByRole("button", { name: /^Suggested: Moved/ });
  await expect(ghost).toBeVisible();
  await expect(ghost.getByText("Suggested", { exact: true })).toBeVisible();

  // Both changes at once (W77).
  await chip.click();
  await expect(chip).toHaveAttribute("aria-expanded", "true");
  await page.getByRole("button", { name: "Accept all" }).click();

  await expect(day2.getByTestId(/activity-card-/).filter({ hasText: stop })).toBeVisible();
  await expect(gelato(day2)).toBeVisible();
  await expect(day1.getByTestId(/activity-card-/).filter({ hasText: stop })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^\d+ suggestions?$/ })).toHaveCount(0);
  await expect(day2.getByRole("button", { name: /^Suggested: / })).toHaveCount(0);

  // One History entry for both, which says who asked for them, by name — not
  // "Suggested" alone, and not "a former traveler" (W49, M40 D1/D3).
  await openHistory(page);
  const entry = page.getByTestId("history-entry").filter({ hasText: `from ${suggesterName}` });
  await expect(entry).toHaveCount(1);
  const description = entry.getByTestId("history-entry-description");
  await expect(description).toHaveText("Accepted 2 suggestions");
  // One entry for the batch, not one per change, each with its own by-line.
  await expect(page.getByText(/^Suggested by /)).toHaveCount(0);
  // jsdom has no layout, so this is measured here: overflow on a `truncate`
  // span is the ellipsis (PR #311's preview walk read `Moved "St…`).
  await expect.poll(() => description.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
});

// Mitchell's walk, 2026-10-09: a suggested new day was never drawn, so what
// was added to it fell into the chip and what was moved onto it showed only
// where it was. Someone invited to suggest adds a day and two stops to it,
// through the board as anyone does; they and the owner both see the day, and
// accepting it makes it real.
test("a suggester's new day and its stops show as a suggested day, and Accept makes them real", async ({ page, browser }) => {
  test.slow();
  const tripName = e2eTripName("SuggestDay");
  const tripId = await createMappedTrip(page, tripName, 2);
  const stops = [
    { title: "Sunrise walk", start: "07:00" },
    { title: "Ramen lunch", start: "12:00" },
  ];
  // Timed, both: a suggester's board draws no untimed stop (W71), and neither
  // does a ghost day's river.
  const ghostOf = (where: Locator, title: string) => where.getByRole("button", { name: new RegExp(`^Suggested: .*${title}`) });
  const suggestedDay = (on: Page) => on.getByRole("region", { name: /^Day 3\b.* · suggested$/ });
  await page.goto(`/trips/${tripId}?view=Plan`);
  await expect(page.getByRole("heading", { name: tripName, level: 2 })).toBeVisible();
  const link = await inviteLinkFor(page, tripName, "Can suggest");

  const sam = await signedInAs(browser, newcomer("sam"), link);
  try {
    await sam.goto(link);
    await sam.getByRole("button", { name: "Join the trip" }).click();
    await expect(sam.getByText("Suggester", { exact: true })).toBeVisible();
    await openPlan(sam);

    await sam.getByRole("button", { name: "Add a day" }).click();
    const tray = sam.getByRole("region", { name: "Suggestion draft" });
    await expect(tray).toContainText("1 change not sent");
    for (const [i, stop] of stops.entries()) {
      await sam.getByRole("button", { name: "Add stop" }).click();
      await sam.getByLabel("What or where").fill(stop.title);
      // The third day: the one just added.
      await sam.getByLabel("Day", { exact: true }).selectOption({ index: 2 });
      await sam.getByLabel("Start", { exact: true }).fill(stop.start);
      await sam.getByRole("button", { name: "Add stop" }).last().click();
      await expect(tray).toContainText(`${i + 2} changes not sent`);
    }
    await Promise.all([
      sam.waitForResponse(
        (r) => new URL(r.url()).pathname === `/api/trips/${tripId}/suggestions` && r.request().method() === "POST" && r.ok(),
      ),
      tray.getByRole("button", { name: "Send suggestion" }).click(),
    ]);
    await expect(tray).toContainText("No changes yet");

    // Sent, the draft's real-looking Day 3 is gone and their own suggestion
    // is drawn as the owner will see it.
    await expect(sam.getByTestId("day-column")).toHaveCount(2);
    await expect(suggestedDay(sam)).toBeVisible();
    for (const stop of stops) await expect(ghostOf(suggestedDay(sam), stop.title)).toBeVisible();
  } finally {
    await sam.context().close();
  }

  await page.reload();
  const day3 = suggestedDay(page);
  await expect(day3).toBeVisible();
  for (const stop of stops) await expect(ghostOf(day3, stop.title)).toBeVisible();
  await expect(day3.getByRole("button", { name: /^Accept: / })).toBeVisible();
  await expect(day3.getByRole("button", { name: /^Dismiss: / })).toBeVisible();
  await expect(page.getByTestId("day-column")).toHaveCount(2);

  const chip = page.getByRole("button", { name: "3 suggestions", exact: true });
  await chip.click();
  await page.getByRole("button", { name: "Accept all" }).click();
  await expect(page.getByRole("button", { name: /^\d+ suggestions?$/ })).toHaveCount(0);
  await expect(day3).toHaveCount(0);
  const realDay3 = page.getByTestId("day-column").nth(2);
  for (const stop of stops) await expect(realDay3.getByTestId(/activity-card-/).filter({ hasText: stop.title })).toBeVisible();
  await expect(realDay3.getByRole("button", { name: /^Suggested: / })).toHaveCount(0);
});
