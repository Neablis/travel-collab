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

/** The sea's first moment's banner, the Rome playbook `scripts/landing-demo.ts` names in `content/playbooks/`. */
const BANNER = /^3 days in Rome: emperors, gladiators/;

// Screenshot-diff replacements for the m42 geometry checks (Mitchell,
// 2026-10-22): the numeric measurements these tests used to assert pixels
// by arithmetic — rects, scroll overflow, 1px tolerances — drifted on
// font/timing changes. A rendered snapshot asserts the same visible layout
// with one comparison per viewport instead of a number per element.
// `animations: "disabled"` freezes transitions so a capture is never a
// mid-transition read; `caret: "hide"` keeps the text caret out of the
// diff. The gate is an ABSOLUTE pixel budget (`maxDiffPixels`), not a
// ratio, on purpose: a clipped foot is ~N pixels no matter how tall the
// page is, so a ratio budget grows with page height while the defect
// does not — the old 1% ratio on a ~7M-pixel full-page shot allowed
// ~70,000 differing pixels, and a 44px foot cut across a ~350px cell
// (~15,000 pixels, ~0.2%) passed straight through it. The 2,000-pixel
// budget catches the clips the old arithmetic guarded — a 44px cut
// (~15,000 pixels), a 44px transcript clip (~9,000), a 21px blurb line
// (~6,300) — each with at least 3x margin, while per-pixel
// anti-aliasing noise is already absorbed by `threshold: 0.2` plus
// pixelmatch's anti-alias exclusion, so run-to-run diff in a pinned
// environment should sit far below it. No ratio is set alongside the
// cap, so the budget means the same thing on every shot regardless of
// image size — a ratio would silently loosen the gate on the tallest
// shots, which is exactly the failure being fixed.
// Baselines live in `m42-demo-trips.spec.ts-snapshots/` and MUST be
// generated in a CI-matching environment (see the PR body) — a snapshot
// generated on a developer's machine renders that machine's fonts, not
// CI's, and fails on ready for font drift alone.
const SEA_SHOT = {
  animations: "disabled",
  caret: "hide",
  threshold: 0.2,
  maxDiffPixels: 2000,
} as const;

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
  // nothing clipped at a foot, at the gate's widths. The wholeness guard is
  // a rendered snapshot, not scroll arithmetic (Mitchell, 2026-10-22): the
  // old clipped sweep measured scroll overflow, which any deliberate
  // line-clamp produces by design — the measurement and the design
  // disagreed, which is what PR #519's exclusion papered over. The
  // snapshot shows the same defects (a story cut at its foot, the
  // notebook not fading at the cell's edge, a repacked grid) with no
  // number to drift. The notebook's page is the one deliberate exception
  // (Mitchell's third walk: *"dont be afraid to make it too long, but clip it
  // at bottom so it fades out at the real edge"*): it runs on past its cell
  // and fades out at the cell's own foot, which the cell keeps — and the
  // fade is visible in the shot.
  for (const [width, height, cols] of [
    [1440, 900, 8],
    [3440, 1440, 19],
  ] as const) {
    test(`every story cell holds what it shows at ${width}`, async ({ page }) => {
      // Screenshot replacement (Mitchell, 2026-10-22; see the pruning
      // decision log): the clipped sweep and the notebook box check are
      // gone — the sweep's exclusion of clamped elements (PR #519) is
      // superseded with them, because a snapshot measures no scroll
      // overflow and has nothing to exclude. PR #519's unit pin (the
      // blurb carries line-clamp-2) stands: it locks the design the
      // snapshot depicts. The grid pack, story count, and attachments
      // stay as cheap structural guards; the snapshot is the wholeness
      // guard.
      await page.setViewportSize({ width, height });
      await page.goto("/");
      const sea = page.getByTestId("desktop-landing").getByTestId("landing-sea");
      // Packed for this width: the server's HTML is packed for six columns.
      await expect(sea.getByTestId("sea-grid")).toHaveAttribute("data-cols", String(cols));
      await expect(sea.getByRole("region", { name: "Everyone going, one plan." }).getByRole("list", { name: "Day 2 timeline" })).toBeAttached();
      await expect(sea.getByTestId("notebook-page")).toBeAttached();
      const stories = sea.getByTestId("sea-story");
      await expect(stories).toHaveCount(6);
      // The sea mounts background cells lazily, as the reader nears
      // them: a full-page capture that scrolls straight through can
      // pass a segment before its cells mount. Walk the page first in
      // viewport steps so every segment is mounted before the capture
      // scrolls it — frame waits, not sleeps.
      await page.evaluate(async () => {
        for (let y = 0; y < document.body.scrollHeight; y += window.innerHeight) {
          window.scrollTo(0, y);
          await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        }
        window.scrollTo(0, 0);
      });
      await page.evaluate(() => document.fonts.ready);
      await expect(page).toHaveScreenshot({ ...SEA_SHOT, fullPage: true });
    });
  }

  // A lit day is a tab stop, so it must be drawn whole: one cut off by a
  // clipping box would take focus out of sight and scroll that box out of
  // place. At 1440, and at 1100, where the grid is six columns. The count
  // comes first: the walk proves nothing if no lit cell is a door. The
  // banner day's door is the find panel's title link (the panel replaced
  // the old wide DiscoverCard, so no card carries it), then the Italian
  // and Greek days lit around the moments (Japan's open nothing). The
  // drawn-whole guard is a full-page snapshot (Mitchell, 2026-10-22),
  // not the old cut-walk: a cut lit day is visible in the shot, and the
  // count below keeps the keyboard-reachability claim.
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
        cells.flatMap((cell) => {
          const doors: { id: string | null }[] = [...cell.querySelectorAll<HTMLElement>("[data-testid=discover-card]")]
            .filter((card) => [...card.querySelectorAll("a")].some((link) => link.tabIndex >= 0))
            .map((card) => ({ id: card.getAttribute("data-saved-day-id") }));
          // The find moment's panel replaced its wide DiscoverCard, so the
          // banner day's door is the panel's title link — the panel's only
          // link — not a card. It counts like a card door.
          const panelLink = cell.querySelector<HTMLElement>("[data-testid=find-a-day-panel] a");
          if (panelLink !== null && panelLink.tabIndex >= 0) {
            doors.push({ id: panelLink.getAttribute("href") });
          }
          return doors;
        }),
      );
      expect(doors).toHaveLength(1 + 3 + 3 + 3);
      // The cut-walk is replaced by a rendered snapshot (Mitchell,
      // 2026-10-22): a lit day cut by a clipping box shows as a visibly
      // cut cell in the full-page shot, with no per-door box arithmetic
      // to drift. The count above stays: keyboard reachability is a
      // behavior, not a pixel, and no screenshot counts tab stops.
      // Same lazy-mount walk as the story-cell shot: frame waits, not
      // sleeps.
      await page.evaluate(async () => {
        for (let y = 0; y < document.body.scrollHeight; y += window.innerHeight) {
          window.scrollTo(0, y);
          await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        }
        window.scrollTo(0, 0);
      });
      await page.evaluate(() => document.fonts.ready);
      await expect(page).toHaveScreenshot({ ...SEA_SHOT, fullPage: true });
    });
  }

  // Mitchell's walk of PR 510 at 7260011: the second moment read "white text
  // on white background". The assistant's worked example (M51 part 6), risen at
  // the screen's middle, passes axe at the product's WCAG level, every impact.
  // And it is a picture (his walk of PR 514: "I don't think it makes sense for
  // the assistant preview buttons to be clickable"): nothing in it shows the
  // pointer a control would.
  test("the assistant moment passes axe once it has risen, and points at nothing", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    const ask = page.getByTestId("desktop-landing").getByRole("region", { name: "Ask for more, keep what fits." });
    await expect(ask.getByRole("log", { name: "Conversation", includeHidden: true })).toBeAttached();
    const pointing = await ask.getByTestId("moment-panel").evaluate((panel) =>
      [...panel.querySelectorAll("*")].filter((el) => getComputedStyle(el).cursor === "pointer").map((el) => el.getAttribute("aria-label") ?? el.textContent),
    );
    expect(pointing).toEqual([]);
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

  // At 1100 the grid is six columns and the river's lane some 250px: the open
  // review popover is the lane's width, not the app's 320 (PR 514's fourth
  // review), and the moment's columns hold what they draw, clipping nothing.
  // Both are now shown by a viewport snapshot of the risen assistant
  // (Mitchell, 2026-10-22), not by box arithmetic: the popover against its
  // lane and any clipped transcript column are visible in the shot.
  test("the assistant moment holds its open popover and its transcript at 1100", async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 900 });
    await page.goto("/");
    const ask = page.getByTestId("desktop-landing").getByRole("region", { name: "Ask for more, keep what fits." });
    await expect(page.getByTestId("desktop-landing").getByTestId("sea-grid")).toHaveAttribute("data-cols", "6");
    await expect(ask.getByRole("list", { name: /timeline$/, includeHidden: true })).toBeAttached();
    await expect(ask.getByRole("group", { name: "Review this suggestion", includeHidden: true })).toBeAttached();
    // Risen at the screen's middle, as in the axe test: the popover's
    // width against its lane and the transcript's columns are in frame.
    // The baseline author must confirm the popover IS in frame before
    // committing the snapshot — a shot without it proves nothing about
    // the lane-width rule.
    await ask.evaluate((moment) => {
      const box = moment.getBoundingClientRect();
      window.scrollBy(0, box.top + box.height / 2 - window.innerHeight / 2);
    });
    await expect(ask.getByTestId("moment-panel")).toHaveCSS("opacity", "1");
    await page.evaluate(() => document.fonts.ready);
    await expect(page).toHaveScreenshot({ ...SEA_SHOT });
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

  // The phone's sea (M51 decision 11): every moment fits a short phone's
  // screen under the bar (390×664), its content inside its cell, and the
  // find moment risen at the screen's middle is a door a tap opens. The
  // fit half is now one viewport snapshot per moment (Mitchell,
  // 2026-10-22), not height arithmetic; the tap half stays its own
  // test, because a screenshot looks fine while taps miss.
  test("the phone's moments each fit a short phone", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 664 });
    await page.goto("/");
    const phone = page.getByTestId("phone-front-door");
    // One viewport shot per moment, each risen at the scroller's middle:
    // a moment taller than the screen under the bar shows cut at the
    // viewport's edges, and the find card overflowing its cell shows the
    // same way. Named per moment so a diff names the moment that broke.
    // Baseline check for the find shot, stated here so it is not lost:
    // the frame must show BOTH the find card's foot and its cell's
    // foot. The old check was card bottom <= cell bottom, and a shot
    // showing only the card proves nothing about the card-inside-cell
    // rule — the reviewer must confirm both feet are visible before
    // committing the baseline, like the assistant popover-in-frame
    // check above.
    for (const [name, shot] of [
      ["Find a day worth borrowing.", "phone-moment-find.png"],
      ["Ask for more, keep what fits.", "phone-moment-ask.png"],
      ["Everyone going, one plan.", "phone-moment-crew.png"],
      ["Keep the notebook afterwards.", "phone-moment-notebook.png"],
    ] as const) {
      const moment = phone.getByRole("region", { name });
      await moment.evaluate((el) => {
        const scroller = el.closest<HTMLElement>("[data-testid=phone-front-door]")!;
        const box = el.getBoundingClientRect();
        scroller.scrollTop += box.top + box.height / 2 - scroller.clientHeight / 2;
      });
      await expect(moment.getByTestId("moment-panel")).toHaveCSS("opacity", "1");
      await page.evaluate(() => document.fonts.ready);
      await expect(page).toHaveScreenshot(shot, { ...SEA_SHOT });
    }
  });

  test("the find moment's card takes the tap", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 664 });
    await page.goto("/");
    const phone = page.getByTestId("phone-front-door");
    const find = phone.getByRole("region", { name: "Find a day worth borrowing." });
    await find.evaluate((moment) => {
      const scroller = moment.closest<HTMLElement>("[data-testid=phone-front-door]")!;
      const box = moment.getBoundingClientRect();
      scroller.scrollTop += box.top + box.height / 2 - scroller.clientHeight / 2;
    });
    await expect(find.getByTestId("moment-panel")).toHaveCSS("opacity", "1");
    const title = find.getByRole("link", { name: BANNER });
    // The hit test, not a render, is the guard here: the #518 phone-tap
    // bug was a link rect whose center fell between two line boxes, so
    // the card looked right while taps missed. A screenshot cannot see
    // that, so the tap half stays its own test, its logic unchanged
    // (the card-inside-cell check moved to the screenshot test above).
    const tapped = await title.evaluate((link) => {
      const r = link.getBoundingClientRect();
      return link.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
    });
    expect(tapped).toBe(true);
  });
});
