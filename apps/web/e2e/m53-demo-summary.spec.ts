import { expect, test } from "./fixtures/test";

// M53 part 2: every `/demo/<slug>` page is in the sitemap, so a reader
// without JavaScript (a crawler, or a visitor whose scripts never arrive)
// must still get the trip: its title as the page's one heading, then each
// day with its stops as text. The board replaces this summary once its
// client subtree mounts, so with JavaScript on this is only ever the first
// paint; with JavaScript off it is the whole page.
//
// The titles and day counts below are the demos' own committed summaries
// (`src/lib/demoTripSummaries.generated.json`, written by
// `scripts/landing-demo.ts` and drift-checked by `pnpm landing:verify`).
// They are repeated here on purpose: a test that read the same file the
// page renders could not catch the page rendering nothing at all.
const DEMOS = [
  { slug: "japan", title: "Japan: Tokyo → Kyoto → Osaka", dayCount: 14, firstStop: "Land at Haneda" },
  {
    slug: "dolomites-winter",
    title: "Dolomites: Cortina, Alta Badia and the Sellaronda",
    dayCount: 7,
    firstStop: "Flight into Venice Marco Polo",
  },
  {
    slug: "iceland-ring-road",
    title: "Iceland: Reykjavík, the South Coast, Jökulsárlón and the Golden Circle",
    dayCount: 8,
    firstStop: "Land at Keflavík",
  },
  {
    slug: "northern-spain",
    title: "Northern Spain: San Sebastián → Bilbao → Picos → Santiago",
    dayCount: 9,
    firstStop: "Flight into Bilbao (BIO)",
  },
  {
    slug: "thailand-andaman",
    title: "Thailand: Bangkok → Krabi → Koh Lanta",
    dayCount: 10,
    firstStop: "Long-haul lands at Suvarnabhumi",
  },
] as const;

test.describe("demo trips without JavaScript", () => {
  // No JS at all is the honest stand-in for a crawler: the server HTML is
  // everything the page can say, and the test cannot go green by waiting
  // for the board the way a JS-on test could.
  test.use({ javaScriptEnabled: false });
  // A genuinely signed-out browser context, as in `m11-demo.spec.ts`: a
  // demo that only works for people who already have an account is no demo.
  test.use({ storageState: { cookies: [], origins: [] } });

  for (const demo of DEMOS) {
    test(`/${demo.slug} answers HTML with one h1 and every day's name`, async ({ page }) => {
      await page.goto(`/demo/${demo.slug}`);

      // One level-1 heading, and it is the trip's title: the page keeps
      // the one-h1 rule even when the board never mounts.
      const h1 = page.getByRole("heading", { level: 1 });
      await expect(h1).toHaveCount(1);
      await expect(h1).toHaveText(demo.title);

      // Every day's name, in order. Exact matching, because "Day 1" is a
      // substring of "Day 11" and a loose match would pass on Day 11 alone.
      for (let day = 1; day <= demo.dayCount; day += 1) {
        await expect(page.getByRole("heading", { name: `Day ${day}`, exact: true })).toBeVisible();
      }

      // The stops are text too, not just the day names.
      await expect(page.getByText(demo.firstStop).first()).toBeVisible();

      // The old fallback line is gone: it is what a crawler used to get
      // instead of all of the above.
      await expect(page.getByText("Opening the example trip…")).toHaveCount(0);
    });
  }
});
