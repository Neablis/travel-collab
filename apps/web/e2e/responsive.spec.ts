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
    // Measures the CARD ROOTS, not the eyebrow text inside them, and throws
    // rather than substituting a sentinel when a box is missing. The first
    // version of this mapped a missing box to -1, which made the 900px
    // assertion (`new Set(xs).size === 1`) pass on [-1, -1, -1] — green whether
    // or not the cards rendered at all (CodeRabbit, PR #58). Both axes are
    // asserted too: three cards drawn on top of each other share an x and would
    // otherwise satisfy the row check.
    const cardBoxes = async () => {
      const boxes = await page.evaluate(() => {
        return ["Together", "Notebook", "Playbooks"].map((eyebrow) => {
          const span = Array.from(document.querySelectorAll("span")).find(
            (el) => el.textContent?.trim() === eyebrow,
          );
          // `.min-h-107\\.5` is the card root's own height floor — a real class
          // it renders with, not a hook added for this test.
          const card = span?.closest("div.min-h-107\\.5");
          if (!card) return null;
          const r = card.getBoundingClientRect();
          return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width) };
        });
      });
      const found = boxes.filter((b) => b !== null);
      if (found.length !== 3) {
        throw new Error(`expected 3 landing feature cards, measured ${found.length}`);
      }
      return found as { x: number; y: number; width: number }[];
    };

    // 900px: one column — same x, strictly increasing y, and each card wider
    // than a single column of the three-up layout would be.
    await page.setViewportSize({ width: 900, height: 900 });
    await page.goto("/welcome");
    const stacked = await cardBoxes();
    expect(new Set(stacked.map((b) => b.x)).size).toBe(1);
    const stackedY = stacked.map((b) => b.y);
    expect(stackedY).toEqual([...stackedY].sort((a, b) => a - b));
    expect(new Set(stackedY).size).toBe(3);

    // 1280px: three columns — shared y, strictly increasing x. Below the lg
    // breakpoint the borrowed Day 2 card is ~51px wide and its stop rows cannot
    // render, which is why this grid is lg: and not md: (CodeRabbit, #58).
    await page.setViewportSize({ width: 1280, height: 900 });
    const row = await cardBoxes();

    // The 900px comment above claims each card is "wider than a single column
    // of the three-up layout would be" — this is the line that makes that true
    // rather than aspirational. Without it the helper returned `width` and
    // nothing read it, so a width regression passed (CodeRabbit, PR #58).
    // Narrowest stacked card vs widest three-up card: ~844 vs ~368.
    expect(Math.min(...stacked.map((b) => b.width))).toBeGreaterThan(
      Math.max(...row.map((b) => b.width)),
    );

    expect(new Set(row.map((b) => b.y)).size).toBe(1);
    const rowX = row.map((b) => b.x);
    expect(new Set(rowX).size).toBe(3);
    expect(rowX).toEqual([...rowX].sort((a, b) => a - b));
  });

  // Every visible piece of the hero art must sit inside the viewport at phone
  // widths. This is deliberately NOT covered by the sideways-scroll test below:
  // the art's fragments are absolutely positioned and centred on their
  // coordinates, so they clip on the LEFT, and left overflow is clipped rather
  // than scrolled — `scrollWidth` never notices (CodeRabbit, PR #58).
  for (const width of [402, 375, 320]) {
    test(`the hero art stays inside the viewport at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/welcome");
      await expect(
        page.getByRole("heading", { name: "The trip everyone actually helped plan." }),
      ).toBeVisible();

      const offenders = await page.evaluate(() => {
        const art = document.querySelector("div.h-107\\.5");
        if (!art) throw new Error("hero art container not found");
        const bad: { text: string; left: number; right: number }[] = [];
        for (const el of Array.from(art.querySelectorAll("*"))) {
          // SVG internals report user-space boxes that extend past the <svg>,
          // which clips its own content — they cannot affect what is visible.
          if (el.closest("svg")) continue;
          const r = el.getBoundingClientRect();
          if (r.width === 0 && r.height === 0) continue;
          if (r.left < -0.5 || r.right > window.innerWidth + 0.5) {
            bad.push({
              text: (el.textContent ?? "").trim().slice(0, 40),
              left: Math.round(r.left),
              right: Math.round(r.right),
            });
          }
        }
        return bad;
      });

      expect(offenders, `clipped at ${width}px: ${JSON.stringify(offenders)}`).toEqual([]);
    });
  }

  // The other half of the label gating: `hidden lg:inline` that never turned
  // back on would satisfy the three clipping tests above perfectly, by showing
  // nothing anywhere. This is what stops the phone fix from quietly costing the
  // desktop composition its place names.
  test("the hero art keeps its map labels at desktop width", async ({ page }) => {
    // Scoped to the art: the Together feature block's timeline names the same
    // two stops ("Fushimi Inari, early", "Nishiki Market"), so an unscoped
    // getByText matches twice and trips Playwright's strict mode.
    const art = page.locator("div.h-107\\.5");

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/welcome");
    await expect(art.getByText("Fushimi Inari")).toBeVisible();
    await expect(art.getByText("Nishiki Market")).toBeVisible();
    await expect(art.getByText("Ryokan · unconfirmed")).toBeVisible();

    // ...and drops them on a phone, which is the fix itself.
    await page.setViewportSize({ width: 375, height: 900 });
    await expect(art.getByText("Fushimi Inari")).toBeHidden();
    await expect(art.getByText("Nishiki Market")).toBeHidden();
    await expect(art.getByText("Ryokan · unconfirmed")).toBeHidden();

    // The numbered pins it hangs off stay — the map is still a map.
    await expect(art.getByText("1", { exact: true })).toBeVisible();
    await expect(art.getByText("3", { exact: true })).toBeVisible();
  });

  // The front door is the one surface a phone actually reaches signed out, and
  // the hero art is a stack of absolutely-positioned fragments at percentage
  // offsets with `whitespace-nowrap` labels — the shape that silently pushes a
  // page sideways. 402px is the width docs/STATUS.md's design audit walks.
  for (const width of [402, 360]) {
    test(`/welcome does not scroll sideways at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/welcome");
      // Witnesses before measuring: an empty shell, a redirect to /signin, or a
      // 500 all have scrollWidth === clientWidth and would sail through the
      // assertion below (CodeRabbit, PR #58). The h1 proves this is the landing
      // page rather than somewhere auth sent us; the feature-card h3 proves the
      // widest content on it actually rendered, which is what can overflow.
      await expect(
        page.getByRole("heading", { name: "The trip everyone actually helped plan." }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Four people, one schedule" }),
      ).toBeVisible();
      const { scrollWidth, clientWidth, widest } = await page.evaluate(() => {
        const doc = document.documentElement;
        // Name the worst offender in the failure message — "the page is 40px
        // too wide" on its own costs an afternoon of bisecting by hand.
        let widest = "";
        let worst = 0;
        for (const el of Array.from(document.body.querySelectorAll("*"))) {
          const right = el.getBoundingClientRect().right;
          if (right > worst) {
            worst = right;
            widest = `${el.tagName.toLowerCase()}.${(el.className || "").toString().split(" ").slice(0, 3).join(".")} → right=${Math.round(right)}`;
          }
        }
        return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth, widest };
      });
      expect(scrollWidth, `widest element: ${widest}`).toBeLessThanOrEqual(clientWidth);
    });
  }
});
