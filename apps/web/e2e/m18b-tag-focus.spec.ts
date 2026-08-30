import { expect, test, type Locator, type Page } from "@playwright/test";

// M18b — SPEC §11's tag focus, walked end to end on `/demo`.
//
// `/demo` rather than a seeded trip, for three reasons this milestone cares
// about: it needs no database, it renders the canonical Japan fixture (which
// carries 33 `meal`, 4 `lodging`, 11 `outdoors` and 8 `ticketed` tags — ADR-030),
// and it is signed-out and read-only, which is exactly the surface where the
// "focus is a view state, not a command" decision has to hold. Every write
// affordance on this page is gone (ADR-031); the chips are not, and that is
// deliberate.
//
// Day 1 is the worked example throughout: four Tokyo stops, of which "Dinner at
// Gonpachi" and "Nightcap at Bar Trench" carry `meal`, "Check in at Trunk
// Hotel" carries `lodging` and "Land at Haneda" carries no tag at all.
test.describe("tag focus", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  /** The day-column card for a stop, by its title. */
  function card(page: Page, title: string): Locator {
    return page.locator('[data-testid^="activity-card-"]').filter({ hasText: title }).first();
  }

  /** The timeline row for a stop, by its title. */
  function row(page: Page, title: string): Locator {
    return page.locator('[data-testid^="timeline-item-"]').filter({ hasText: title }).first();
  }

  /**
   * The opacity a browser actually computed, not the class we hoped for.
   *
   * M18's own gate is the reason this reads the computed style rather than
   * asserting a class name: its headline Calendar rule passed nine unit tests
   * and was still wrong, because the tests shared the implementation's
   * assumptions. A number the engine produced cannot.
   */
  async function opacityOf(locator: Locator): Promise<number> {
    return Number(await locator.evaluate((el) => getComputedStyle(el).opacity));
  }

  /**
   * The same read, polled until it settles.
   *
   * Focus fades over a 150ms transition, so a single read taken right after a
   * click catches the animation mid-flight — this walk saw 0.77, then 0.45,
   * then 0.37 on successive runs of the same assertion. A value that MOVES
   * between runs is a timeout, not a defect (AGENTS.md's own discriminator),
   * and the fix is to wait for the settled value rather than to delete the
   * transition.
   */
  async function expectOpacity(locator: Locator, expected: number): Promise<void> {
    await expect
      .poll(async () => opacityOf(locator), { timeout: 5_000 })
      .toBeCloseTo(expected, 2);
  }

  test("a chip focuses its tag, dims everything else, and survives every lens", async ({ page }) => {
    await page.goto("/demo");
    await expect(page.getByRole("heading", { name: "Japan: Tokyo → Kyoto → Osaka" })).toBeVisible();
    await expect(page.getByText("View only")).toBeVisible();

    const gonpachi = card(page, "Dinner at Gonpachi");
    const haneda = card(page, "Land at Haneda");
    const hotel = card(page, "Check in at Trunk Hotel");
    await expect(gonpachi).toBeVisible();

    // Nothing is focused yet: no line beside the tabs, every stop full strength.
    await expect(page.getByTestId("tag-focus-line")).toHaveCount(0);
    await expectOpacity(haneda, 1);

    // --- Click the chip -------------------------------------------------
    const mealChip = gonpachi.getByTestId("tag-chip-meal");
    await expect(mealChip).toHaveAttribute("title", "Dim everything that is not meal");
    await mealChip.click();

    await expect(mealChip).toHaveAttribute("aria-pressed", "true");
    await expect(mealChip).toHaveAttribute("title", "Stop focusing on meal");

    // The line beside the view tabs names it and offers Clear.
    const focusLine = page.getByTestId("tag-focus-line");
    await expect(focusLine).toBeVisible();
    await expect(focusLine.getByText("Meal")).toBeVisible();
    // The Clear control's own name, distinct from the chips' `Stop focusing
    // on meal` — 34 chips carry that hint on this fixture, so the two must not
    // collide (they did, and this walk is what found it).
    await expect(page.getByRole("button", { name: "Clear meal focus" })).toBeVisible();

    // Dim, never hide: the untagged and wrong-tagged stops go faint and stay
    // on the page, in place, with all their content.
    await expect(gonpachi).not.toHaveAttribute("data-off-tag", "true");
    await expect(haneda).toHaveAttribute("data-off-tag", "true");
    await expectOpacity(gonpachi, 1);
    await expectOpacity(haneda, 0.32);
    await expectOpacity(hotel, 0.32);
    await expect(haneda).toBeVisible();
    await expect(page.getByText("Land at Haneda").first()).toBeVisible();

    // Only one tag is ever focused — the lodging chip on the hotel card is not
    // pressed, and it is still clickable on a dimmed card.
    await expect(hotel.getByTestId("tag-chip-lodging")).toHaveAttribute("aria-pressed", "false");

    // --- It survives a lens switch --------------------------------------
    await page.getByRole("tab", { name: "Timeline" }).click();
    await expect(page).toHaveURL(/view=Timeline/);
    await expect(page.getByTestId("tag-focus-line")).toBeVisible();

    const hanedaRow = row(page, "Land at Haneda");
    const gonpachiRow = row(page, "Dinner at Gonpachi");
    await expect(hanedaRow).toBeVisible();
    await expectOpacity(gonpachiRow, 1);
    await expectOpacity(hanedaRow, 0.32);

    // --- The Calendar counts rather than dimming stops -------------------
    await page.getByRole("tab", { name: "Calendar" }).click();
    await expect(page).toHaveURL(/view=Calendar/);
    // Day 1 is four Tokyo stops, two of them `meal`. The count is in the
    // cell's accessible name as well as on the card, because the cell is a
    // button whose aria-label REPLACES its content.
    await expect(page.getByLabel(/^Day 1, .*Tokyo, 4 stops,.*2 of 4 match/)).toBeVisible();
    await expect(page.getByTestId("calendar-tag-match").first()).toBeVisible();

    // --- The Map keeps its own day dimming ------------------------------
    await page.getByRole("tab", { name: "Map" }).click();
    await expect(page).toHaveURL(/lens=Map/);
    await expect(page.getByTestId("tag-focus-line")).toBeVisible();

    // --- Clear ----------------------------------------------------------
    await page.getByRole("tab", { name: "Day columns" }).click();
    await page.getByRole("button", { name: "Clear meal focus" }).click();
    await expect(page.getByTestId("tag-focus-line")).toHaveCount(0);
    await expectOpacity(card(page, "Land at Haneda"), 1);
  });

  test("clicking the same chip again clears, and a different chip replaces", async ({ page }) => {
    await page.goto("/demo");
    const gonpachi = card(page, "Dinner at Gonpachi");
    const hotel = card(page, "Check in at Trunk Hotel");
    await expect(gonpachi).toBeVisible();

    await gonpachi.getByTestId("tag-chip-meal").click();
    await expect(page.getByTestId("tag-focus-line")).toBeVisible();

    // Same chip again: cleared.
    await gonpachi.getByTestId("tag-chip-meal").click();
    await expect(page.getByTestId("tag-focus-line")).toHaveCount(0);
    await expect(gonpachi.getByTestId("tag-chip-meal")).toHaveAttribute("aria-pressed", "false");

    // A different chip REPLACES rather than joining — single focus, one tag at
    // a time. `meal` goes back to unpressed and the Gonpachi card, which
    // carries no `lodging`, dims.
    await gonpachi.getByTestId("tag-chip-meal").click();
    await hotel.getByTestId("tag-chip-lodging").click();
    await expect(hotel.getByTestId("tag-chip-lodging")).toHaveAttribute("aria-pressed", "true");
    await expect(gonpachi.getByTestId("tag-chip-meal")).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByTestId("tag-focus-line").getByText("Lodging")).toBeVisible();
    await expectOpacity(gonpachi, 0.32);
  });

  // M18b's sixth exit-gate box, asserted against the running page rather than
  // against our own components: the filter row this replaced is gone and stays
  // gone (KI-47), and nothing here offers multi-select.
  test("offers no filter row, no Show everything, and no multi-select", async ({ page }) => {
    await page.goto("/demo");
    const gonpachi = card(page, "Dinner at Gonpachi");
    await expect(gonpachi).toBeVisible();
    await gonpachi.getByTestId("tag-chip-meal").click();

    const line = page.getByTestId("tag-focus-line");
    await expect(line).toBeVisible();
    // Exactly one control in the focus chrome: Clear.
    await expect(line.getByRole("button")).toHaveCount(1);
    await expect(page.getByText(/show everything/i)).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^filter/i })).toHaveCount(0);
  });
});
