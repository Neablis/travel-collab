import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { accountPanel, openAccountPage } from "./helpers";
import { E2E_SUPER_CODE } from "./admission";

// **M21's `plans` route, walked by a person** (SPEC §29, M21 link 5).
//
// **What this lane can prove and what it deliberately cannot.** There are no
// Stripe keys in CI and there never will be — the milestone's own reason for
// being split off M20 is that *"Stripe brings an external service that cannot
// be driven from `test:e2e:ci-like`"*. So nothing here buys anything.
//
// That leaves a real and specific question this lane is the ONLY place that can
// answer: **on a deployment where nothing can be bought, does the route still
// tell the truth?** §29's own rule for the unavailable case is *"show the held
// plan and a warning, and do not offer a CTA that opens a checkout that cannot
// succeed"*, and the way that rule gets broken is a button that looks live and
// fails on click. Every deployment that has ever run this suite is in exactly
// that state, so it is the state worth walking.
//
// It also walks the two things §29 cares most about being right, neither of
// which needs a payment: **each plan enumerates its own contents** rather than
// referring to another's, and **a `—` is an absence rather than a judgement.**
// A pricing page is where *a plan is a set, not a rank* dies quietly, and a
// browser is where anyone would notice.
//
// **The paid halves are the gate walk's**, against a Stripe test-mode key on a
// preview. `docs/milestones/M21-subscriptions-and-billing.md` carries the list.

function newcomer(prefix: string): string {
  return `${prefix}${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

/** Sign in as a brand-new dev account, without the suite's shared state. */
async function signInAs(page: Page, username: string): Promise<void> {
  await page.goto("/signup");
  await page.getByLabel("Invite code").fill(E2E_SUPER_CODE);
  // eslint-disable-next-line playwright/prefer-locator -- matches signInAsDevUser's grandfathered selector
  await page.fill('input[name="username"]', username);
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes("/api/trips") && r.request().method() === "GET" && r.ok(),
    ),
    page.getByRole("button", { name: /sign in with dev login/i }).click(),
  ]);
  await expect(page.getByRole("heading", { name: "Your trips" })).toBeVisible();
}

test.use({ storageState: { cookies: [], origins: [] } });

test.describe("M21 — what each plan is for, and what it costs", () => {
  test.slow();

  test("every plan states its own price and its own contents", async ({ page }) => {
    await signInAs(page, newcomer("m21plans"));
    await page.goto("/plans");

    await expect(page.getByTestId("plan-cards")).toBeVisible();
    // The decided prices (Mitchell, 2026-09-13), read off the screen rather
    // than off the wire — `$9` and `$19` reaching a person is the whole of
    // what link 2 bought.
    await expect(page.getByTestId("plan-card-plus")).toContainText("$9");
    await expect(page.getByTestId("plan-card-premium")).toContainText("$19");
    await expect(page.getByTestId("plan-card-free")).toContainText("Free");

    // **Never "everything in Plus"** — each card enumerates what IT grants.
    // This is M20's most load-bearing rule meeting the one surface where a
    // buyer is actively looking for a ladder.
    for (const plan of ["free", "plus", "premium"]) {
      await expect(page.getByTestId(`plan-card-${plan}`)).not.toContainText(/everything in/i);
    }
    await expect(page.getByTestId("plan-card-premium")).toContainText("200 questions");
  });

  test("the comparison marks an absence with a dash, never with a judgement", async ({ page }) => {
    await signInAs(page, newcomer("m21table"));
    await page.goto("/plans");

    const table = page.getByTestId("plan-comparison");
    await expect(table).toBeVisible();
    await expect(table).toContainText("—");
    // No cell says "not included in your plan" and nothing draws a cross. The
    // only comparison on this page is the one the reader makes.
    await expect(table).not.toContainText(/not included/i);
    await expect(table).not.toContainText("✗");
  });

  test("a deployment that cannot sell says so instead of offering a dead button", async ({ page }) => {
    // Every run of this suite is a deployment with no Stripe keys, which is
    // exactly the state §29 writes a rule for.
    await signInAs(page, newcomer("m21nostripe"));
    await page.goto("/plans");

    await expect(page.getByTestId("plans-unavailable")).toBeVisible();
    // The CTA is present and inert rather than absent: the plans are real and
    // what they grant is accurate, which is what the banner says. What must not
    // happen is a live-looking button that fails on click.
    await expect(page.getByTestId("plan-choose-plus")).toBeDisabled();
    await expect(page.getByTestId("plan-choose-premium")).toBeDisabled();
  });

  test("the held plan is stated once, and its own card cannot be bought again", async ({ page }) => {
    await signInAs(page, newcomer("m21held"));
    await page.goto("/plans");

    // **A new account is on its free week**, which is the state every account
    // starts in and the one a browser walk found this line handling worst: it
    // read *"You are on free — Free week, free."* The line now says what the
    // week is and when it ends, and says nothing about proration — there is
    // nothing to prorate against a plan that costs nothing.
    const held = page.getByTestId("plans-held-line");
    await expect(held).toContainText("free week");
    await expect(held).not.toContainText("prorated");
    // And the grant note, because the `free` card below says "No assistant"
    // while this account has 50 questions a day. Both are true; a person
    // cannot tell that from the screen unless it is said.
    await expect(page.getByTestId("plans-grant-note")).toContainText("as published");

    await expect(page.getByTestId("plan-choose-free")).toBeDisabled();
    await expect(page.getByTestId("plan-choose-free")).toContainText("What you hold");
  });

  test("returning from Stripe waits for the webhook instead of announcing success", async ({ page }) => {
    await signInAs(page, newcomer("m21return"));
    // **A redirect is a hint, never a grant** (M21 link 4). This is the forged
    // success redirect the exit gate asks about, driven the way an attacker
    // would: type the URL. Nothing is granted and nothing claims to be.
    await page.goto("/plans?checkout=cs_test_forged_by_hand");

    await expect(page.getByTestId("plans-pending")).toBeVisible();
    await expect(page.getByTestId("plans-result")).toBeHidden();
    // **And it does not claim a payment happened.** This URL was typed; no
    // payment exists. The screen said *"Your payment has gone through"* until a
    // browser walk read it — on a deployment whose banner four inches above
    // says nothing can be bought.
    await expect(page.getByTestId("plans-pending")).not.toContainText(/payment has gone through/i);
    // A way out, rather than a page titled Plans showing no plans.
    await expect(page.getByTestId("plans-pending-back")).toBeVisible();
    // And the account is unchanged behind it.
    const plan = await page.request.get("/api/account/plan");
    expect(plan.ok(), await plan.text()).toBe(true);
    const { plan: view } = (await plan.json()) as { plan: { planVersionRef: string } };
    expect(view.planVersionRef).toBe("free@v1");
  });

  // **This was scoped to `role="dialog"` and therefore FAILED rather than
  // drifted** when M26 link 1 turned account settings into a route (SPEC
  // §34.4). That is the good outcome: a spec scoped to a container that stops
  // existing is a spec that tells you, where one scoped to the page would have
  // kept passing against whatever happened to be on it.
  //
  // The round trip is the point, and it is longer now: Change plan reaches
  // `/plans`, and Plans' back link returns to the tab it came from (§34.4,
  // link 1e). A sheet could not have a back link, so this half is new.
  test("the account page sends Change plan here, and Plans comes back to the tab", async ({ page }) => {
    await signInAs(page, newcomer("m21sheet"));
    await openAccountPage(page, "plan");

    const link = accountPanel(page).getByTestId("plan-change-link");
    await expect(link).toBeVisible();
    await link.click();
    await expect(page.getByTestId("plans-screen")).toBeVisible();

    await page.getByTestId("plans-back-link").click();
    await expect(page.getByRole("heading", { name: "Account", level: 1 })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Plan & usage" })).toHaveAttribute("aria-selected", "true");
  });
});
