import { expect, test } from "@playwright/test";
import { commandsFor } from "@tc/factories";
import { createMappedTrip } from "./helpers";
import { e2eTripName } from "./tripNames";

// KI-19: the whole suite used to run at exactly one viewport (Playwright's
// 1280x720 default, above the 1179px breakpoint), so a whole class of real
// defect — most famously KI-16, a full-page click sink below 1180px — was
// invisible to the gate. This spec runs in the "narrow" project
// (playwright.config.ts, 1100px) and is the gate condition Task 3.4 asks
// for: assertions covering every breakpoint-dependent behavior the app
// actually has, rather than running all 15 specs twice to catch a narrow
// class of bug.
test.describe("responsive (narrow viewport)", () => {
  test("the assistant rail is docked, not an overlay: no scrim, and the page stays interactive with it open (KI-16)", async ({ page }) => {
    const { tripId } = await page.request.post("/api/trips", { data: { name: e2eTripName("Responsive") } }).then((r) => r.json());
    for (const command of commandsFor("threeDayTrip", tripId)) {
      await page.request.post(`/api/trips/${tripId}/commands`, { data: command });
    }
    await page.goto(`/trips/${tripId}`);

    // The rail is closed until asked for, at every width, so open it before
    // asserting anything about it.
    await page.getByRole("button", { name: "Assistant" }).click();
    const rail = page.getByRole("complementary", { name: "Assistant" });
    await expect(rail).toBeVisible();

    // M16 Wave 1 (Task 4, SPEC §9): the rail is a real flex sibling now, not
    // `position: fixed` with a scrim in front of it — there is nothing left
    // to dismiss the rail past, so the scrim is gone outright rather than
    // just hidden at this width. The regression this guards, KI-16, was an
    // aria-hidden click-catcher with no handler that made every control on
    // the page unreachable below 1180px. Proving the scrim element doesn't
    // exist is necessary but not sufficient — the property that actually
    // matters, and survives however the rail is implemented, is that the
    // rest of the page keeps responding while the rail is open.
    await expect(page.locator(".assistant-rail-scrim")).toHaveCount(0);
    await page.getByRole("tab", { name: "Timeline" }).click();
    await expect(page.getByRole("tab", { name: "Timeline", selected: true })).toBeVisible();

    await page.getByRole("button", { name: "Hide" }).click();
    await expect(rail).toBeHidden();
  });

  test("docked contract: opening the rail shrinks the plan by exactly its own 356px, at 1280px and below 1180px", async ({ page }) => {
    const { tripId } = await page.request.post("/api/trips", { data: { name: e2eTripName("Responsive") } }).then((r) => r.json());
    for (const command of commandsFor("threeDayTrip", tripId)) {
      await page.request.post(`/api/trips/${tripId}/commands`, { data: command });
    }
    await page.goto(`/trips/${tripId}`);

    // SPEC §9's whole DOCKED claim, in one number: "the plan shrinks instead
    // of being overlaid." Checked at both a wide (1280px) and a narrow
    // (1100px, below the 1179px breakpoint that used to gate overlay vs.
    // column) width — 1280 is not this project's default viewport, so it's
    // set explicitly here, the same pattern the landing-card and hero-art
    // tests in this file already use to check more than one width from a
    // single narrow-project test.
    for (const width of [1280, 1100] as const) {
      await page.setViewportSize({ width, height: 900 });
      const plan = page.locator(".trip-board-content");
      await expect
        .poll(() => plan.evaluate((el) => el.getBoundingClientRect().width))
        .toBe(width);

      await page.getByRole("button", { name: "Assistant" }).click();
      const rail = page.getByRole("complementary", { name: "Assistant" });
      await expect(rail).toBeVisible();
      await expect
        .poll(() => rail.evaluate((el) => el.getBoundingClientRect().width))
        .toBe(356);
      await expect
        .poll(() => plan.evaluate((el) => el.getBoundingClientRect().width))
        .toBe(width - 356);

      await page.getByRole("button", { name: "Hide" }).click();
      await expect(rail).toBeHidden();
    }
  });

  test("the trip page is interactive: a view tab click changes the lens", async ({ page }) => {
    const { tripId } = await page.request.post("/api/trips", { data: { name: e2eTripName("Responsive") } }).then((r) => r.json());
    for (const command of commandsFor("threeDayTrip", tripId)) {
      await page.request.post(`/api/trips/${tripId}/commands`, { data: command });
    }
    await page.goto(`/trips/${tripId}`);

    await expect(page.getByRole("tab", { name: "Day columns", selected: true })).toBeVisible();
    await page.getByRole("tab", { name: "Timeline" }).click();
    await expect(page.getByRole("tab", { name: "Timeline", selected: true })).toBeVisible();
  });

  test("a sheet opens above the docked rail and its Close button is reachable (KI-17)", async ({ page }) => {
    const { tripId } = await page.request.post("/api/trips", { data: { name: e2eTripName("Responsive") } }).then((r) => r.json());
    for (const command of commandsFor("threeDayTrip", tripId)) {
      await page.request.post(`/api/trips/${tripId}/commands`, { data: command });
    }
    await page.goto(`/trips/${tripId}`);

    // Opened deliberately, unlike before: KI-17 is about a Radix portal
    // stacking underneath a fixed-position layer already on the page, and a
    // hidden rail is not on the page to stack under anything. M16 Wave 1
    // made the rail a docked flex sibling with no overlay/scrim mode left to
    // gate on width (it used to be one below 1180px) — the risk this guards
    // against is the same stacking bug in that new shape, so the rail has to
    // actually be open for this assertion to mean anything.
    await page.getByRole("button", { name: "Assistant" }).click();
    await expect(page.getByRole("complementary", { name: "Assistant" })).toBeVisible();

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

  // KI-56, and the reason it needs its own narrow assertion: KI-28 reserves
  // room for the "{planned} planned of {budget}" line so a card cannot change
  // height when its TripDetail lands, and an open trip-actions menu cannot
  // drift off its target. That reservation was one line, which holds only
  // while the string FITS on one line — in a narrow card it wraps and the
  // card grows again. `m8-make-it-real.spec.ts` guards the same invariant at
  // 1280px, where the slot is wide enough that nothing ever wraps, so it
  // cannot see this. .coderabbit.yaml's components rule asks for exactly this:
  // breakpoint-gated layout exercised below the default e2e viewport.
  //
  // The widths are chosen from measured slot WIDTHS, not from the breakpoints
  // — a card's slot does not widen monotonically, because the grid adds a
  // column at `sm` and narrows every card again:
  //
  //   viewport   360  500  640  768  1024  1440
  //   card slot   265  426  263  327   290   322
  //
  // The widest figure needs 277px to stay on one line, so most widths do not
  // wrap at all and an assertion there proves nothing. Both widths below were
  // confirmed RED against a deliberately reverted build (20.19px of growth);
  // earlier drafts using 500, 700 and even 360 all passed against that same
  // broken build and were dropped for it. 320 is the narrowest real phone;
  // 640 is the band where the extra column shrinks the card, which is why
  // TripCard reserves to `md` and not `sm`.
  for (const width of [320, 640]) {
    test(`a long money figure cannot change a card's height at ${width}px (KI-56)`, async ({ page }) => {
      const { tripId } = await page.request
        .post("/api/trips", { data: { name: e2eTripName("Narrow cost") } })
        .then((r) => r.json());
      for (const command of commandsFor("threeDayTrip", tripId)) {
        await page.request.post(`/api/trips/${tripId}/commands`, { data: command });
      }

      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      const card = page.getByTestId("trip-card").first();
      await expect(card).toBeVisible();
      // The line has actually landed — otherwise this would measure the
      // reserved slot against itself and pass for the wrong reason.
      await expect(card.getByText(/planned of|No budget yet/)).toBeVisible();

      // Swap the real line for one long enough to wrap at this width and
      // measure the CARD, which is what an anchored menu follows. Injecting
      // the string is what makes this deterministic: it does not depend on a
      // seeded trip happening to carry a large-figure currency.
      const growth = await card.evaluate((el) => {
        const slot = el.querySelector('div[class*="min-h-"]');
        const line = slot?.firstElementChild;
        if (!line) return null;
        const height = () => el.getBoundingClientRect().height;
        const original = line.textContent;
        const before = height();
        line.textContent = "¥12,345,678 planned of ¥50,000,000";
        const after = height();
        line.textContent = original;
        return after - before;
      });

      expect(growth, "the card's cost-line slot was not found").not.toBeNull();
      // 1px, not 3: this compares one rendered state against another in the
      // same layout pass, with none of the reserved-vs-filled line-box
      // residue the 1280px guard has to absorb. The defect is 20px.
      expect(Math.abs(growth!)).toBeLessThan(1);
    });
  }

  // The hero's own reservation, which is `sm` rather than `md` because its
  // slot IS monotonic below `lg` (235px at 360, 402px at 500, 542px at 640).
  // Only 360 is narrow enough to wrap, so unlike the card there is one width
  // worth asserting. The hero sits ABOVE the trip grid, so any height it
  // gains pushes every card and every menu anchored to one.
  test("a long money figure cannot change the hero's height at 360px (KI-56)", async ({ page }) => {
    const { tripId } = await page.request
      .post("/api/trips", { data: { name: e2eTripName("Narrow hero") } })
      .then((r) => r.json());
    for (const command of commandsFor("threeDayTrip", tripId)) {
      await page.request.post(`/api/trips/${tripId}/commands`, { data: command });
    }

    await page.setViewportSize({ width: 360, height: 900 });
    await page.goto("/");
    const hero = page.locator(".hero-grid");
    await expect(hero).toBeVisible();
    await expect(hero.getByText(/planned of|No budget yet/)).toBeVisible();

    const growth = await hero.evaluate((el) => {
      const slot = el.querySelector('div[class*="min-h-"]');
      const line = slot?.firstElementChild;
      if (!line) return null;
      const height = () => el.getBoundingClientRect().height;
      const original = line.textContent;
      const before = height();
      line.textContent = "¥12,345,678 planned of ¥50,000,000";
      const after = height();
      line.textContent = original;
      return after - before;
    });

    expect(growth, "the hero's cost-line slot was not found").not.toBeNull();
    expect(Math.abs(growth!)).toBeLessThan(1);
  });
});

// The landing page is the one surface a signed-out phone actually reaches, and
// its feature grid is breakpoint-gated — the class of thing KI-19 says the
// Mitchell, 2026-08-30 design pass, on a 411px Android: "map view pretty
// broken on mobile, maybe remove legend on mobile, and figure out a different
// static location for the days, have less info and make that where you scroll
// so map jumping still works."
//
// Here rather than in the "phone" project because that project is scoped to
// m16-mobile-assistant.spec.ts, and this file already owns the
// set-your-own-width pattern (the hero-art and money-figure tests below do
// the same). The width is his: 411px.
test.describe("responsive (Map lens on a phone)", () => {
  test("swaps the rail, focus card and legend for one day strip, and keeps map jumping", async ({ page }) => {
    const tripId = await createMappedTrip(page, e2eTripName("MapPhone"), 3);
    await page.setViewportSize({ width: 411, height: 760 });
    await page.goto(`/trips/${tripId}?lens=Map`);

    const strip = page.getByTestId("map-day-strip");
    await expect(strip).toBeVisible();

    // The three desktop overlays are gone — not merely hidden, since the rail
    // runs scroll machinery that should not be observing a zero-height box.
    await expect(page.locator("[data-rail-track]")).toHaveCount(0);
    await expect(page.getByText("Rest of trip")).toHaveCount(0);

    // "make that where you scroll so map jumping still works": tapping a day
    // in the strip is what focuses it now, and the detail line is where the
    // rail's per-row detail and the focus card's content went.
    await strip.getByRole("button", { name: /Day 2/ }).click();
    await expect(page.getByTestId("map-day-strip-detail")).toContainText(/stop/);

    // The strip is a control on the map, not a band the page scrolls past:
    // the canvas still owns the viewport, so the document must not scroll.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollHeight - window.innerHeight,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test("keeps the rail and legend at desktop width", async ({ page }) => {
    const tripId = await createMappedTrip(page, e2eTripName("MapDesktop"), 3);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/trips/${tripId}?lens=Map`);

    await expect(page.locator("[data-rail-track]")).toHaveCount(1);
    await expect(page.getByTestId("map-day-strip")).toHaveCount(0);
  });
});

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
