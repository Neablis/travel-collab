import { expect, test } from "./fixtures/test";

// M42's front door, walked by somebody with no account: the `/demo` picker,
// every demo trip it offers (D1), and the landing's prices (D3).
//
// The names and descriptions are written out rather than read from the
// bundles: this is what a visitor reads, and `server/demoTrip.test.ts` already
// holds the list to `content/trips/`. The descriptions are part 3's, over every
// activity with the backlog included (ADR-070 §3).
const DEMOS = [
  { slug: "japan", name: "Japan: Tokyo → Kyoto → Osaka", description: "Outdoors & sights", days: "14 days" },
  { slug: "dolomites-winter", name: "Dolomites: Cortina, Alta Badia and the Sellaronda", description: "Outdoors & drinks", days: "7 days" },
  {
    slug: "iceland-ring-road",
    name: "Iceland: Reykjavík, the South Coast, Jökulsárlón and the Golden Circle",
    description: "Outdoorsy",
    days: "8 days",
  },
  { slug: "northern-spain", name: "Northern Spain: San Sebastián → Bilbao → Picos → Santiago", description: "Food & drinks", days: "9 days" },
  { slug: "thailand-andaman", name: "Thailand: Bangkok → Krabi → Koh Lanta", description: "Food & beach", days: "10 days" },
];

test.describe("the front door, signed out (M42)", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("/demo offers every demo trip, each saying what kind of trip it is", async ({ page }) => {
    await page.goto("/demo");
    const cards = page.getByRole("list", { name: "Example trips" }).getByRole("listitem");
    await expect(cards).toHaveCount(DEMOS.length);
    for (const [i, demo] of DEMOS.entries()) {
      const card = cards.nth(i);
      // The description is the link's description, so it is heard with the name.
      const link = card.getByRole("link", { name: demo.name });
      await expect(link).toHaveAttribute("href", `/demo/${demo.slug}`);
      await expect(link).toHaveAccessibleDescription(demo.description);
      await expect(card).toContainText(demo.days);
    }

    await cards.nth(1).getByRole("link").click();
    await expect(page).toHaveURL(/\/demo\/dolomites-winter$/);
    await expect(page.getByRole("heading", { name: DEMOS[1]!.name })).toBeVisible();
  });

  for (const demo of DEMOS) {
    test(`/demo/${demo.slug} opens the real board, read-only`, async ({ page }) => {
      await page.goto(`/demo/${demo.slug}`);
      await expect(page.getByRole("heading", { name: demo.name })).toBeVisible();
      await expect(page.getByText("Viewer", { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Make this trip mine" })).toBeVisible();
      // A demo opens on Plan, where the planning is (Mitchell, 2026-10-11).
      await expect(page.getByRole("tab", { name: "Plan" })).toHaveAttribute("aria-selected", "true");
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", new RegExp(`/demo/${demo.slug}$`));
    });
  }

  // `/demo` was the Japan board until it became the picker, so a link into one
  // of its views still opens Japan at that view. A bare `/demo` is the picker.
  test("an old /demo link to a view opens Japan at that view", async ({ page }) => {
    await page.goto("/demo?view=Map");
    await expect(page).toHaveURL(/\/demo\/japan\?view=Map$/);
    await expect(page.getByRole("tab", { name: "Map" })).toHaveAttribute("aria-selected", "true");

    await page.goto("/demo?view=Overview");
    await expect(page).toHaveURL(/\/demo\/japan\?view=Overview$/);
    await expect(page.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");

    await page.goto("/demo?lens=Map");
    await expect(page).toHaveURL(/\/demo\/japan\?lens=Map$/);
  });

  test("a slug that is no demo is a 404", async ({ page }) => {
    const response = await page.goto("/demo/atlantis");
    expect(response?.status()).toBe(404);
  });

  test("the landing's Pricing link lands on the three plans", async ({ page }) => {
    await page.goto("/welcome");
    await page.getByRole("link", { name: "Pricing", exact: true }).click();
    await expect(page).toHaveURL(/#pricing$/);
    const pricing = page.getByRole("region", { name: "Pricing" });
    await expect(pricing).toBeInViewport();
    await expect(pricing.getByTestId("plan-summary")).toContainText(/Free.*\/ month.*\/ month/);
  });
});
