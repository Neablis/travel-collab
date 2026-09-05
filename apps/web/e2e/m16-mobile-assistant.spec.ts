import { expect, test } from "@playwright/test";
import { commandsFor } from "@tc/factories";
import { e2eTripName } from "./tripNames";

// KI-84 (PR #88 preview, Mitchell's own device: "the AI assistant on mobile
// breaks the entire website, it probably shouldn't be a modal but a full
// page experience"). Runs in the "phone" project (playwright.config.ts,
// 411×852 — his exact reported size), the same one-project-per-breakpoint
// pattern responsive.spec.ts already uses for "narrow". Below 768px the
// assistant rail stops being the 356px docked flex sibling
// responsive.spec.ts's own "docked contract" test pins at 1280px/1100px, and
// becomes a full-screen surface (`.assistant-rail`, globals.css) — the plan
// sits behind it rather than being crushed beside it.
test.describe("mobile assistant (phone viewport)", () => {
  // KI-2026-08-30, the launcher half of KI-84. KI-84 fixed what happens once
  // the rail is OPEN and said, in terms, that it did not touch the way you
  // open it: that stayed a `position: fixed` filled pill in the viewport's
  // bottom-right, which SPEC §13.5 forbids outright on a phone ("Nothing
  // floats over data. No floating action button."). The three tests below
  // would all still pass with the pill back — they click a button named
  // "Assistant" and never ask where it is — so this is the one that pins it.
  test("the launcher does not float over the plan: SPEC §13.5 allows no phone FAB", async ({ page }) => {
    const { tripId } = await page.request.post("/api/trips", { data: { name: e2eTripName("MobileRail") } }).then((r) => r.json());
    for (const command of commandsFor("threeDayTrip", tripId)) {
      await page.request.post(`/api/trips/${tripId}/commands`, { data: command });
    }
    await page.goto(`/trips/${tripId}`);

    const launcher = page.getByRole("button", { name: "Assistant", exact: true });
    await expect(launcher).toBeVisible();

    // The property, stated as the spec states it: this control is in normal
    // flow, so scrolling the plan cannot park it on top of a value. Asserting
    // "not fixed" rather than "static" leaves the in-flow presentation free to
    // change without this test having an opinion about how.
    const position = await launcher.evaluate((el) => getComputedStyle(el).position);
    expect(position).not.toBe("fixed");
    expect(position).not.toBe("absolute");

    // In flow AND still a real target: §13.1's 44px floor, the same one the
    // rail's own Hide button clears below.
    const box = await launcher.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);

    // And it still opens the rail — an entry point that satisfies §13.5 by
    // being unreachable would satisfy nothing.
    await launcher.click();
    await expect(page.getByRole("complementary", { name: "Assistant" })).toBeVisible();
  });

  test("the rail is full-screen, not crushed beside the plan, at a real phone width", async ({ page }) => {
    const { tripId } = await page.request.post("/api/trips", { data: { name: e2eTripName("MobileRail") } }).then((r) => r.json());
    for (const command of commandsFor("threeDayTrip", tripId)) {
      await page.request.post(`/api/trips/${tripId}/commands`, { data: command });
    }
    await page.goto(`/trips/${tripId}`);

    await page.getByRole("button", { name: "Assistant", exact: true }).click();
    const rail = page.getByRole("complementary", { name: "Assistant" });
    await expect(rail).toBeVisible();

    // Full-screen means the box IS the viewport — not "as wide as it can
    // manage", the actual 411×852 this project runs at.
    await expect.poll(() => rail.evaluate((el) => el.getBoundingClientRect().width)).toBe(411);
    await expect.poll(() => rail.evaluate((el) => el.getBoundingClientRect().height)).toBe(852);
    await expect.poll(() => rail.evaluate((el) => el.getBoundingClientRect().x)).toBe(0);
    await expect.poll(() => rail.evaluate((el) => el.getBoundingClientRect().y)).toBe(0);
    expect(await rail.evaluate((el) => getComputedStyle(el).position)).toBe("fixed");

    // Nothing bleeds through: TripHeader (`z-10`) and the unscheduled rack
    // (`z-20`, both already on this page for unrelated reasons) must not
    // out-rank the mobile rail the way TripHeader's own overflowing content
    // did at the crushed 356px-vs-viewport width this replaces.
    const railZ = await rail.evaluate((el) => Number(getComputedStyle(el).zIndex));
    expect(railZ).toBeGreaterThan(20);
    const centerHit = await page.evaluate(() => {
      const el = document.elementFromPoint(60, 70);
      return el?.closest('[aria-label="Assistant"]') !== null;
    });
    expect(centerHit).toBe(true);
  });

  test("the composer is clickable and typeable — the reported 'unselectable' input", async ({ page }) => {
    const { tripId } = await page.request.post("/api/trips", { data: { name: e2eTripName("MobileRail") } }).then((r) => r.json());
    for (const command of commandsFor("threeDayTrip", tripId)) {
      await page.request.post(`/api/trips/${tripId}/commands`, { data: command });
    }
    await page.goto(`/trips/${tripId}`);

    await page.getByRole("button", { name: "Assistant", exact: true }).click();
    await expect(page.getByRole("complementary", { name: "Assistant" })).toBeVisible();

    // A real click, deliberately — not `fill()` and not keyboard Enter. The
    // rack/Ask-button bug this file's `.unscheduled-rack` comment describes
    // survived until someone stopped submitting with Enter; asserting
    // existence alone would miss the same class of bug again.
    const input = page.getByPlaceholder(/Ask about this/);
    await input.click();
    await page.keyboard.type("is this selectable");
    await expect(input).toHaveValue("is this selectable");
  });

  test("Hide is the only way back to the plan, and clears the 44px target floor (SPEC §13.1)", async ({ page }) => {
    const { tripId } = await page.request.post("/api/trips", { data: { name: e2eTripName("MobileRail") } }).then((r) => r.json());
    for (const command of commandsFor("threeDayTrip", tripId)) {
      await page.request.post(`/api/trips/${tripId}/commands`, { data: command });
    }
    await page.goto(`/trips/${tripId}`);

    await page.getByRole("button", { name: "Assistant", exact: true }).click();
    const rail = page.getByRole("complementary", { name: "Assistant" });
    await expect(rail).toBeVisible();

    const hide = page.getByRole("button", { name: "Hide" });
    const box = await hide.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);

    await hide.click();
    await expect(rail).toBeHidden();
    // The plan is reachable again — not a modal that leaves something stuck.
    //
    // This used to assert the "Day columns" tab was selected. Two things in
    // SPEC §10/§16 retired that: the phone has two views, not four, so a bare
    // `/trips/<id>` is normalised off Board onto Timeline, and the lens strip
    // is hidden on a phone at all. The assertion's PURPOSE — the plan is not
    // left stuck behind a dismissed overlay — is kept, and is now made against
    // the controls a phone actually has: the day rail (§13.4, "the day rail
    // never collapses") and the tab bar, with Plan current.
    await expect(page.getByRole("group", { name: "Days" })).toBeVisible();
    await expect(page.getByRole("link", { name: /^Plan/ })).toHaveAttribute("aria-current", "page");
  });
});
