import type { Browser } from "@playwright/test";
import { E2E_SUPER_CODE } from "./admission";

// The one account this suite drives the operator console as (M20 link 7).
//
// A fixed username, deliberately, where every other identity in
// `m20-entitlements.spec.ts` is freshly minted per test. The fresh ones exist
// because M20 makes *"has this account ever held a trial"* a real question and
// a reused name would be new exactly once; the operator is the opposite case —
// what matters about it is that the server was configured to trust it, and
// being a returning account changes nothing about that.
//
// `dev-` prefixed because `users.id` is the Auth.js subject verbatim and the
// dev-login provider namespaces its subjects that way (ADR-025) — this string
// has to match the column, not the username typed into the form.
export const E2E_ADMIN_USERNAME = "m20operator";
export const E2E_ADMIN_USER_ID = `dev-${E2E_ADMIN_USERNAME}`;

/**
 * Give an account `trip.collaborators`, through the console's own grant
 * endpoint, as the configured operator.
 *
 * **Why any spec needs this since M20 link 6.** Inviting requires the trip
 * OWNER's `trip.collaborators`, and an account created by signing in holds
 * `free`. So `m11-invites.spec.ts`'s owner — alice, from the suite's shared
 * storage state — stopped being able to invite anybody, and its three tests
 * timed out waiting for an *Invite role* select that is correctly no longer
 * rendered. That is the gate working, not a regression, and the honest fix is
 * to make the owner an account that may collaborate.
 *
 * Through the shipped endpoint rather than a database write: the whole point of
 * link 7 is that this milestone is provable without Stripe, and a test-only
 * door would prove something else.
 */
export async function grantCollaborators(browser: Browser, userId: string): Promise<void> {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  try {
    const page = await context.newPage();
    await page.goto("/signup");
    await page.getByLabel("Invite code").fill(E2E_SUPER_CODE);
    // eslint-disable-next-line playwright/prefer-locator -- matches signInAsDevUser's grandfathered selector
    await page.fill('input[name="username"]', E2E_ADMIN_USERNAME);
    await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes("/api/trips") && r.request().method() === "GET" && r.ok(),
      ),
      page.getByRole("button", { name: /sign in with dev login/i }).click(),
    ]);
    const granted = await page.request.post("/api/admin/grants", {
      data: { userId, planId: "premium", expiresAt: null, reason: "e2e: this suite's owner invites." },
    });
    if (!granted.ok() && granted.status() !== 200) {
      throw new Error(`could not grant collaborators to ${userId}: ${granted.status()}`);
    }
  } finally {
    await context.close();
  }
}
