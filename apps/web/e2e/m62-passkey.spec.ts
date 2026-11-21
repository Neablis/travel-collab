import { expect, test } from "./fixtures/test";
import { addVirtualAuthenticator, openAccountPage, signInAsDevUser } from "./helpers";

// **M62 part 2, walked end to end with a virtual authenticator**: turn two-step
// sign-in on with a passkey, sign out, and find the passkey prompt waiting
// behind Google (here, dev login) before any app page opens, then rename it.
//
// A fresh dev user, not the shared alice session: this account turns MFA on,
// and every other spec that borrows alice's storage state must never meet a
// verify screen. Same reasoning `m22-api-tokens.spec.ts` records.
test.use({ storageState: undefined });

test("passkey: register, sign out, sign in through verify, rename", async ({ page }) => {
  const username = `m62${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
  await signInAsDevUser(page, username);
  await addVirtualAuthenticator(page);

  // ---- off: one line and one button ----------------------------------------
  await openAccountPage(page, "security");
  const twoStep = page.getByRole("region", { name: "Two-step sign-in" });
  await expect(twoStep.getByText("Add a second step after Google")).toBeVisible();
  await twoStep.getByRole("button", { name: "Add a passkey" }).click();

  // ---- the first factor turns it on and shows the codes, once ---------------
  const sheet = page.getByRole("dialog", { name: "Save your recovery codes" });
  await expect(sheet.getByRole("listitem")).toHaveCount(10);
  const done = sheet.getByRole("button", { name: "Done" });
  await expect(done).toBeDisabled();
  await sheet.getByRole("checkbox", { name: "I saved these" }).check();
  await done.click();
  await expect(sheet).toBeHidden();
  await expect(twoStep.getByText("Device passkey")).toBeVisible();
  await expect(twoStep.getByText("Passkey · never used")).toBeVisible();

  // ---- sign out, and the way back in goes through verify --------------------
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/$/);

  await page.goto("/signin?callbackUrl=%2Faccount%3Ftab%3Dsecurity");
  // eslint-disable-next-line playwright/prefer-locator -- KI-2026-09-02-b: the form's one field, as `signInAsDevUser` fills it
  await page.fill('input[name="username"]', username);
  await page.getByRole("button", { name: /sign in with dev login/i }).click();

  // The passkey prompt is already up, and the virtual authenticator answers it,
  // so the person is taken on to where they were going.
  await expect(page).toHaveURL(/\/account\?tab=security/);
  await expect(page.getByRole("region", { name: "Two-step sign-in" }).getByText(/Passkey · used/)).toBeVisible();

  // ---- rename ---------------------------------------------------------------
  await page.getByRole("button", { name: "Rename Device passkey" }).click();
  const name = page.getByRole("textbox", { name: "Factor name" });
  await name.fill("Work laptop");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("region", { name: "Two-step sign-in" }).getByText("Work laptop")).toBeVisible();
  // Focus goes back to the row's Rename button rather than to the page's start.
  await expect(page.getByRole("button", { name: "Rename Work laptop" })).toBeFocused();

  // ---- the fresh check ------------------------------------------------------
  // Ten minutes cannot be waited out, so the server's first two answers to
  // adding are the 403 it gives an old check. The dialog, its Close, and the
  // real passkey check behind it are the subject; the authenticator then
  // refuses to hold the same credential twice, which is the end of the road.
  let refused = 0;
  await page.route("**/api/account/mfa/passkeys", async (route) => {
    const step = (route.request().postDataJSON() as { step?: string } | null)?.step;
    if (step === "options" && refused < 2) {
      refused += 1;
      await route.fulfill({ status: 403, json: { error: "fresh-check-required" } });
    } else await route.continue();
  });
  const twoStepNow = page.getByRole("region", { name: "Two-step sign-in" });
  await twoStepNow.getByRole("button", { name: "Add a passkey" }).click();
  const check = page.getByRole("dialog", { name: "Confirm it’s you" });
  await expect(check).toBeVisible();
  await expect(check).toHaveAccessibleDescription(/needs your passkey first/);
  await check.getByRole("button", { name: "Close" }).click();
  await expect(check).toBeHidden();

  await twoStepNow.getByRole("button", { name: "Add a passkey" }).click();
  await page.getByRole("dialog", { name: "Confirm it’s you" }).getByRole("button", { name: "Use a passkey" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(twoStepNow.getByRole("alert")).toHaveText("That passkey is already on this account.");
});

// **A cookie the server refuses, because the account's security epoch moved.**
// Two browsers are the same person; the second turns two-step sign-in on, which
// bumps the epoch, and the first is left holding a cookie the proxy reads as
// signed in and the server does not. It must end signed out, with the cookie and
// the landing's hint gone and the page it asked for kept, not bounce between the
// landing and sign-in (`api/session-expired`).
test("a session cookie refused after another browser turned two-step on is shed, and the landing stays put", async ({
  page,
  browser,
}) => {
  const username = `m62s${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
  await signInAsDevUser(page, username);

  const other = await (await browser.newContext()).newPage();
  await signInAsDevUser(other, username);
  await addVirtualAuthenticator(other);
  await openAccountPage(other, "security");
  await other.getByRole("region", { name: "Two-step sign-in" }).getByRole("button", { name: "Add a passkey" }).click();
  await expect(other.getByRole("dialog", { name: "Save your recovery codes" })).toBeVisible();

  const context = page.context();
  // The hint the app shell had set, so the landing would send this browser to /home.
  await context.addCookies([{ name: "tc_signed_in", value: "1", url: page.url() }]);
  await page.goto("/plans?checkout=cs_test_1");
  await expect(page).toHaveURL(/\/signin\?callbackUrl=%2Fplans%3Fcheckout%3Dcs_test_1$/);

  const names = (await context.cookies()).map((cookie) => cookie.name);
  expect(names.filter((name) => /session-token/.test(name))).toEqual([]);
  expect(names).not.toContain("tc_signed_in");

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Plan the trip together." })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
});
