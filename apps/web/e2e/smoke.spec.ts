import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { E2E_SUPER_CODE } from "./admission";
import { e2eTripName } from "./tripNames";

// This is the one spec that still covers the front door end to end from the
// landing page — every other spec runs pre-authenticated via the
// "desktop"/"narrow" projects' shared storageState (Task 3.1). Override it
// here so this test starts genuinely signed out.
//
// M11a moved the walk from `/signin` to `/signup`: a brand-new account is
// what this test signs in as, and that is now the screen a brand-new account
// belongs on (it is the one carrying the invite-code field). `/signin`'s own
// dev-login form stays covered by m11a-invite-gate.spec.ts, for the person it
// is actually for — someone who already has a `users` row and needs no code.
test.use({ storageState: { cookies: [], origins: [] } });

test("sign in, create a trip, see it in the list", async ({ page }) => {
  const tripName = e2eTripName("Rome");
  // A username the app has never seen, so the gate genuinely asks for the code
  // filled in below. This used to be the literal "alice", who already has a
  // `users` row from `auth.setup.ts` — she takes the returning-user path,
  // `recordSignIn` admits her before any credential is read, and the super-code
  // fill was therefore dead. The comment above claimed a brand-new account
  // while the code signed in a returning one: the invariant-without-a-test
  // class this repo names in KI-1 and KI-14. Caught in review on PR #99.
  const username = `smoke${randomUUID().replace(/-/g, "").slice(0, 12)}`;

  await page.goto("/");
  // `/signup`, not `/signin`: M11a's gate refuses anyone with no `users` row
  // and no credential, and the invite-code field the credential goes in exists
  // on the signup screen only. `.first()` because the landing page repeats
  // this CTA in the header and the closing band — same link, three places.
  await page.getByRole("link", { name: "Start a trip" }).first().click();

  // The invite gate (M11a). Dev login goes through admission like every other
  // way in — the build plan's decision 3 — so the code is presented here
  // before the sign-in dispatch, which is what puts it in the
  // `pending_admission` cookie the gate reads on the way back.
  await page.getByLabel("Invite code").fill(E2E_SUPER_CODE);

  // Dev Login credentials form.
  await page.fill('input[name="username"]', username);

  // Wait for the post-sign-in page's first authenticated /api/trips fetch to
  // resolve — that fetch only fires after React hydrates, so it's a reliable
  // signal the form's onSubmit handler is attached (avoids racing a native
  // form GET submit against hydration).
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes("/api/trips") && r.request().method() === "GET" && r.ok(),
    ),
    page.getByRole("button", { name: /sign in with dev login/i }).click(),
  ]);

  await expect(page.getByRole("heading", { name: "Your trips" })).toBeVisible();
  await page.getByRole("button", { name: "New trip" }).click();
  await page.getByLabel("Trip name").fill(tripName);
  await page.getByRole("button", { name: "Create empty" }).click();

  await expect(page.getByRole("heading", { name: tripName, level: 3 })).toBeVisible();
});
