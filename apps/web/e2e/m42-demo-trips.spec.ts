import AxeBuilder from "@axe-core/playwright";
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

/** The phone's Playbooks claim, Mitchell's Hanoi playbook (`scripts/landing-day.json`). */
const PLAYBOOK = /^Hanoi in 4 days/;

/** The sea's first moment's banner, the Rome playbook `scripts/landing-demo.ts` names in `content/playbooks/`. */
const BANNER = /^3 days in Rome: emperors, gladiators/;

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
    await page.goto("/");
    await page.getByRole("link", { name: "Pricing", exact: true }).click();
    await expect(page).toHaveURL(/#pricing$/);
    const pricing = page.getByRole("region", { name: "Pricing" });
    await expect(pricing).toBeInViewport();
    await expect(pricing.getByTestId("plan-summary")).toContainText(/Free.*\/ month.*\/ month/);
  });

  // M51: the sea's moments are the app's own Discover card, river and
  // notebook page, from the committed snapshots — server-rendered, so they
  // hydrate rather than swap in. A hydration mismatch shows up as React's
  // minified errors in a production build (418, 423, 425) or as an uncaught
  // page error, so both are listened for.
  test("the sea's moments show the app itself, and hydrate cleanly", async ({ page }) => {
    const hydration: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error" && /hydrat|Minified React error #(418|423|425)/i.test(message.text())) {
        hydration.push(message.text());
      }
    });
    page.on("pageerror", (error) => hydration.push(error.message));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    const landing = page.getByTestId("desktop-landing");
    // Hydrated before `hydration` is read: only the sea's scroll listener,
    // attached by an effect, ever moves `--sea-dim` off its authored 0.
    await page.evaluate(() => window.scrollTo(0, window.innerHeight));
    await expect
      .poll(() => landing.getByTestId("sea-scrim").evaluate((scrim: HTMLElement) => scrim.style.getPropertyValue("--sea-dim")))
      .not.toBe("0");
    await expect(landing.getByRole("region", { name: "Find a day worth borrowing." }).getByRole("link", { name: BANNER }).first()).toBeVisible();
    await expect(landing.getByRole("region", { name: "Everyone going, one plan." }).getByRole("list", { name: "Day 2 timeline" })).toBeVisible();
    // The day's stop, not the words that name it too (M50 part 9).
    await expect(
      landing.getByRole("region", { name: "Keep the notebook afterwards." }).getByRole("listitem").filter({ hasText: "Check in at Gora Kadan" }),
    ).toBeVisible();
    expect(hydration).toEqual([]);
  });

  // Decision 10: a linked cell is a door to its day's canonical page, with
  // nothing after the path (ADR-063's cache serves only a query-less one), and
  // the Japan cells, whose days exist only in the dev fixtures, open nothing.
  // An accent opens its country, city or tag page (Mitchell's third walk).
  // The e2e database imports no `content/`, so a click would open a 404 and
  // prove nothing: the door is asserted by where it goes. The background's
  // doors are out of the accessibility tree, so they are read as anchors.
  test("every sea cell opens its day's canonical page, and the Japan cells none", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    const sea = page.getByTestId("desktop-landing").getByTestId("landing-sea");
    // The Japan days are lit around the notebook, in cells of their own.
    const kyoto = sea.locator('[data-lit-for="sea-notebook"]').filter({ has: page.getByRole("heading", { name: "Kyoto temples on foot" }) });
    await kyoto.scrollIntoViewIfNeeded();
    await expect(kyoto).toBeVisible();
    await expect(sea.getByRole("link", { name: "Kyoto temples on foot" })).toHaveCount(0);

    const hrefs = (await sea.locator("a").evaluateAll((links) => links.map((link) => link.getAttribute("href") ?? "")))
      .filter((href) => href.startsWith("/playbooks/"));
    expect(hrefs.length).toBeGreaterThan(48);
    for (const href of hrefs) expect(href).toMatch(/^\/playbooks\/(day|country|city|tag)\/[a-z0-9-]+$/);
    // By test id: an accent is background, out of the accessibility tree.
    const accents = await sea.getByTestId("sea-accent").locator("a").evaluateAll((links) => links.map((link) => link.getAttribute("href")));
    expect(accents.length).toBeGreaterThan(0);
    for (const href of accents) expect(href).toMatch(/^\/playbooks\/(country|city|tag)\/[a-z0-9-]+$/);
  });

  // The sea's grid decides every cell's size, and what a cell holds fills it
  // (Mitchell's walk of PR 510): a moment's panel, its river, its notebook
  // page and the pricing are drawn whole inside the cell they are given, with
  // nothing clipped at a foot, at the gate's widths. `sr-only` is clipped by
  // design and is not looked at. The notebook's page is the one exception
  // (Mitchell's third walk: *"dont be afraid to make it too long, but clip it
  // at bottom so it fades out at the real edge"*): it runs on past its cell
  // and fades out at the cell's own foot, which the cell keeps.
  for (const [width, height, cols] of [
    [1440, 900, 8],
    [3440, 1440, 19],
  ] as const) {
    test(`every story cell holds what it shows at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto("/");
      const sea = page.getByTestId("desktop-landing").getByTestId("landing-sea");
      // Packed for this width: the server's HTML is packed for six columns.
      await expect(sea.getByTestId("sea-grid")).toHaveAttribute("data-cols", String(cols));
      await expect(sea.getByRole("region", { name: "Everyone going, one plan." }).getByRole("list", { name: "Day 2 timeline" })).toBeAttached();
      await expect(sea.getByTestId("notebook-page")).toBeAttached();
      const stories = sea.getByTestId("sea-story");
      await expect(stories).toHaveCount(6);
      const clipped = await stories.evaluateAll((cells) =>
        cells.flatMap((cell) =>
          [cell, ...cell.querySelectorAll<HTMLElement>("*")]
            .filter((el) => !el.classList.contains("sr-only") && getComputedStyle(el).overflowY !== "visible")
            .filter((el) => !el.closest(".landing-sea-fade"))
            .filter((el) => el.scrollHeight - el.clientHeight > 1)
            .map((el) => `${cell.getAttribute("aria-labelledby") ?? cell.textContent!.slice(0, 24)}: ${el.tagName} ${el.scrollHeight - el.clientHeight}px`),
        ),
      );
      expect(clipped).toEqual([]);
      const notebook = await sea.getByTestId("notebook-page").evaluate((page) => {
        // The panel, which fills the cell and carries the rise.
        const cell = page.closest("[data-rise]")!.getBoundingClientRect();
        return {
          overflows: page.scrollHeight - page.clientHeight > 100,
          masked: getComputedStyle(page).maskImage.startsWith("linear-gradient"),
          atTheFoot: Math.abs(page.getBoundingClientRect().bottom - cell.bottom) <= 1,
        };
      });
      expect(notebook).toEqual({ overflows: true, masked: true, atTheFoot: true });
    });
  }

  // A lit day is a tab stop, so it must be drawn whole: one cut off by a
  // clipping box would take focus out of sight and scroll that box out of
  // place. At 1440, and at 1100, where the grid is six columns. The count
  // comes first: the walk proves nothing if no lit cell is a door. The big
  // banner card, then the Italian, Thai and Greek days lit around the moments
  // (Japan's open nothing).
  for (const [width, cols] of [
    [1100, 6],
    [1440, 8],
  ] as const) {
    test(`every lit day a keyboard reaches is drawn whole at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      const sea = page.getByTestId("desktop-landing").getByTestId("landing-sea");
      await expect(sea.getByTestId("sea-grid")).toHaveAttribute("data-cols", String(cols));
      await expect(sea.locator("[data-moment]")).toHaveCount(4);
      await expect(sea.getByRole("region", { name: "Find a day worth borrowing." }).getByRole("link", { name: BANNER })).toBeAttached();
      const doors = await sea.locator("[data-moment], [data-lit-for]").evaluateAll((cells) =>
        cells.flatMap((cell) =>
          [...cell.querySelectorAll<HTMLElement>("[data-testid=discover-card]")]
            .filter((card) => [...card.querySelectorAll("a")].some((link) => link.tabIndex >= 0))
            .map((card) => {
              const box = card.getBoundingClientRect();
              for (let clip = card.parentElement; clip !== null && clip.dataset.testid !== "landing-sea"; clip = clip.parentElement) {
                if (getComputedStyle(clip).overflow === "visible") continue;
                const edge = clip.getBoundingClientRect();
                if (box.top < edge.top - 1 || box.bottom > edge.bottom + 1 || box.left < edge.left - 1 || box.right > edge.right + 1) {
                  return { id: card.getAttribute("data-saved-day-id"), cut: true };
                }
              }
              return { id: card.getAttribute("data-saved-day-id"), cut: false };
            }),
        ),
      );
      expect(doors).toHaveLength(1 + 3 + 3 + 3);
      expect(doors.filter((door) => door.cut)).toEqual([]);
    });
  }

  // Mitchell's walk of PR 510 at 7260011: the second moment read "white text
  // on white background". The assistant's worked example (M51 part 6), risen at
  // the screen's middle, passes axe at the product's WCAG level, every impact:
  // its conversation, its ghost stops and its working Accept and Dismiss.
  test("the assistant moment passes axe once it has risen", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    const ask = page.getByTestId("desktop-landing").getByRole("region", { name: "Ask for more, keep what fits." });
    await expect(ask.getByRole("log", { name: "Conversation" })).toBeAttached();
    await ask.evaluate((moment) => {
      const box = moment.getBoundingClientRect();
      window.scrollBy(0, box.top + box.height / 2 - window.innerHeight / 2);
    });
    await expect(ask.getByTestId("moment-panel")).toHaveCSS("opacity", "1");
    const { violations } = await new AxeBuilder({ page })
      .include('[aria-labelledby="sea-assistant"]')
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(violations.map((violation) => ({ id: violation.id, targets: violation.nodes.map((node) => node.target.join(" ")) }))).toEqual([]);
  });

  // Mitchell's walk of PR 510 at 7260011: a background card under the pointer
  // rises out of the dimmed sea to full colour, as a lit day does, and sinks
  // back when the pointer leaves. Above the scrim with no veil of its own is
  // full colour; under it is dimmed.
  test("a background card rises to full colour under the pointer, and sinks back after", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    const sea = page.getByTestId("desktop-landing").getByTestId("landing-sea");
    const scrim = sea.getByTestId("sea-scrim");
    await page.evaluate(() => window.scrollTo(0, window.innerHeight * 2));
    await expect.poll(() => scrim.evaluate((el: HTMLElement) => el.style.getPropertyValue("--sea-dim"))).toBe("1");
    // By test id: the background is out of the accessibility tree.
    const background = sea.locator('[data-testid="sea-cell"][aria-hidden="true"]:not([data-lit-for])');
    // Polled: the cells two screens down mount once the reader is near them.
    const onScreen = () =>
      background.evaluateAll((cells) =>
        cells.findIndex((cell) => {
          const box = cell.getBoundingClientRect();
          return box.top > 80 && box.bottom < window.innerHeight - 20;
        }),
      );
    await expect.poll(onScreen).toBeGreaterThanOrEqual(0);
    const card = background.nth(await onScreen());
    const settled = () =>
      card.evaluate(async (cell) => {
        await Promise.all(cell.getAnimations({ subtree: true }).map((animation) => animation.finished));
        return { z: Number(getComputedStyle(cell).zIndex), veil: getComputedStyle(cell, "::before").opacity };
      });
    const under = Number(await scrim.evaluate((el) => getComputedStyle(el).zIndex));
    await card.hover();
    const risen = await settled();
    expect(risen.z).toBeGreaterThan(under);
    expect(risen.veil).toBe("0");
    await page.mouse.move(2, 2);
    expect((await settled()).z).toBeNaN();
  });

  // The phone's claims are the same components, the Discover card in its
  // compact form so it fits a short phone (390×664): below the headline and
  // inside the pinned stage. The claims are stacked, so the ones the sequence
  // hides are `inert`: a tap on the card lands on the card, not on a faded
  // claim over it, and a hidden claim's links take no focus.
  test("the phone's Playbooks claim fits a short phone and its card takes the tap", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 664 });
    await page.goto("/");
    const phone = page.getByTestId("phone-front-door");
    const title = phone.getByTestId("discover-card").getByRole("link", { name: PLAYBOOK });
    await expect(title).toBeVisible();

    const headline = await phone.getByRole("heading", { name: "Plan the trip together." }).boundingBox();
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
