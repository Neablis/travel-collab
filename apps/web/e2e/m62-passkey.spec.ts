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
});
