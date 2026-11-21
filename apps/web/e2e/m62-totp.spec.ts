import * as OTPAuth from "otpauth";
import { expect, test } from "./fixtures/test";
import { addVirtualAuthenticator, openAccountPage, signInAsDevUser } from "./helpers";

// **M62 part 3, walked end to end**: add an authenticator app beside a passkey,
// then sign in with a code the test computes from the secret the dialog showed,
// and see that code refused a second time.
//
// A fresh dev user, not the shared alice session: this account turns MFA on
// (same reasoning as `m62-passkey.spec.ts`).
test.use({ storageState: undefined });

/** What the person's app would show for `secret` at `at`: the test's own copy of RFC 6238. */
const codeAt = (secret: string, at: number) =>
  new OTPAuth.TOTP({ algorithm: "SHA1", digits: 6, period: 30, secret: OTPAuth.Secret.fromBase32(secret) }).generate({
    timestamp: at,
  });

test("authenticator app: enrol beside a passkey, sign in with a code", async ({ page }) => {
  const username = `m62t${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
  await signInAsDevUser(page, username);
  await addVirtualAuthenticator(page);

  // ---- the passkey comes first, as the first factor that turns it on ---------
  await openAccountPage(page, "security");
  const twoStep = page.getByRole("region", { name: "Two-step sign-in" });
  await twoStep.getByRole("button", { name: "Add a passkey" }).click();
  const sheet = page.getByRole("dialog", { name: "Save your recovery codes" });
  await sheet.getByRole("checkbox", { name: "I saved these" }).check();
  await sheet.getByRole("button", { name: "Done" }).click();
  await expect(twoStep.getByText("Recovery codes: 10 of 10 left")).toBeVisible();

  // ---- the authenticator app: scan or type the key, then confirm -------------
  await twoStep.getByRole("button", { name: "Add an authenticator app" }).click();
  const dialog = page.getByRole("dialog", { name: "Add an authenticator app" });
  await expect(dialog.getByRole("img", { name: "QR code for your authenticator app" })).toBeVisible();
  await dialog.getByRole("button", { name: "Can’t scan?" }).click();
  const secret = (await dialog.locator("code").innerText()).trim();
  expect(secret).toMatch(/^[A-Z2-7]{32}$/);

  // A wrong code is refused first and the dialog stays open.
  await dialog.getByRole("textbox", { name: "Authenticator code" }).fill("000000");
  await dialog.getByRole("button", { name: "Verify" }).click();
  await expect(dialog.getByRole("alert")).toContainText("That code did not work");

  await dialog.getByRole("textbox", { name: "Authenticator code" }).fill(codeAt(secret, Date.now()));
  await dialog.getByRole("textbox", { name: "Authenticator code" }).press("Enter");
  await expect(dialog).toBeHidden();
  await expect(twoStep.getByText("Authenticator app · never used")).toBeVisible();

  // ---- sign out; with no passkey to answer, the code is the way in -----------
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.disable");
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/$/);

  await page.goto("/signin?callbackUrl=%2Faccount%3Ftab%3Dsecurity");
  // eslint-disable-next-line playwright/prefer-locator -- KI-2026-09-02-b: the form's one field, as `signInAsDevUser` fills it
  await page.fill('input[name="username"]', username);
  await page.getByRole("button", { name: /sign in with dev login/i }).click();

  await page.getByRole("button", { name: "Use authenticator code" }).click();
  // The enrolment code already spent this 30-second step, so the sign-in uses the
  // next one; the server accepts a step either side of its own clock.
  const next = codeAt(secret, Date.now() + 30_000);
  await page.getByRole("textbox", { name: "Authenticator code" }).fill(next);
  await page.getByRole("textbox", { name: "Authenticator code" }).press("Enter");
  await expect(page).toHaveURL(/\/account\?tab=security/);
  await expect(page.getByRole("region", { name: "Two-step sign-in" }).getByText(/Authenticator app · used/)).toBeVisible();

  // ---- the same code, a second time, from a fresh sign-in: refused ----------
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/signin?callbackUrl=%2Faccount%3Ftab%3Dsecurity");
  // eslint-disable-next-line playwright/prefer-locator -- KI-2026-09-02-b: the form's one field, as `signInAsDevUser` fills it
  await page.fill('input[name="username"]', username);
  await page.getByRole("button", { name: /sign in with dev login/i }).click();
  await page.getByRole("button", { name: "Use authenticator code" }).click();
  await page.getByRole("textbox", { name: "Authenticator code" }).fill(next);
  await page.getByRole("textbox", { name: "Authenticator code" }).press("Enter");
  // That step is spent (`last_used_step` only moves forward), and the person stays on the verify screen.
  await expect(page.getByRole("alert").filter({ hasText: "That code did not work" })).toBeVisible();
  await expect(page).toHaveURL(/\/signin\/verify/);
});
