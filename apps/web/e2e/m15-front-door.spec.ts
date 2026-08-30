import { expect, test } from "@playwright/test";
import { e2eTripName } from "./tripNames";

// The front door only exists for signed-out visitors, so this spec opts out
// of the shared storageState the "desktop" project supplies (same override
// smoke.spec.ts:7 uses).
test.use({ storageState: { cookies: [], origins: [] } });

test("landing → sign in → first trip → sign out", async ({ page }) => {
  const tripName = e2eTripName("Kyoto");

  // `/` bounces a signed-out visitor to the landing page.
  await page.goto("/");
  await expect(page).toHaveURL(/\/welcome$/);
  await expect(
    page.getByRole("heading", { name: "The trip everyone actually helped plan." }),
  ).toBeVisible();

  // SPEC §14's copy rules: "Early access" is the only footnote, and the old
  // free/open-source line is gone for good.
  await expect(page.getByText(/Early access/)).toBeVisible();
  await expect(page.getByText(/Free and open source/)).toHaveCount(0);

  // M11 link 4 built the real thing, so this is a link now, not a Preview
  // shell. Where it goes, and what it shows when no demo share is configured,
  // is m11-share.spec.ts's territory — here it only has to be on the page.
  await expect(page.getByRole("link", { name: "Look around a real trip" })).toBeVisible();

  // Our screen, not Auth.js's default page.
  await page.getByRole("link", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/signin$/);
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();

  // The swap link reaches sign-up and back.
  await page.getByRole("link", { name: "Create an account" }).click();
  await expect(page.getByRole("heading", { name: "Start planning with Caesura" })).toBeVisible();
  await page.getByRole("link", { name: "Sign in" }).click();

  // Both /signup and /signin render AuthScreen's dev-login form (same
  // `input[name="username"]`), and the client-side transition between them
  // swaps in a fresh AuthScreen instance whose username field is a
  // controlled `useState("")` — so filling immediately after the click above
  // can race a not-yet-settled navigation and land on a field that's about
  // to unmount, silently losing the typed value. Settling on the destination
  // heading first, filling through a locator (auto-waits for actionability),
  // and then asserting the value actually stuck closes that race and makes
  // any regression fail loudly here instead of at an unrelated assertion
  // 30+ seconds later.
  await expect(page).toHaveURL(/\/signin$/);
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  const username = page.getByLabel(/username/i);
  await username.fill("alice");
  await expect(username).toHaveValue("alice");

  await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes("/api/trips") && r.request().method() === "GET" && r.ok(),
    ),
    page.getByRole("button", { name: /sign in with dev login/i }).click(),
  ]);
  await expect(page.getByRole("heading", { name: "Your trips" })).toBeVisible();

  // A trip from a name alone — the capability that replaced the first-run screen.
  await page.getByRole("button", { name: "New trip" }).click();
  await page.getByLabel(/trip name/i).fill(tripName);
  await page.getByRole("button", { name: "Create empty" }).click();
  // `.first()`, not a bare `getByText`: a freshly created trip legitimately
  // renders twice on Home — once in NextTripHero and once as its TripCard —
  // so a bare locator matches two elements and Playwright's strict mode
  // throws. Seen flaking exactly that way on 2026-08-26, after every
  // redirect and auth assertion above had already passed. What this line
  // needs to prove is that the trip reached Home at all, which the first
  // match establishes.
  await expect(page.getByText(tripName).first()).toBeVisible();

  // And back out the front door.
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/welcome$/);
});

// Reported from the 2026-08-30 preview design pass: "Pressing enter should
// submit the Dev Login flow here." It already did — but only once React had
// hydrated. Before that the form was a plain `<form>` with no `action`, so
// Enter fired the browser's native implicit submission: a GET back to
// /signin that reloaded the page, emptied the controlled username input and
// pushed what had been typed into the address bar as `?username=…`. On a
// cold preview that gap is wide enough to hit by hand, and it reads as
// "Enter does nothing".
//
// Both halves are asserted, because fixing either one alone leaves the
// defect: Enter has to work after hydration, and it has to be *inert*
// before it rather than destroying what the user typed.
test("Enter submits the dev-login form once hydrated", async ({ page }) => {
  await page.goto("/signin");
  const username = page.getByLabel(/username/i);
  await username.fill("alice");
  await expect(username).toHaveValue("alice");

  // The submit button is hydration-gated, so waiting for it to be enabled is
  // waiting for the handler Enter depends on to exist.
  await expect(page.getByRole("button", { name: /sign in with dev login/i })).toBeEnabled();

  await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes("/api/trips") && r.request().method() === "GET" && r.ok(),
    ),
    username.press("Enter"),
  ]);
  await expect(page.getByRole("heading", { name: "Your trips" })).toBeVisible();
});

test.describe("before hydration", () => {
  // No JS at all is the honest stand-in for "JS has not run yet": it is the
  // same DOM, with the same handlers missing, and it cannot go green by
  // simply waiting — which is exactly the state a cold preview shows a fast
  // typist.
  test.use({ javaScriptEnabled: false });

  test("Enter does not reload /signin or leak the username into the URL", async ({ page }) => {
    await page.goto("/signin");
    const username = page.getByLabel(/username/i);
    await username.fill("alice");
    await username.press("Enter");

    // The pre-fix failure was a navigation to /signin?username=alice with an
    // emptied field; both assertions below failed on that build.
    await expect(page).toHaveURL(/\/signin$/);
    await expect(username).toHaveValue("alice");
  });
});
