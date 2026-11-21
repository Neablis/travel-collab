import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures/test";
import { addVirtualAuthenticator, openAccountPage, signInAsDevUser } from "./helpers";

// **M62 part 5, the installed app's idle lock** (D3b, D16), with a virtual
// authenticator. A preview cannot be installed, so the spec makes the page an
// installed app the way iOS says so (`navigator.standalone`), turns the lock on,
// and stands in for the idle time by moving the last activity back: fifteen
// minutes cannot be waited out. The lock opens to the passkey, over an open
// dialog too, and Sign out works.
//
// A fresh dev user, not the shared alice session: this account turns MFA on
// (`m62-passkey.spec.ts` records why).
test.use({ storageState: undefined });

const lockScreen = (page: Page) => page.getByRole("dialog", { name: "Caesura is locked" });

async function walkAway(page: Page, minutes: number) {
  await page.evaluate((ms) => window.localStorage.setItem("caesura_last_active", String(Date.now() - ms)), minutes * 60_000);
  await page.goto("/home");
}

test("the installed app locks after its idle time, a passkey opens it, and Sign out works", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window.navigator, "standalone", { value: true, configurable: true }));
  const username = `m62l${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
  await signInAsDevUser(page, username);
  await addVirtualAuthenticator(page);

  // ---- a passkey, then the setting beside it ---------------------------------
  await openAccountPage(page, "security");
  const twoStep = page.getByRole("region", { name: "Two-step sign-in" });
  await twoStep.getByRole("button", { name: "Add a passkey" }).click();
  const sheet = page.getByRole("dialog", { name: "Save your recovery codes" });
  await sheet.getByRole("checkbox", { name: "I saved these" }).check();
  await sheet.getByRole("button", { name: "Done" }).click();
  await twoStep.getByRole("combobox", { name: "Lock after inactivity" }).selectOption({ label: "15 minutes" });

  // ---- it locks over an open dialog, without a relaunch, and Unlock still works -
  // A modal Radix dialog turns off pointer events on the body and traps focus,
  // so a lock drawn over one has to win both back. The dialog is still there after.
  await twoStep.getByRole("button", { name: "Turn off two-step sign-in" }).click();
  const confirmOff = page.getByRole("dialog", { name: "Turn off two-step sign-in?" });
  await expect(confirmOff).toBeVisible();
  await page.evaluate(() => {
    window.localStorage.setItem("caesura_last_active", String(Date.now() - 20 * 60_000));
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(lockScreen(page)).toBeVisible();
  await lockScreen(page).getByRole("button", { name: "Unlock with passkey" }).click();
  await expect(lockScreen(page)).toBeHidden();
  await expect(confirmOff).toBeVisible();
  await confirmOff.getByRole("button", { name: "Cancel" }).click();

  // ---- inside the idle time it stays open ------------------------------------
  await walkAway(page, 5);
  await expect(page.getByRole("heading", { name: "Your trips" })).toBeVisible();
  await expect(lockScreen(page)).toBeHidden();

  // ---- past it, the lock; the passkey opens it, and the session is the same ---
  await walkAway(page, 20);
  await expect(lockScreen(page)).toBeVisible();
  await lockScreen(page).getByRole("button", { name: "Unlock with passkey" }).click();
  await expect(lockScreen(page)).toBeHidden();
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.getByRole("heading", { name: "Your trips" })).toBeVisible();

  // ---- locked again, Sign out leaves for the landing --------------------------
  await walkAway(page, 20);
  await lockScreen(page).getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/$/);
});
