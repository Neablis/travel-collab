import { expect, test } from "@playwright/test";
import { openAccountPage, signInAsDevUser } from "./helpers";
import { e2eTripName } from "./tripNames";

// **M26 Wave 2, link 16 — the phone lane stops being two specs.**
//
// Before this, `playwright.config.ts`'s `phone` project (411×852) ran exactly
// `m16-mobile-assistant` and `m14-mobile-notebook`. Nothing else was
// phone-tested: not the trips list, not Playbooks, not Plans, not account, not
// the shared day. The `narrow` project sits at 1100px — *above* KI-046's band by
// construction — so the whole band the wave is about had no coverage at all.
//
// **This file holds exactly the claims the unit layer could not**, and it is
// worth saying why rather than leaving it to look like duplication: each one
// below is a class swap or a rendered size, jsdom has neither layout nor media
// queries, and the repo's lint wall refuses `className` assertions outside
// `components/ui/**`. It refused three of these during the wave. They are real
// claims; this is simply the only layer that can hold them.
//
// **It deliberately does not touch Plan.** Link 13's surface question is open —
// whether a phone gets a real Plan treatment or §10 is amended — and a test
// written over a state everyone agrees is temporary is a test that has to be
// argued with later. That exclusion is the Wave 2 gate's own instruction.

test.describe("the phone's account screen", () => {
  // SPEC §34.3: account is a TASK, so it takes the whole frame and the tab bar
  // steps aside. The bar is `position: fixed` and would otherwise sit over the
  // foot of a screen somebody is trying to finish something on.
  test("is a task: no tab bar, a way back to Trips, and sign out on it", async ({ page }) => {
    await page.goto("/");
    // The bar is present on Trips, which is what makes its absence below a
    // measurement rather than an assumption.
    await expect(page.getByRole("navigation", { name: "Phone navigation" })).toBeVisible();

    await openAccountPage(page);

    await expect(page.getByRole("navigation", { name: "Phone navigation" })).toBeHidden();
    // §34.4's "Sign out sits below [the tabs]" is about THIS screen — a phone
    // has no avatar popover to hold it (link 1's recorded decision).
    await expect(page.getByTestId("account-sign-out")).toBeVisible();
    // And the way out, without which the only one left is the browser's own
    // gesture — on the surface that just removed the app's navigation.
    await expect(page.getByTestId("account-done")).toBeVisible();

    await page.getByTestId("account-done").click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("navigation", { name: "Phone navigation" })).toBeVisible();
  });

  // SPEC §13.1, "44px targets, always", and KI-046's 191-of-211. Measured as a
  // rendered box, which is the only honest form of this claim.
  test("puts its tabs on the 44px floor", async ({ page }) => {
    // `openAccountPage` opens the avatar menu, so the page has to BE somewhere
    // first — without this the test starts at `about:blank` and spends its
    // timeout waiting for a header that was never rendered.
    await page.goto("/");
    await openAccountPage(page);
    for (const name of ["Profile", "Plan & usage", "API tokens"]) {
      const box = await page.getByRole("tab", { name }).boundingBox();
      expect(box, `${name} has no box`).not.toBeNull();
      expect(box!.height, `${name} is ${box!.height}px tall`).toBeGreaterThanOrEqual(44);
    }
  });

  // Each tab is a URL (`?tab=`), which is what makes the back button walk them.
  test("walks its tabs with the back button", async ({ page }) => {
    await page.goto("/");
    await openAccountPage(page, "tokens");
    await expect(page).toHaveURL(/tab=tokens/);
    await page.goBack();
    await expect(page.getByRole("tab", { name: "Profile" })).toHaveAttribute("aria-selected", "true");
  });
});

test.describe("Plans on a phone", () => {
  // §34.3 gives this route a `‹ Account` header and no bar. The build rendered
  // one over it, and §34.3's claim that a phone CTA landed on a "blank screen"
  // was never true of this build — the cards stack and the table scrolls.
  test("has a way back and no tab bar, and its cards are reachable", async ({ page }) => {
    await page.goto("/plans");
    await expect(page.getByTestId("plans-screen")).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Phone navigation" })).toBeHidden();

    const back = page.getByTestId("plans-back-link");
    await expect(back).toBeVisible();
    const box = await back.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);

    // The comparison table scrolls rather than overflowing the page — this is
    // the half of §34.3 the build already had right, pinned so a later change
    // cannot quietly make the page scroll sideways instead.
    const sideways = await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
    );
    expect(sideways, "the page itself must not scroll sideways").toBe(true);

    await back.click();
    await expect(page.getByRole("tab", { name: "Plan & usage" })).toHaveAttribute("aria-selected", "true");
  });
});

test.describe("Playbooks on a phone", () => {
  // §16 asks for one filter sheet rather than a stack of popovers (project rule
  // 3), holding filters AND sort, with scope deliberately outside it.
  test("puts every filter in one sheet and leaves scope out of it", async ({ page }) => {
    await page.goto("/playbooks");
    await expect(page.getByTestId("discover-phone-filters")).toBeVisible();
    // The desktop chip row is not on this surface at all.
    await expect(page.getByTestId("filter-chip-budget")).toBeHidden();

    await page.getByTestId("discover-phone-filters").click();
    const sheet = page.getByTestId("discover-filter-sheet");
    await expect(sheet).toBeVisible();
    await expect(sheet.getByTestId("sheet-length-two-three")).toBeVisible();
    await expect(sheet.getByTestId("sheet-sort-newest")).toBeVisible();
    // A place is not a sheet setting.
    await expect(sheet.getByText("Everyone", { exact: true })).toBeHidden();

    await page.keyboard.press("Escape");
    // Scope is still a tab, outside the sheet, visible without opening anything.
    await expect(page.getByRole("tab", { name: "Saved" })).toBeVisible();
  });

  test("does not scroll sideways at 411px", async ({ page }) => {
    await page.goto("/playbooks");
    await expect(page.getByTestId("discover-phone-filters")).toBeVisible();
    const sideways = await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
    );
    expect(sideways).toBe(true);
  });
});

test.describe("new trip on a phone", () => {
  // §32.2: the conversation owns the whole frame. Measured as a box against the
  // viewport, because "full screen" is exactly the kind of claim jsdom cannot
  // make — the lint wall refused it at the unit layer, correctly.
  test("owns the whole frame, over the tab bar", async ({ page }) => {
    const username = `m26p${Date.now().toString(36)}`;
    await signInAsDevUser(page, username);
    // A trip first: the New trip SHEET is gated on already having one — first
    // run is the inline conversation (§32.1), which is a different surface.
    const made = await page.request.post("/api/trips", { data: { name: e2eTripName("M26Phone") } });
    expect(made.ok()).toBe(true);
    await page.goto("/");

    await page.getByRole("button", { name: "New trip" }).click();
    const dialog = page.getByRole("dialog", { name: "New trip" });
    await expect(dialog).toBeVisible();

    const box = await dialog.boundingBox();
    const viewport = page.viewportSize()!;
    // Full frame: the sheet spans the width rather than sitting in a rail.
    expect(box!.width).toBeGreaterThanOrEqual(viewport.width - 1);

    // And the tab bar is behind it — the sheet's overlay layer is z-60 over the
    // bar's z-20, so this needed no suppression rule and must not grow one.
    await expect(page.getByRole("navigation", { name: "Phone navigation" })).toBeHidden();
  });
});

// **Trip settings, and both of these are Mitchell's own words on the preview**
// (Vercel Toolbar, PR #196, 2026-09-20, Android at 411px). They live here
// rather than at the unit layer for this file's stated reason: one is a
// rendered width and the other is the absence of prose beside a control, and
// the lint wall refused the class assertion for the first — correctly, because
// a column split is geometry and geometry is measured in a browser.
test.describe("trip settings on a phone", () => {
  async function openTripSettings(page: import("@playwright/test").Page, name: string) {
    const made = await page.request.post("/api/trips", { data: { name } });
    expect(made.ok(), `create -> ${made.status()}`).toBe(true);
    const { tripId } = (await made.json()) as { tripId: string };
    await page.goto(`/trips/${tripId}`);
    // The trip title IS the Trip settings trigger, and its accessible name is
    // `<trip name> — Trip settings`. Matched on the suffix rather than
    // `new RegExp(name)`: `e2eTripName` returns `[e2e] …`, so interpolating it
    // into a pattern turns the prefix into a CHARACTER CLASS and the regex
    // matches a single `e` or `2` instead of the literal title. This page has
    // exactly one trip, so the suffix alone is unambiguous.
    await page.getByRole("button", { name: /— Trip settings$/ }).click();
    await expect(page.getByRole("dialog", { name: "Trip settings" })).toBeVisible();
  }

  // *"in the trip settings, make the currency type 'USD' box the same size as
  // the input for how much is the budget"*. It was `1fr 130px`, so on a 411px
  // phone the currency box was visibly the smaller of the two.
  test("gives the budget and the currency equal widths", async ({ page }) => {
    const username = `m26s${Date.now().toString(36)}`;
    await signInAsDevUser(page, username);
    await openTripSettings(page, e2eTripName("M26Settings"));

    const budget = await page.getByLabel("Total for the trip").boundingBox();
    const currency = await page.getByLabel("Currency", { exact: true }).boundingBox();
    expect(budget).not.toBeNull();
    expect(currency).not.toBeNull();
    // Equal to the pixel, not merely "close": they are two cells of one grid,
    // so anything other than equality means the split is still hand-computed.
    // A 1px tolerance for sub-pixel rounding and nothing more.
    expect(Math.abs(budget!.width - currency!.width)).toBeLessThanOrEqual(1);
  });

  // *"drop all the extra text for download a trip, and just have button at
  // bottom that says 'Download Trip'"* — reversing link 6d's heading and its
  // history sentence. Held here as well as at the unit layer because this is
  // the phone frame the comment was made on.
  test("offers Download Trip as one button, with no prose around it", async ({ page }) => {
    const username = `m26d${Date.now().toString(36)}`;
    await signInAsDevUser(page, username);
    await openTripSettings(page, e2eTripName("M26Download"));

    const sheet = page.getByRole("dialog", { name: "Trip settings" });
    await expect(sheet.getByRole("link", { name: "Download Trip" })).toBeVisible();
    await expect(sheet.getByText(/take it with you/i)).toHaveCount(0);
    await expect(sheet.getByText(/history does not travel/i)).toHaveCount(0);
  });
});
