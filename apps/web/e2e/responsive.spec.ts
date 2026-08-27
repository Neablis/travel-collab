import { expect, test } from "@playwright/test";
import { commandsFor } from "@tc/factories";

// KI-19: the whole suite used to run at exactly one viewport (Playwright's
// 1280x720 default, above the 1179px breakpoint), so a whole class of real
// defect — most famously KI-16, a full-page click sink below 1180px — was
// invisible to the gate. This spec runs in the "narrow" project
// (playwright.config.ts, 1100px) and is the gate condition Task 3.4 asks
// for: five assertions covering every breakpoint-dependent behavior the app
// actually has, rather than running all 15 specs twice to catch a narrow
// class of bug.
test.describe("responsive (narrow viewport)", () => {
  test("the assistant rail is in overlay mode and its scrim dismisses it (KI-16)", async ({ page }) => {
    const { tripId } = await page.request.post("/api/trips", { data: { name: `Responsive ${Date.now()}` } }).then((r) => r.json());
    for (const command of commandsFor("threeDayTrip", tripId)) {
      await page.request.post(`/api/trips/${tripId}/commands`, { data: command });
    }
    await page.goto(`/trips/${tripId}`);

    // useAssistantVisibility defaults open, then syncs to the media query on
    // mount — at <1180px that closes it almost immediately, so open it
    // explicitly rather than racing that effect.
    await page.getByRole("button", { name: "Assistant" }).click();
    const rail = page.getByRole("complementary", { name: "Assistant" });
    await expect(rail).toBeVisible();

    // The regression itself: an aria-hidden click-catcher with no handler
    // made every control on the page unreachable below 1180px. If the scrim
    // doesn't dismiss the rail, this is that bug again.
    await page.getByRole("button", { name: "Close the assistant" }).click();
    await expect(rail).toBeHidden();
  });

  test("the trip page is interactive: a view tab click changes the lens", async ({ page }) => {
    const { tripId } = await page.request.post("/api/trips", { data: { name: `Responsive ${Date.now()}` } }).then((r) => r.json());
    for (const command of commandsFor("threeDayTrip", tripId)) {
      await page.request.post(`/api/trips/${tripId}/commands`, { data: command });
    }
    await page.goto(`/trips/${tripId}`);

    await expect(page.getByRole("tab", { name: "Day columns", selected: true })).toBeVisible();
    await page.getByRole("tab", { name: "Timeline" }).click();
    await expect(page.getByRole("tab", { name: "Timeline", selected: true })).toBeVisible();
  });

  test("a sheet opens above the rail and its Close button is reachable (KI-17)", async ({ page }) => {
    const { tripId } = await page.request.post("/api/trips", { data: { name: `Responsive ${Date.now()}` } }).then((r) => r.json());
    for (const command of commandsFor("threeDayTrip", tripId)) {
      await page.request.post(`/api/trips/${tripId}/commands`, { data: command });
    }
    await page.goto(`/trips/${tripId}`);

    // Below 1180px the rail is a full-page-scrim overlay by design — while
    // it's open, the scrim intentionally blocks interaction with the rest
    // of the page (that's the point of the KI-16 fix, not a new bug). The
    // rail defaults closed at this width (useAssistantVisibility syncs to
    // the media query on mount), so it's already out of the way here; this
    // asserts the *other* stacking claim, KI-17 — that a sheet's Close
    // button is a real, reachable control rather than sitting under some
    // other fixed-position layer — still holds at a narrow viewport.
    await expect(page.getByRole("complementary", { name: "Assistant" })).toBeHidden();

    await page.getByRole("button", { name: "Trip settings" }).click();
    const closeButton = page.getByRole("button", { name: "Close" });
    await expect(closeButton).toBeVisible();
    await closeButton.click();
    await expect(closeButton).toBeHidden();
  });

  test("the Playbooks strip reflows to two columns below 1180px", async ({ page }) => {
    await page.goto("/");
    const columns = await page
      .locator(".playbooks-grid")
      .evaluate((el) => getComputedStyle(el).gridTemplateColumns.trim().split(/\s+/).length);
    expect(columns).toBe(2);
  });

  test("the hero collapses to a single column below 1024px", async ({ page }) => {
    // The narrow project's own 1100px is above the hero's 1024px breakpoint
    // (distinct from the rail/Playbooks strip's 1180px) — set it explicitly
    // for this one assertion rather than adding a whole second project.
    await page.setViewportSize({ width: 1000, height: 800 });
    await page.goto("/");
    const columns = await page
      .locator(".hero-grid")
      .evaluate((el) => getComputedStyle(el).gridTemplateColumns.trim().split(/\s+/).length);
    expect(columns).toBe(1);
  });
});

// The landing page is the one surface a signed-out phone actually reaches, and
// its feature grid is breakpoint-gated — the class of thing KI-19 says the
// 1280px default viewport will not exercise. Own describe, because the front
// door needs the signed-out state and the narrow project supplies alice's.
test.describe("responsive (narrow viewport, signed out)", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("the landing feature cards stack below 1024px and sit in a row above it", async ({ page }) => {
    const cardX = async () => {
      const boxes = await Promise.all(
        ["Together", "Notebook", "Playbooks"].map((eyebrow) =>
          page.getByText(eyebrow, { exact: true }).boundingBox(),
        ),
      );
      return boxes.map((b) => Math.round(b?.x ?? -1));
    };

    // 900px: one column. Asserted on the cards' own geometry rather than a
    // class name, so it fails on the thing a reader would actually see.
    await page.setViewportSize({ width: 900, height: 900 });
    await page.goto("/welcome");
    const stacked = await cardX();
    expect(new Set(stacked).size).toBe(1);

    // 1280px: three columns, each starting further right than the last. Below
    // the lg breakpoint the borrowed Day 2 card is ~51px wide and its stop rows
    // cannot render, which is why this grid is lg: and not md: (CodeRabbit, #58).
    await page.setViewportSize({ width: 1280, height: 900 });
    const row = await cardX();
    // Strictly left-to-right, asserted without indexing (the repo builds with
    // noUncheckedIndexedAccess, so row[0] is number | undefined).
    expect(new Set(row).size).toBe(3);
    expect(row).toEqual([...row].sort((a, b) => a - b));
  });
});
