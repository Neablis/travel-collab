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

/** The Playbooks block's day, Mitchell's Hanoi playbook (`scripts/landing-day.json`). */
const PLAYBOOK = /^Hanoi in 4 days/;

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

  // Part 9: the feature blocks are the app's own river, Discover card and
  // notebook page, from the committed snapshots — server-rendered, so they
  // hydrate rather than swap in. A hydration mismatch shows up as React's
  // minified errors in a production build (418, 423, 425) or as an uncaught
  // page error, so both are listened for.
  test("the landing's feature blocks show the app itself, and hydrate cleanly", async ({ page }) => {
    const hydration: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error" && /hydrat|Minified React error #(418|423|425)/i.test(message.text())) {
        hydration.push(message.text());
      }
    });
    page.on("pageerror", (error) => hydration.push(error.message));
    await page.goto("/welcome");
    const landing = page.getByTestId("desktop-landing");
    await expect(
      landing.getByRole("region", { name: "The trip starts before the trip." }).getByRole("list", { name: "Day 7 timeline" }),
    ).toBeVisible();
    await expect(landing.getByRole("region", { name: "Relive someone’s perfect day." }).getByRole("link", { name: PLAYBOOK })).toBeVisible();
    await expect(landing.getByRole("region", { name: "How you’ll remember it." }).getByText("Check in at Gora Kadan")).toBeVisible();
    // Hydration has run once the hero's pills answer a click.
    await landing.getByRole("button", { name: "Day 7" }).click();
    await expect(landing.getByRole("button", { name: "Day 7" })).toHaveAttribute("aria-pressed", "true");
    expect(hydration).toEqual([]);
    // The Playbooks card's cover is Unsplash's CDN, not its API: nothing on
    // the landing asks Unsplash anything (`LandingScreen.test.tsx`'s fetch spy;
    // in a browser the CSP's `connect-src` would refuse it before a request).
    const cover = landing.getByRole("region", { name: "Relive someone’s perfect day." }).getByRole("img", { name: "a group of people walking down a train track" });
    expect(await cover.getAttribute("src")).toMatch(/^https:\/\/images\.unsplash\.com\//);
  });

  // The phone's claims are the same components, the Discover card in its
  // compact form so it fits a short phone (390×664): below the headline and
  // inside the pinned stage. The claims are stacked, so the ones the sequence
  // hides are `inert`: a tap on the card lands on the card, not on a faded
  // claim over it, and a hidden claim's links take no focus.
  test("the phone's Playbooks claim fits a short phone and its card takes the tap", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 664 });
    await page.goto("/welcome");
    const phone = page.getByTestId("phone-front-door");
    const title = phone.getByTestId("discover-card").getByRole("link", { name: PLAYBOOK });
    await expect(title).toBeVisible();

    const headline = await phone.getByRole("heading", { name: "Put the best day on repeat." }).boundingBox();
    const card = await phone.getByTestId("discover-card").boundingBox();
    expect(card!.y).toBeGreaterThan(headline!.y + headline!.height);
    expect(card!.y + card!.height).toBeLessThanOrEqual(664);

    const tapped = await title.evaluate((link) => {
      const r = link.getBoundingClientRect();
      return link.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
    });
    expect(tapped).toBe(true);

    // Halfway down the pin the Playbooks claim has faded out, and with it out
    // of the accessibility tree, so the link is held from before.
    const link = await title.elementHandle();
    await phone.evaluate((scroller) => {
      const pin = scroller.querySelector<HTMLElement>("[data-testid=front-door-pin]")!;
      scroller.scrollTop = 0.5 * (pin.offsetHeight - scroller.clientHeight);
    });
    await expect(phone.getByTestId("front-door-claim").first()).toHaveAttribute("aria-hidden", "true");
    const focused = await link!.evaluate((el: HTMLElement) => {
      el.focus();
      return document.activeElement === el;
    });
    expect(focused).toBe(false);
  });
});
