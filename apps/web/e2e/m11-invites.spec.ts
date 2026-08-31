import { randomUUID } from "node:crypto";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { E2E_SUPER_CODE } from "./admission";
import { createMappedTrip } from "./helpers";
import { e2eTripName } from "./tripNames";

// M11 link 3's exit-gate line: "An invited person can open the trip and modify
// it." Two real browser contexts, because that is the only way to prove it —
// alice owns the trip and hands out a link; bob follows it as himself.
//
// The link is read off the invite row's `title` attribute rather than the
// clipboard: reading the clipboard needs a permission grant that differs
// between headed and headless Chromium, and the app puts the same URL in both
// places precisely so a denied clipboard is never a dead end
// (TravelersPanel.tsx).
//
// Every test here is `test.slow()`. Not flake insurance: each one drives TWO
// browser contexts through a full sign-in and a page load apiece, which is
// genuinely about three times the work of a single-context spec and does not
// fit CI's 30s default. The first run of this file exhausted that budget
// mid-sign-in — a *budget* failure, and the honest fix for one of those is the
// budget, not a retry. The trip itself is created through the app's own
// command API (the `createMappedTrip` idiom in helpers.ts) rather than the
// new-trip wizard, because the wizard is m8's territory and re-walking it here
// is pure cost.

/**
 * A dev username the app has genuinely never seen.
 *
 * The three guests here used to be the fixed "bob", "carol" and "dan", which
 * was fine while sign-in was unconditional. M11a makes "has this person been
 * here before?" the whole question: against a persistent local database a
 * fixed name is new exactly once, and every run after the first would have
 * quietly admitted them as returning users and stopped exercising the invite
 * path this spec now exists to prove. Same fresh-identity-per-test convention
 * KI-69 already established for the integration suites, for the same reason.
 */
function newcomer(prefix: string): string {
  return `${prefix}${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

async function createTrip(page: Page, name: string): Promise<string> {
  const response = await page.request.post("/api/trips", { data: { name } });
  expect(response.ok()).toBe(true);
  const { tripId } = (await response.json()) as { tripId: string };
  await page.goto(`/trips/${tripId}`);
  await expect(page.getByRole("heading", { name, level: 2 })).toBeVisible();
  return tripId;
}

async function openTripSettings(page: Page, tripName: string): Promise<void> {
  await page.getByRole("button", { name: `${tripName} — Trip settings` }).click();
  await expect(page.getByRole("heading", { name: "Trip settings" })).toBeVisible();
}

async function inviteLinkFor(page: Page, role: "Can edit" | "Can view"): Promise<string> {
  await page.getByLabel("Invite role").selectOption({ label: role });
  await Promise.all([
    page.waitForResponse(
      (r) => /\/api\/trips\/[^/]+\/invites$/.test(new URL(r.url()).pathname) && r.request().method() === "POST",
    ),
    page.getByRole("button", { name: "Invite someone" }).click(),
  ]);
  // The accessible name is stable ("Copy invite link"); the visible label is
  // not — creating an invite copies it, so this row already reads "Copied".
  const copy = page.getByRole("button", { name: "Copy invite link" }).first();
  await expect(copy).toBeVisible();
  const link = await copy.getAttribute("title");
  expect(link).toBeTruthy();
  return link!;
}

/**
 * A second person, brand new to the app, in their own context.
 *
 * `storageState: undefined` is explicit rather than assumed: the "desktop"
 * project's `use` pins alice's saved session, and inheriting it here would
 * make this spec silently test alice inviting alice.
 *
 * **M11a turned this into the milestone's own evidence.** These three are
 * exactly the population the invite gate refuses — dev users with no `users`
 * row — so signing them in straight at `/signin` with nothing to present now
 * lands on the refusal screen. Rather than exempt them, they come in the way a
 * real invited collaborator does:
 *
 * `followInvite` opens `/invite/<token>` while signed out. `proxy.ts` banks
 * the token in the `pending_admission` cookie on the redirect to `/signin`,
 * and `recordSignIn` reads it back and admits them by link 2 — **with no code
 * typed anywhere**. That is the milestone's "M11's invite→accept→edit flow
 * still works end to end for a person who has never signed in" box, walked by
 * CI instead of by hand.
 *
 * It only works for someone holding a *pending* invite, which is why `dan`
 * (whose link is revoked before he ever sees it — that is the point of his
 * test) comes in on the super code instead. Link 2 would refuse him, correctly.
 */
async function signedInAs(
  browser: Browser,
  username: string,
  admission: { followInvite: string } | { superCode: true },
): Promise<Page> {
  const context = await browser.newContext({ storageState: undefined });
  const page = await context.newPage();

  if ("followInvite" in admission) {
    // The proxy redirects to /signin?callbackUrl=/invite/<token> and banks the
    // token on the way past, so this screen needs no code field at all.
    await page.goto(admission.followInvite);
    await expect(page).toHaveURL(/\/signin\?/);
  } else {
    // No pending invite to ride in on, so the super code it is — presented on
    // /signup, the only screen carrying the field.
    await page.goto("/signup");
    await page.getByLabel("Invite code").fill(E2E_SUPER_CODE);
  }

  await page.fill('input[name="username"]', username);
  await Promise.all([
    // Both front-door routes, not just `/signin`: the super-code path starts on
    // `/signup`, where a `/signin`-only predicate is already satisfied before
    // the click and would return a page that has not signed in yet.
    page.waitForURL((url) => !/^\/sign(in|up)$/.test(url.pathname)),
    page.getByRole("button", { name: /sign in with dev login/i }).click(),
  ]);
  return page;
}

test("an invited editor opens the trip and changes it; the owner sees them listed", async ({
  page,
  browser,
}) => {
  test.slow();
  // Distinct prefix from other specs' trip names — parallel workers share the
  // "alice" dev user's trip list (m1/m3/m6's comment).
  const tripName = e2eTripName("Invites");
  await createTrip(page, tripName);
  await openTripSettings(page, tripName);

  // Before any invite, the owner is the only traveller. Scoped to her own
  // row — asserting on the bare text "owner" would also match a pending
  // invite's role badge, so it could pass with no traveller listed at all.
  await expect(page.getByTestId("traveller-dev-alice")).toContainText("owner");
  await expect(page.getByTestId(/^traveller-/)).toHaveCount(1);

  const link = await inviteLinkFor(page, "Can edit");

  const bobName = newcomer("bob");
  const bob = await signedInAs(browser, bobName, { followInvite: link });
  try {
    await bob.goto(link);
    await expect(bob.getByRole("heading", { name: tripName, level: 1 })).toBeVisible();
    await expect(bob.getByText("You'll be able to change the plan.")).toBeVisible();
    await bob.getByRole("button", { name: "Join this trip" }).click();

    // Lands on the trip, editable, with no "View only" badge.
    await expect(bob.getByRole("heading", { name: tripName, level: 2 })).toBeVisible();
    await expect(bob.getByText("View only")).toHaveCount(0);

    // …and can actually change it. "Add a day" lives in the board's trailing
    // "One more day?" column (Board.tsx).
    await Promise.all([
      bob.waitForResponse(
        (r) =>
          /\/api\/trips\/[^/]+\/commands$/.test(new URL(r.url()).pathname) &&
          r.request().method() === "POST" &&
          r.ok(),
      ),
      bob.getByTestId("one-more-day-column").getByRole("button", { name: "Add a day" }).click(),
    ]);

    // The trip now appears in bob's own Home grid, alongside his own trips —
    // SPEC R4 deleted the "shared with you" label, so it simply appears.
    await bob.goto("/");
    await expect(bob.getByRole("link", { name: tripName })).toBeVisible();
  } finally {
    await bob.context().close();
  }

  // Back on alice's side: bob is a listed traveller with the role she gave
  // him — identity and role together, in his own row, so a regression in
  // membership listing fails here rather than being masked by the invite row.
  await page.reload();
  await openTripSettings(page, tripName);
  await expect(page.getByTestId(`traveller-dev-${bobName}`)).toContainText("editor");
  await expect(page.getByTestId("traveller-dev-alice")).toContainText("owner");
  await expect(page.getByTestId(/^traveller-/)).toHaveCount(2);
});

test("an invited viewer can read the trip but is told, and shown, that it is read-only", async ({
  page,
  browser,
}) => {
  test.slow();
  const tripName = e2eTripName("Viewer");
  // Seeded with a real day and a real stop, unlike the other tests here: the
  // point of this one is what a viewer can and cannot DO to existing content,
  // and an empty trip has no card to withhold a drag handle from. One day is
  // the smallest shape that carries both a day column and a stop; the same
  // command-API idiom the file already prefers to re-walking a wizard.
  const tripId = await createMappedTrip(page, tripName, 1);
  const stopTitle = "Stop on day 1";
  await page.goto(`/trips/${tripId}`);
  await expect(page.getByRole("heading", { name: tripName, level: 2 })).toBeVisible();
  await openTripSettings(page, tripName);
  const link = await inviteLinkFor(page, "Can view");

  const carol = await signedInAs(browser, newcomer("carol"), { followInvite: link });
  try {
    await carol.goto(link);
    await expect(carol.getByText("You'll be able to look, but not change anything.")).toBeVisible();
    await carol.getByRole("button", { name: "Join this trip" }).click();

    await expect(carol.getByRole("heading", { name: tripName, level: 2 })).toBeVisible();
    await expect(carol.getByText("View only")).toBeVisible();

    // The badge was the whole of this assertion until
    // docs/reviews/2026-08-28-m11-pr71-review.md §5: it passed while the board
    // underneath was fully live, so a viewer could drag a card (it moved and
    // snapped back), open the editor and type into it. Every write is refused
    // by the server regardless — this asserts the UI stops OFFERING them.

    // The plan itself is readable: gating hides affordances, never content.
    const card = carol.locator('[data-testid^="activity-card-"]');
    await expect(card).toHaveCount(1);
    await expect(card).toContainText(stopTitle);

    // pdnd's `draggable()` is what sets this attribute, so its absence is the
    // drag registration genuinely missing rather than a styling difference.
    await expect(card).not.toHaveAttribute("draggable", "true");

    // Nothing that would dispatch a command is on offer. Counted rather than
    // asserted "not visible": a locator that matches nothing is what we want,
    // and toHaveCount is strict-mode-safe where getBy* would throw on 0 or 2.
    await expect(carol.getByTestId("one-more-day-column")).toHaveCount(0);
    await expect(carol.getByRole("button", { name: "Add a day" })).toHaveCount(0);
    await expect(carol.getByRole("button", { name: /^Add activity to / })).toHaveCount(0);
    await expect(carol.getByRole("button", { name: /^Remove Day / })).toHaveCount(0);
    await expect(carol.getByRole("button", { name: `Remove ${stopTitle}` })).toHaveCount(0);
    await expect(carol.getByRole("button", { name: "Share" })).toHaveCount(0);
    // Counted, not `toBeDisabled()`, since KI-64: the header's "Add stop" is
    // withheld from a viewer like every other write control around it.
    await expect(carol.getByRole("button", { name: "Add stop" })).toHaveCount(0);

    // The card carries no way into the stop editor at all. This asserted a
    // relabelled "View" button until 2026-08-29: this branch had kept the
    // control and made the sheet present read-only, while ADR-031 — which
    // landed first — treats opening the editor as a write and withholds it
    // outright. ADR-031 won on merge, so the check is for absence, and BOTH
    // names are asserted: "Edit" alone would pass against the relabel this
    // spec used to describe.
    await expect(carol.getByRole("button", { name: `Edit ${stopTitle}` })).toHaveCount(0);
    await expect(carol.getByRole("button", { name: `View ${stopTitle}` })).toHaveCount(0);
    // Nothing opened it, so nothing to close — and the sheet's own read-only
    // presentation stays covered by ActivityEditorSheet.test.tsx, where it is
    // reachable, rather than being asserted through a door that is now shut.
    await expect(carol.getByRole("heading", { name: "Activity", level: 3 })).toHaveCount(0);
  } finally {
    await carol.context().close();
  }
});

test("a revoked link stops working", async ({ page, browser }) => {
  test.slow();
  const tripName = e2eTripName("Revoked");
  await createTrip(page, tripName);
  await openTripSettings(page, tripName);
  const link = await inviteLinkFor(page, "Can edit");

  await Promise.all([
    page.waitForResponse(
      (r) =>
        /\/api\/trips\/[^/]+\/invites\/[^/]+$/.test(new URL(r.url()).pathname) &&
        r.request().method() === "DELETE",
    ),
    page.getByRole("button", { name: "Revoke invite" }).first().click(),
  ]);

  const dan = await signedInAs(browser, newcomer("dan"), { superCode: true });
  try {
    await dan.goto(link);
    await expect(dan.getByText("This invite has been revoked.")).toBeVisible();
    await expect(dan.getByRole("button", { name: "Join this trip" })).toHaveCount(0);
  } finally {
    await dan.context().close();
  }
});
