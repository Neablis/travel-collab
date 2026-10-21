import { randomUUID } from "node:crypto";
import { expect, test } from "./fixtures/test";
import { commandsFor } from "@tc/factories";
import { createMappedTrip, signInAsDevUser } from "./helpers";
import { e2eTripName } from "./tripNames";

/**
 * A dev username nobody has used before. Same shape as
 * `m11a-invite-gate.spec.ts`'s own `freshUsername` (not exported from
 * there, so duplicated rather than reached across spec files) — hex only
 * and short, because `devLoginIdentity` rejects anything outside
 * `^[A-Za-z0-9_-]{1,32}$`.
 */
function freshUsername(): string {
  return `e2e${randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

/** How the Calendar names a run of hidden weekdays: "Sat", or "Fri–Sat". */
function weekdayRun(days: string[]): string {
  return days.length === 1 ? days[0]! : `${days[0]}–${days[days.length - 1]}`;
}

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
    await page.goto(`/trips/${tripId}?view=Plan`);

    // The rail is closed until asked for, at every width, so open it before
    // asserting anything about it.
    await page.getByRole("button", { name: "Ask" }).click();
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
    // A tab that is NOT the one we are on, so the click has somewhere to go.
    // This clicked "Plan" and expected "Timeline" to light up, which was the
    // two-sub-mode world SPEC §24 replaced: the trip has four views now
    // (Overview · Plan · Calendar · Map) and Plan is where this walk starts,
    // so that click asserted that pressing the selected tab selects a lens
    // that no longer exists. Calendar is a real move from here.
    await page.getByRole("tab", { name: "Calendar" }).click();
    await expect(page.getByRole("tab", { name: "Calendar", selected: true })).toBeVisible();

    await page.getByRole("button", { name: "Hide" }).click();
    await expect(rail).toBeHidden();
  });

  test("docked contract: opening the rail shrinks the plan by exactly its own 356px, at 1280px and below 1180px", async ({ page }) => {
    const { tripId } = await page.request.post("/api/trips", { data: { name: e2eTripName("Responsive") } }).then((r) => r.json());
    for (const command of commandsFor("threeDayTrip", tripId)) {
      await page.request.post(`/api/trips/${tripId}/commands`, { data: command });
    }
    await page.goto(`/trips/${tripId}?view=Plan`);

    // SPEC §9's whole DOCKED claim, in one number: "the plan shrinks instead
    // of being overlaid." Checked at both a wide (1280px) and a narrow
    // (1100px, below the 1179px breakpoint that used to gate overlay vs.
    // column) width — 1280 is not this project's default viewport, so it's
    // set explicitly here, the same pattern the landing
    // tests in this file already use to check more than one width from a
    // single narrow-project test.
    for (const width of [1280, 1100] as const) {
      await page.setViewportSize({ width, height: 900 });
      const plan = page.locator(".trip-board-content");
      await expect
        .poll(() => plan.evaluate((el) => el.getBoundingClientRect().width))
        .toBe(width);

      await page.getByRole("button", { name: "Ask" }).click();
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
    await page.goto(`/trips/${tripId}?view=Plan`);

    // The four views of SPEC §24, not the old Timeline/Day columns pair: "Plan"
    // is the word on both surfaces now (§24 — "the phone tab bar already said
    // Plan for the editing surface while the desktop said Day columns — one
    // name now"), and switching lenses means moving between the four.
    await expect(page.getByRole("tab", { name: "Plan", selected: true })).toBeVisible();
    await page.getByRole("tab", { name: "Calendar" }).click();
    await expect(page.getByRole("tab", { name: "Calendar", selected: true })).toBeVisible();
    // And it is a real navigation, not just a highlight: the view is in the URL
    // where `resolveView` reads it back on reload.
    await expect(page).toHaveURL(/view=Calendar/);
  });

  // KI-2026-09-24-k. The Calendar's week has a 144px column floor, so it is
  // 1014px wide and overflows sideways below that — at 820px Friday was cut in
  // half and Saturday gone, at 1024px Saturday was clipped, and nothing on
  // screen said the week went on. The property held here is not "it fits"
  // (it cannot, at the floor) but "a weekday you cannot see is one the page
  // names, with a control that brings it in".
  test("a Calendar week that runs off the side names the hidden days, and the control reaches them (KI-2026-09-24-k)", async ({ page }) => {
    const { tripId } = await page.request.post("/api/trips", { data: { name: e2eTripName("Responsive") } }).then((r) => r.json());
    for (const command of commandsFor("threeDayTrip", tripId)) {
      await page.request.post(`/api/trips/${tripId}/commands`, { data: command });
    }
    await page.goto(`/trips/${tripId}?view=Calendar`);

    // The trip starts ten days out, so it may straddle a month end; the first
    // block is enough — every block has the same seven columns.
    const month = page.getByTestId("calendar-month").first();
    // The weekday headers not wholly inside the scroller, read from real
    // geometry — the same thing a person sees, not the component's own state.
    const hiddenWeekdays = () =>
      month.evaluate((el) => {
        const box = el.querySelector('[data-testid="calendar-week-scroller"]')!.getBoundingClientRect();
        const heads = [...el.querySelectorAll<HTMLElement>("[data-weekday]")];
        const outside = (side: "before" | "after") =>
          heads
            .filter((h) => {
              const r = h.getBoundingClientRect();
              return side === "before" ? r.left < box.left - 1 : r.right > box.right + 1;
            })
            .map((h) => h.dataset.weekday!);
        return { before: outside("before"), after: outside("after") };
      });

    for (const width of [820, 1024]) {
      await page.setViewportSize({ width, height: 900 });
      // The premise: at this width the week really does overflow on the right.
      await expect.poll(async () => (await hiddenWeekdays()).after.length, { message: `${width}px` }).toBeGreaterThan(0);
      const { before, after } = await hiddenWeekdays();
      // Unscrolled, so nothing is off the left and no left control claims so.
      expect(before).toEqual([]);
      await expect(month.getByTestId("calendar-week-scroll")).toHaveCount(1);
      await expect(month.getByRole("button", { name: `Scroll to ${weekdayRun(after)}` })).toBeVisible();
    }

    // The control does what it names: Saturday comes all the way in, and the
    // days that left on the other side are named in turn.
    await page.setViewportSize({ width: 820, height: 900 });
    await expect.poll(async () => (await hiddenWeekdays()).after).toContain("Sat");
    await month.getByRole("button", { name: /^Scroll to .*Sat$/ }).click();
    await expect.poll(async () => (await hiddenWeekdays()).after).toEqual([]);
    const { before } = await hiddenWeekdays();
    expect(before.length, "scrolling right should have pushed Sunday out on the left").toBeGreaterThan(0);
    await expect(month.getByRole("button", { name: `Scroll to ${weekdayRun(before)}` })).toBeVisible();

    // And where the week fits — this project's own 1100px — nothing is hidden
    // and nothing claims otherwise.
    await page.setViewportSize({ width: 1100, height: 800 });
    await expect.poll(hiddenWeekdays).toEqual({ before: [], after: [] });
    await expect(month.getByTestId("calendar-week-scroll")).toHaveCount(0);
  });

  test("a sheet opens above the docked rail and its Close button is reachable (KI-17)", async ({ page }) => {
    const { tripId } = await page.request.post("/api/trips", { data: { name: e2eTripName("Responsive") } }).then((r) => r.json());
    for (const command of commandsFor("threeDayTrip", tripId)) {
      await page.request.post(`/api/trips/${tripId}/commands`, { data: command });
    }
    await page.goto(`/trips/${tripId}?view=Plan`);

    // Opened deliberately, unlike before: KI-17 is about a Radix portal
    // stacking underneath a fixed-position layer already on the page, and a
    // hidden rail is not on the page to stack under anything. M16 Wave 1
    // made the rail a docked flex sibling with no overlay/scrim mode left to
    // gate on width (it used to be one below 1180px) — the risk this guards
    // against is the same stacking bug in that new shape, so the rail has to
    // actually be open for this assertion to mean anything.
    await page.getByRole("button", { name: "Ask" }).click();
    await expect(page.getByRole("complementary", { name: "Assistant" })).toBeVisible();

    await page.getByRole("button", { name: "Trip settings" }).click();
    const closeButton = page.getByRole("button", { name: "Close" });
    await expect(closeButton).toBeVisible();
    await closeButton.click();
    await expect(closeButton).toBeHidden();
  });

  // Was "the Playbooks strip reflows to two columns below 1180px", against
  // home's `.playbooks-grid`. M11b deleted that strip — it was a `<Preview>`
  // shell over fabricated cards — and its hand-written 1180px media query with
  // it. The app's breakpoint-gated CARD GRID is now Discover's results list,
  // and the property KI-19 exists for is unchanged: a grid whose column count
  // depends on width must be exercised BELOW the suite's 1280px default, where
  // the whole class of defect KI-16 belongs to lives.
  //
  // Its own day, in the `Yours` scope, so the grid has something to lay out
  // without this spec publishing anything into the shared public library.
  test("the Discover card grid reflows below the desktop breakpoints", async ({ page }) => {
    const { tripId } = await page.request
      .post("/api/trips", { data: { name: e2eTripName("Responsive") } })
      .then((r) => r.json());
    const dayId = crypto.randomUUID();
    await page.request.post(`/api/trips/${tripId}/commands`, { data: { type: "AddDay", tripId, dayId } });
    await page.request.post(`/api/trips/${tripId}/commands`, {
      data: {
        type: "AddActivity",
        tripId,
        activityId: crypto.randomUUID(),
        dayId,
        title: "A stop",
        timeWindow: { start: "09:00", end: "10:00" },
        location: { name: "Somewhere", city: "Kyoto" },
      },
    });
    const kept = await page.request.post("/api/saved-days", {
      data: { name: `Responsive day ${Date.now()}`, tripId, dayIds: [dayId] },
    });
    expect(kept.ok()).toBe(true);

    await page.goto("/playbooks");
    // `role="tab"`, not `role="radio"`: M26 link 2a turned Discover's scope
    // into `UnderlineTabs` (§33.2 — an underline says "a different page of
    // this thing"). This line was the only e2e lookup that change broke; the
    // remaining `getByRole("radio")` calls are account preferences, which are
    // still a real radio group.
    await page.getByRole("tab", { name: "Yours" }).click();
    await expect(page.getByTestId("discover-results")).toBeVisible();

    const columns = () =>
      page
        .getByTestId("discover-results")
        .evaluate((el) => getComputedStyle(el).gridTemplateColumns.trim().split(/\s+/).length);

    // The narrow project's own 1100px is above Tailwind's `lg` (1024px), so
    // the reflow this is about happens below it — set the width explicitly for
    // the second half rather than adding a third project, exactly as the hero
    // test below does for its own 1024px breakpoint.
    // Read before the assertions so the `finally` below can always reach it.
    const { savedDay } = (await kept.json()) as { savedDay: { savedDayId: string } };
    try {
      expect(await columns()).toBe(3);
      await page.setViewportSize({ width: 800, height: 800 });
      expect(await columns()).toBe(2);
      await page.setViewportSize({ width: 500, height: 800 });
      expect(await columns()).toBe(1);
    } finally {
      // Unconditional. `global.teardown.ts` sweeps `[e2e]` trips and a saved day
      // is not a trip, so a spec that keeps one and walks away grows the shared
      // dev user's library by one row every run — which is how `SavedDaysDialog`
      // reached nineteen days and stopped being clickable (see `ui/dialog.tsx`).
      // A responsive assertion is exactly the one most likely to fail, and the
      // cleanup used to sit after it, so the failure that mattered also leaked.
      expect((await page.request.delete(`/api/saved-days/${savedDay.savedDayId}`)).ok()).toBe(true);
    }
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
        expect((await page.request.post(`/api/trips/${tripId}/commands`, { data: command })).ok()).toBe(true);
      }
      // A second trip, so there is a CARD to measure even on an otherwise
      // empty account: one of the two is the hero, and since SPEC §35.2 the
      // hero is not in the grid. Planned like the first, because a trip with
      // no days shows its next steps where the cost line goes (M37) — so the
      // card is picked by name, never as whichever trip sorts first.
      const { tripId: heroId } = await page.request
        .post("/api/trips", { data: { name: e2eTripName("Narrow cost hero") } })
        .then((r) => r.json());
      for (const command of commandsFor("threeDayTrip", heroId)) {
        expect((await page.request.post(`/api/trips/${heroId}/commands`, { data: command })).ok()).toBe(true);
      }

      await page.setViewportSize({ width, height: 900 });
      await page.goto("/home");
      const card = page.getByTestId("trip-card").filter({ hasText: "Narrow cost" }).first();
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
    await page.goto("/home");
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

// KI-2026-09-23-e: the hero's sparkline and its actionable line both come from
// the hero's own TripDetail, which lands after the page has painted. At a phone
// width the hero is one column, so the sparkline panel sits BELOW the left
// column and every pixel it gains pushes *Other trips* down under the thumb —
// measured at 122.75px on the seeded trip at 390px, and 90.56px on the trip
// below before the fix. At 1440px the left column sets the row height and the
// jump is 0.19px, which is why this is asserted at a phone width only.
//
// **A fresh account, because the hero has to be THIS trip.** When this was
// written the hero was the head of a list query with no ORDER BY (KI-034,
// since fixed: it is now picked by start date), so on the shared dev user it
// was whichever row Postgres returned first — a first draft here assumed
// "newest" and measured another spec's trip. The shared user's other trips can
// still outrank this one by date. One account, one trip, one hero.
//
// The trip is chosen to exercise both halves: one row of city pills (Rome,
// Barcelona, Kyoto fit on one line at 390px), and an actionable line with both
// of its parts — overlapping windows (and three cities a day apart) give
// decisions, and `kind: "pending"` makes the last stop one still to book. Only
// the last: an overlap with a pending stop is no conflict (Mitchell,
// 2026-10-10, feedback #8), so a trip of nothing but pending stops would have
// no decisions left to show. With both parts present, "N not booked yet" used
// to wrap under the button at this width, which was the second half of the
// jump. The fetch is HELD so the loading state is measured deliberately, not
// raced.
test.describe("responsive (Home hero on a phone, fresh account)", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("the hero keeps its height when its trip detail lands at 390px (KI-2026-09-23-e)", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await signInAsDevUser(page, freshUsername());

    const name = e2eTripName("Hero reflow");
    const { tripId } = await page.request.post("/api/trips", { data: { name } }).then((r) => r.json());
    const overlapping = [
      { start: "09:00", end: "10:00" },
      { start: "09:30", end: "10:30" },
    ];
    const commands = commandsFor("threeDayTrip", tripId, { timeWindows: overlapping });
    for (const command of commands) {
      await page.request.post(`/api/trips/${tripId}/commands`, { data: command });
    }
    const stops = commands.filter(
      (command): command is Extract<typeof command, { type: "AddActivity" }> => command.type === "AddActivity",
    );
    for (const { activityId } of stops.slice(-1)) {
      await page.request.post(`/api/trips/${tripId}/commands`, {
        data: { type: "UpdateActivity", tripId, activityId, kind: "pending" },
      });
    }

    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(`**/api/trips/${tripId}`, async (route) => {
      await released;
      await route.continue();
    });

    await page.goto("/home");
    const hero = page.getByTestId("next-trip-hero");
    await expect(hero.getByRole("heading", { level: 2, name })).toBeVisible();
    await expect(hero.getByRole("status", { name: /shape of the trip/i })).toBeVisible();
    const before = (await hero.boundingBox())!.height;

    release();
    // Both detail-dependent halves have actually landed — otherwise this
    // would compare the loading state with itself.
    await expect(hero.getByRole("group", { name: /shape of the trip/i })).toBeVisible();
    await expect(hero.getByText(/needs? a decision/)).toBeVisible();
    await expect(hero.getByText(/not booked yet/)).toBeVisible();
    const after = (await hero.boundingBox())!.height;

    // 1px, the same allowance as KI-56's: the reserved bones are whole-pixel
    // scale classes and the real rows are 1.35-line-height text, so the two
    // differ by a fraction of a pixel. The defect is ~90px.
    expect(Math.abs(after - before)).toBeLessThan(1);
  });
});

// **Its own trip, on its own account.** This used to run as the shared user and
// create nothing, so it measured whatever hero an EARLIER spec's trip happened
// to put on Home. Run alone on a fresh database there was no trip, so no
// `.hero-grid` at all, and it timed out waiting for one. That made it depend on
// test order. A fresh account with one trip makes the hero this test's own,
// the same reasoning as the KI-2026-09-23-e describe above.
test.describe("responsive (Home hero below 1024px, fresh account)", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("the hero collapses to a single column below 1024px", async ({ page }) => {
    // The narrow project's own 1100px is above the hero's 1024px breakpoint
    // (distinct from the rail/Playbooks strip's 1180px) — set it explicitly
    // for this one assertion rather than adding a whole second project.
    await page.setViewportSize({ width: 1000, height: 800 });
    await signInAsDevUser(page, freshUsername());

    const name = e2eTripName("Hero columns");
    const { tripId } = await page.request.post("/api/trips", { data: { name } }).then((r) => r.json());
    for (const command of commandsFor("threeDayTrip", tripId)) {
      await page.request.post(`/api/trips/${tripId}/commands`, { data: command });
    }

    await page.goto("/home");
    const hero = page.getByTestId("next-trip-hero");
    await expect(hero.getByRole("heading", { level: 2, name })).toBeVisible();
    const columns = await page
      .locator(".hero-grid")
      .evaluate((el) => getComputedStyle(el).gridTemplateColumns.trim().split(/\s+/).length);
    expect(columns).toBe(1);
  });
});

// Mitchell, 2026-08-30 design pass, on a 411px Android: "map view pretty
// broken on mobile, maybe remove legend on mobile, and figure out a different
// static location for the days, have less info and make that where you scroll
// so map jumping still works."
//
// Here rather than in the "phone" project because that project is scoped to
// m16-mobile-assistant.spec.ts, and this file already owns the
// set-your-own-width pattern (the landing and money-figure tests below do
// the same). The width is his: 411px.
test.describe("responsive (Map lens on a phone)", () => {
  test("swaps the rail, focus card and legend for one day strip, and keeps map jumping", async ({ page }) => {
    const tripId = await createMappedTrip(page, e2eTripName("MapPhone"), 3);
    await page.setViewportSize({ width: 411, height: 760 });
    await page.goto(`/trips/${tripId}?view=Map`);

    const strip = page.getByTestId("map-day-strip");
    await expect(strip).toBeVisible();

    // The three desktop overlays are gone — not merely hidden, since the rail
    // runs scroll machinery that should not be observing a zero-height box.
    await expect(page.locator("[data-rail-track]")).toHaveCount(0);
    // "Rest of trip" is the LEGEND's own key (`MapLegend.tsx`), so this line is
    // the legend assertion. The focus card's is below, AFTER a day is focused —
    // asserting it here would pass on any build, because the card only renders
    // for a focused day and nothing is focused yet.
    await expect(page.getByText("Rest of trip")).toHaveCount(0);

    // "make that where you scroll so map jumping still works": tapping a day
    // in the strip is what focuses it now, and the detail line is where the
    // rail's per-row detail and the focus card's content went.
    //
    // This asserts the strip's own half only. A broken onFocus -> fitBounds
    // handoff would still satisfy it, so the camera half is pinned in
    // MapLens.test.tsx ("moves the camera when a day is tapped in the strip"),
    // where the map is a test double whose fitBounds calls can be read —
    // maplibre exposes no camera state to query from here (CodeRabbit, PR #98).
    await strip.getByRole("button", { name: /Day 2/ }).click();
    await expect(page.getByTestId("map-day-strip-detail")).toContainText(/stop/);
    // The third overlay, asserted where the assertion means something: a day is
    // focused now, which is the only state that renders a focus card at all, so
    // a build that kept the card on a phone would fail here. Before the tap this
    // passed on every build. Raised by review on pull request 102, and the first
    // fix for it made exactly that mistake.
    await expect(page.getByTestId("map-focus-card")).toHaveCount(0);

    // The focused chip's ring must not be clipped by the track's own scroll
    // container. `overflow-x-auto` forces overflow-y to compute as `auto`
    // too, so the container clips on every side; without vertical padding the
    // ring is cut off against the top edge. DayChips hit this three times and
    // this strip a fourth, so it is measured rather than eyeballed.
    //
    // Both edges, not just the top: the container clips symmetrically, so a
    // top-only assertion passes while the ring is cut off underneath
    // (CodeRabbit, PR #98).
    const ringClearance = await page.evaluate(() => {
      const track = document.querySelector('[data-testid="map-day-strip"] [role="group"]')!;
      const focused = track.querySelector('[aria-pressed="true"]')!;
      const trackBox = track.getBoundingClientRect();
      const focusedBox = focused.getBoundingClientRect();
      return { top: focusedBox.top - trackBox.top, bottom: trackBox.bottom - focusedBox.bottom };
    });
    // ring-2 is 2px; anything less than that and the ring is being cut.
    expect(ringClearance.top).toBeGreaterThanOrEqual(2);
    expect(ringClearance.bottom).toBeGreaterThanOrEqual(2);

    // The strip is a control on the map, not a band the page scrolls past:
    // the canvas still owns the viewport, so the document must not scroll.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollHeight - window.innerHeight,
    );
    expect(overflow).toBeLessThanOrEqual(1);

    // The `overflow` assertion above is the whole of what this screen still
    // owes on that subject, and there is **no `--launcher-height` assertion
    // because there is no such variable any more.** Both halves of the note
    // that used to be here are now history, kept because they are the reason
    // the assertion is absent rather than merely missing:
    //
    // 1. One was written and then removed. It stayed GREEN with the production
    //    fix reverted — at 3 days and at 14 — because the bug needed the render
    //    volume of the seeded 14-day/68-stop trip to reproduce, and it also had
    //    to reach for `.trip-board-content` and `.flow-root` by class. A test
    //    that cannot go red is a claim, not a control (CLAUDE.md rule 3).
    //    (Copilot, PR #143.)
    // 2. Its replacement guard, the unit test "publishes the launcher's flow
    //    height on attach", is gone too — with what it measured. SPEC §23
    //    deleted the phone's in-flow launcher (the entry point is the trip
    //    header's Ask pill now), so the launcher is `position: fixed` at every
    //    width it renders at and costs the plan column no flow space by
    //    construction. `TripBoardScreen.test.tsx`'s "has no in-flow launcher on
    //    a phone, and publishes no height for one" asserts that from the other
    //    side, including that the custom property is absent rather than pinned
    //    at `0px`.
  });

  test("keeps the rail and legend at desktop width", async ({ page }) => {
    const tripId = await createMappedTrip(page, e2eTripName("MapDesktop"), 3);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/trips/${tripId}?view=Map`);

    await expect(page.locator("[data-rail-track]")).toHaveCount(1);
    await expect(page.getByTestId("map-day-strip")).toHaveCount(0);
    // The test is named "keeps the rail AND LEGEND" and asserted only the rail.
    // No focus-card assertion here: the card renders only for a focused day and
    // nothing is focused on load, so at desktop width there are legitimately
    // zero. Its phone counterpart is asserted after a day IS focused.
    await expect(page.getByText("Rest of trip")).toBeVisible();
  });
});

// Mitchell, Vercel toolbar comment on `/trips/:id?view=Map&view=Calendar` at
// 411x760 (the same phone the Map-lens block above uses): "all three columns
// from share, trip overview to budget are really crowded and ugly on mobile,
// if we hid them here would they still be accessible in trip settings?".
//
// They were not, entirely — budget and dates were already in the sheet, the
// stop/city counts were nowhere, and Share was mounted in exactly two places
// in the app (this header and the home hero), so hiding it would have left a
// phone user unable to share the trip in front of them. The counts and Share
// moved into Trip settings first; this spec is what stops either move being
// silently undone, because the disappearances alone are the half that a
// regression which LOST them would also satisfy.
test.describe("responsive (trip header on a phone)", () => {
  test("sheds Share, the meta pill and the budget chip at 411px — and Trip settings still carries all three", async ({ page }) => {
    // `createMappedTrip` gives the days real located activities, so the city
    // count in the sheet is a number derived from something rather than 0.
    const tripId = await createMappedTrip(page, e2eTripName("HeaderPhone"), 3);
    await page.setViewportSize({ width: 411, height: 760 });
    await page.goto(`/trips/${tripId}?view=Plan`);

    const settings = page.getByRole("button", { name: "Trip settings" });
    await expect(settings).toBeVisible();

    // Hidden, not removed: these are CSS-gated (`hidden md:…`), so they are
    // still in the DOM and `toBeHidden` is the assertion that means anything.
    // The testid names the HEADER's copy specifically — an unscoped
    // "trip-meta-row" would be ambiguous with the sheet's own counts.
    await expect(page.getByTestId("trip-meta-row")).toBeHidden();
    // Share is not merely hidden here — it is not in the header at any width
    // (Mitchell, 2026-09-06: *"Put share in the trip settings under invite
    // someone, both here and in mobile"*), so the assertion is a count on the
    // header rather than a `toBeHidden` on a CSS-gated wrapper that no longer
    // exists.
    await expect(page.getByLabel("Trip", { exact: true }).getByRole("button", { name: "Share", exact: true })).toHaveCount(0);

    // What deliberately stays. Actions are not information: "Add stop" (the
    // phone's one door to a parked stop since M41) and History have no
    // equivalent in Trip settings, and the tab strip and day chips are the
    // phone's primary navigation.
    //
    // **Reachable, not laid out** (M39 D6, KI-2026-09-24-i): they were two
    // visible buttons in the header, and they moved into its one row's `⋯` on
    // purpose, so the pinned header is ~56px. The claim is unchanged — the
    // header still offers both — and is asserted through the menu.
    // Scoped to the trip header, which is the copy this spec means.
    const tripHeader = page.getByLabel("Trip", { exact: true });
    await expect(tripHeader.getByRole("button", { name: "Add stop" })).toBeHidden();
    await expect(tripHeader.getByRole("button", { name: "History", exact: true })).toBeHidden();
    await tripHeader.getByRole("button", { name: "Trip actions" }).click();
    await expect(page.getByRole("menuitem", { name: "Add stop" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "History" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toBeHidden();
    // The lens strip is no longer "the phone's primary navigation" — SPEC §16's
    // bottom tab bar is, and §10 keeps Day columns and Calendar off the phone
    // entirely, so a four-tab strip here has nothing left to offer. It is
    // hidden rather than removed (`hidden md:block`), which is why this is
    // `toBeHidden` and not a count.
    //
    // The replacement assertion is deliberately the STRONGER one: the point of
    // this spec is that navigation survives the phone, so it now names what
    // actually navigates. Asserting only the disappearance would be satisfied
    // by a build that shed the strip and shipped nothing in its place.
    await expect(page.getByRole("tablist", { name: "Trip view" })).toBeHidden();
    await expect(page.getByRole("navigation", { name: "Phone navigation" })).toBeVisible();
    await expect(page.getByRole("link", { name: /^Plan/ })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("group", { name: "Days" })).toBeVisible();

    // The header's own Trips/Playbooks links go the same way and for the same
    // reason (RULES.md 4 — the tab bar carries both now), and this is the only
    // lane that can say so: they are gated by `hidden md:flex` in
    // `AccountMenu.tsx`, which is inert at the suite's 1280px default, and
    // `PhoneTabBar.test.tsx` never renders AccountMenu at all. Scoped to the
    // banner because the tab bar legitimately carries links of the same two
    // names — unscoped, these would be ambiguous under strict mode, which is
    // itself the duplication being removed. (CodeRabbit, PR #143.)
    const header = page.getByRole("banner");
    await expect(header.getByRole("link", { name: "Trips" })).toBeHidden();
    await expect(header.getByRole("link", { name: "Playbooks" })).toBeHidden();

    // …and the half that would otherwise go unnoticed: account scope STAYS in
    // the top bar (RULES.md 1) because the tab bar does not carry it. Asserted
    // as reachable rather than merely present — a visible control that cannot
    // be opened would satisfy `toBeVisible` and strand the only route to
    // account settings and sign-out on a phone.
    const account = header.getByRole("button", { name: "Account menu" });
    await expect(account).toBeVisible();
    await account.click();
    // No `menuitem` roles: the account control is a Popover, not a Menu (SPEC
    // §5 — "Account menu and History are both Popover"). Both entries are
    // asserted, because "Your account" is the only route to account settings on
    // a phone once the header's links are gone, and it is the one that would be
    // missed.
    //
    // **"Your account" is a LINK since M26 link 1** (SPEC §34.4 made account
    // settings the `/account` route), while Sign out is still a button — it
    // performs an act rather than going somewhere, and it stays in this popover
    // on desktop and phone alike rather than moving onto the account page
    // (project rule 4; the decision is recorded in M26 link 1).
    await expect(page.getByRole("link", { name: "Your account" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();

    // Asserted, not just pressed. This started as cleanup so the popover would
    // not sit over the sideways-overflow check below, which meant a broken
    // Escape handler passed silently — a keypress with no assertion is a test
    // asserting nothing on the path it claims to cover. Escape is also the only
    // dismiss this popover has on a phone once the header links are gone, so it
    // is worth a real assertion. (CodeRabbit, PR #143.)
    await page.keyboard.press("Escape");
    await expect(page.getByRole("link", { name: "Your account" })).toBeHidden();
    await expect(page.getByRole("button", { name: "Sign out" })).toBeHidden();

    // "Crowded" has a measurable form at this width: a header wider than the
    // phone. The page must not scroll sideways.
    const sideways = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(sideways).toBeLessThanOrEqual(1);

    // The half that is the whole point of the change. Everything the header
    // stopped showing is behind the title, which is still the door.
    await settings.click();
    const sheet = page.getByRole("dialog", { name: "Trip settings" });
    await expect(sheet).toBeVisible();

    // Anchored regexes: the budget section also says "N stops with no cost
    // yet", which a loose /\d+ stops/ would match as well.
    await expect(sheet.getByText(/^\d+ stops$/)).toBeVisible();
    await expect(sheet.getByText(/^\d+ cities$/)).toBeVisible();
    await expect(sheet.getByText(/^\d+ days$/)).toBeVisible();
    // Budget and dates were already reachable here before this change; they
    // are asserted so "the header hid them" and "the sheet has them" stay one
    // statement rather than two files' worth of assumption.
    await expect(sheet.getByLabel("Total for the trip")).toBeVisible();
    await expect(sheet.getByRole("button", { name: "Dates", exact: true })).toBeVisible();

    // Share, operated rather than merely located: this is a Radix Popover
    // opening from inside a Radix Dialog, which is the one thing about this
    // change that could plausibly render and still not work (KI-17's
    // stacking, and the modal dialog's own pointer-events/focus trap). A
    // browser is the only place that question can be answered.
    await sheet.getByRole("button", { name: "Share", exact: true }).click();
    await expect(page.getByTestId("share-panel")).toBeVisible();
    await expect(page.getByRole("button", { name: "Create a share link" })).toBeEnabled();
  });

  test("keeps the meta pill and budget in the header at desktop width, and Share nowhere in it", async ({ page }) => {
    const tripId = await createMappedTrip(page, e2eTripName("HeaderDesktop"), 3);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/trips/${tripId}?view=Plan`);

    await expect(page.getByTestId("trip-meta-row")).toBeVisible();
    // **Share is not in the header at desktop width either**, which is the half
    // of Mitchell's 2026-09-06 note that a phone-only assertion would miss:
    // *"Put share in the trip settings under invite someone, both here and in
    // mobile"*. It was `hidden md:block` before — present here, absent there —
    // and this test asserted exactly that, so it is the one that had to change.
    await expect(page.locator('header[aria-label="Trip"]').getByRole("button", { name: "Share", exact: true })).toHaveCount(0);
    // The pill itself — the mirror that makes the phone assertions above
    // statements about the BREAKPOINT rather than about a control that stopped
    // rendering everywhere. It carried the day/stop/city counts until SPEC
    // §35.3 made it the dates only, and a button (M27 D5); the counts are the
    // sheet's alone now, which the phone test above already reads there.
    await expect(page.getByTestId("trip-meta-row").getByRole("button", { name: /^Trip dates:/ })).toBeVisible();

    // The CONVERSE, and it had no coverage until now. The date line SPEC §23
    // adds is phone-only by CSS (`md:hidden`), and the unit tests that used to
    // assert those class strings were deleted on PR #148 as presentation
    // assertions — correctly, since jsdom cannot evaluate a media query, so
    // they only ever checked that a string was in an attribute. It is real: if
    // the date line leaked onto desktop it would print the range a second
    // time, right above the meta pill that already carries it (project rule 4).
    await expect(page.getByTestId("trip-date-line")).toBeHidden();
    // The Ask pill is NOT phone-only any more (M39 D3, KI-2026-09-24-j): it is
    // the entry point at every width, and the floating launcher it replaces
    // is gone, because that one sat over the right-hand column's costs (SPEC
    // §13.5, "nothing floats over data"). One entry point, in the header.
    await expect(page.locator('header[aria-label="Trip"]').getByRole("button", { name: "Ask", exact: true })).toBeVisible();
    await expect(page.getByTestId("assistant-launcher")).toHaveCount(0);

    // M39 D6's converse: the phone row's `⋯` is not drawn here, and History
    // is still a button in the header. *Add stop* is not: on desktop a stop is
    // made where it will live, on a day's river or in the drawer (M41 D1).
    const tripHeader = page.locator('header[aria-label="Trip"]');
    await expect(tripHeader.getByRole("button", { name: "Trip actions" })).toBeHidden();
    await expect(tripHeader.getByRole("button", { name: "Add stop" })).toHaveCount(0);
    await expect(tripHeader.getByRole("button", { name: "History", exact: true })).toBeVisible();

    // Mitchell's preview comment: "Ask is larger than add stop in height and
    // looks weird. Lets also move this down a bit so its aligned with the trip
    // title on the same row". Add stop has gone from the row since (M41); the
    // half that still applies is the row: the title's vertical centre falls
    // inside Ask's box.
    const askBox = (await tripHeader.getByRole("button", { name: "Ask", exact: true }).boundingBox())!;
    const titleBox = (await tripHeader.getByRole("heading", { level: 1 }).boundingBox())!;
    const titleCentre = titleBox.y + titleBox.height / 2;
    expect(titleCentre).toBeGreaterThanOrEqual(askBox.y);
    expect(titleCentre).toBeLessThanOrEqual(askBox.y + askBox.height);
  });
});

// The landing page, at the widths the 1280px default viewport will not
// exercise. Own describe, because the front door needs the signed-out state
// and the narrow project supplies alice's.
test.describe("responsive (narrow viewport, signed out)", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  // M51: the desktop front door is a sea of days edge to edge, because a
  // band held to 1140px left two-thirds of a 3440px screen empty (Mitchell's
  // walk after M50). The first screen is cells from the server's HTML, so
  // they are measured as they arrive, at both widths the gate names.
  for (const width of [1440, 3440]) {
    test(`the sea runs edge to edge at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto("/");
      // By test id: the background is hidden from the accessibility tree.
      const firstScreen = page.getByTestId("desktop-landing").getByTestId("sea-grid");
      await expect(firstScreen.getByTestId("discover-card").first()).toBeVisible();
      const box = (await firstScreen.boundingBox())!;
      const viewport = await page.evaluate(() => document.documentElement.clientWidth);
      expect(box.x).toBeLessThanOrEqual(16);
      expect(viewport - (box.x + box.width)).toBeLessThanOrEqual(16);
      // Cells to the right edge, not one column stretched across it.
      const cards = await firstScreen.getByTestId("discover-card").evaluateAll((els) =>
        els.map((el) => el.getBoundingClientRect().right),
      );
      expect(Math.max(...cards)).toBeGreaterThanOrEqual(viewport - 32);
    });

    // The grid sizes every cell, and the card fills what its cell gives it
    // (Mitchell, on PR 510): the card's box is the cell's, less the mat around
    // it, 22px of region strip on top and 6px on the other three sides. A card
    // that sized itself, or scaled to fit, would not land on it.
    test(`every card on the first screen fills its cell at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto("/");
      const cells = page.getByTestId("desktop-landing").getByTestId("sea-cell");
      await expect(cells.first()).toBeVisible();
      const misfits = await cells.evaluateAll((els) =>
        els
          .filter((cell) => cell.getBoundingClientRect().bottom <= window.innerHeight)
          .map((cell) => {
            const box = cell.getBoundingClientRect();
            const card = cell.querySelector("[data-testid=discover-card]")!.getBoundingClientRect();
            return [card.left - box.left, card.top - box.top, box.right - card.right, box.bottom - card.bottom].map(Math.round);
          })
          .filter((inset) => inset.join() !== "6,22,6,6"),
      );
      expect(misfits).toEqual([]);
    });

    // A card keeps its title above all else: chips and tags drop first. A
    // card's parts that do not fit move to a second column, which it clips,
    // so a title moved there leaves a card naming no day (PR 510 r4: Catania
    // and Marrakech on a one-row cell showed their chips and nothing else).
    test(`every card on the first screen shows its title at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto("/");
      const cells = page.getByTestId("desktop-landing").getByTestId("sea-cell");
      await expect(cells.first()).toBeVisible();
      const untitled = await cells.evaluateAll((els) =>
        els
          .filter((cell) => cell.getBoundingClientRect().bottom <= window.innerHeight)
          .map((cell) => {
            const card = cell.querySelector("[data-testid=discover-card]")!.getBoundingClientRect();
            const title = cell.querySelector("h3")!;
            const box = title.getBoundingClientRect();
            const inside = box.left >= card.left && box.right <= card.right + 0.5 && box.top >= card.top && box.bottom <= card.bottom + 0.5;
            return inside ? null : title.textContent;
          })
          .filter((name) => name !== null),
      );
      expect(untitled).toEqual([]);
    });

    // Mitchell's third walk of PR 510: *"For the primary header for the app,
    // maybe give it a little more standout?"*, and his fourth: *"The border
    // makes this wider than the other components … then add a drop shadow"*.
    // Its frame is its border, inside the grid area every other cell keeps
    // to; the lift is the designs' drop shadow (the prototype's `.ex .ff`);
    // the headline is larger than the closing's `text-4xl` (58px at most).
    // Computed in the browser, because a utility class on the same element
    // silently won over the CSS (PR 510 r6).
    test(`the hero stands off the sea on the grid's lines at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto("/");
      const hero = page.getByTestId("desktop-landing").getByTestId("sea-hero");
      const headline = hero.getByRole("heading", { level: 1, name: "Plan the trip together." });
      await expect(headline).toBeVisible();
      const { box, area, shadow, border } = await hero.evaluate((el) => {
        const grid = el.parentElement!;
        const css = getComputedStyle(grid);
        const [cols, start, span, rows] = ["--cols", "--hero-start", "--hero-span", "--hero-rows"].map((name) =>
          Number.parseFloat(css.getPropertyValue(name)),
        ) as [number, number, number, number];
        const g = grid.getBoundingClientRect();
        const unit = (g.width - 32 - (cols - 1) * 8) / cols;
        const r = el.getBoundingClientRect();
        // From the grid's second row, past its 8px top padding and 16px sides.
        const area = [g.left + 16 + (start - 1) * (unit + 8), g.top + 8 + unit + 8, span * unit + (span - 1) * 8, rows * unit + (rows - 1) * 8];
        const style = getComputedStyle(el);
        return { box: [r.left, r.top, r.width, r.height].map(Math.round), area: area.map(Math.round), shadow: style.boxShadow, border: style.borderTopWidth };
      });
      expect(box).toEqual(area);
      // Nothing outside the box but the drop shadow: no ring spread into the gap.
      expect(shadow).toBe("rgba(21, 29, 46, 0.35) 0px 30px 80px 0px");
      expect(border).not.toBe("0px");
      expect(await headline.evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThan(58);
    });

    // Mitchell, walking PR 510 after it merged: the find moment's Rome banner
    // *"still only shows a few of the activities, it doesnt fill the card"*.
    // It drew three because three were all it was sent (M51 part 9 lifts the
    // cap), and day one has only four; it is day 2's six now (Mitchell,
    // 2026-10-21), and a row counts only if it is laid out and inside the
    // card's box on every side, so a hidden row is not counted as shown.
    test(`the find moment's banner shows more than four stop rows at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto("/");
      const banner = page.getByTestId("desktop-landing").getByRole("region", { name: "Find a day worth borrowing." }).getByTestId("discover-card");
      await expect(banner.getByTestId("preview-title").first()).toBeVisible();
      const shown = await banner.evaluate((card) => {
        const box = card.getBoundingClientRect();
        return [...card.querySelectorAll("[data-testid=discover-preview] li")].filter((row) => {
          const r = row.getBoundingClientRect();
          return (
            r.height > 0 &&
            r.left >= box.left - 0.5 &&
            r.top >= box.top - 0.5 &&
            r.right <= box.right + 0.5 &&
            r.bottom <= box.bottom + 0.5
          );
        }).length;
      });
      expect(shown).toBeGreaterThan(4);
    });

    // Mitchell's fourth walk of PR 510: *"show activities up till they dont
    // fit rather than just render the first 3"*. A card lays its parts in one
    // wrapping column and clips the second, so it drops parts from the first
    // that does not fit. Only its title and its facts come before its stops:
    // where a card drops its stops with room left for one row, the part it
    // dropped first is one of those two, and never the stops as a block, nor
    // a description or a rating ahead of them. The second half reads the DOM,
    // not the computed order: there the description, tags and rating come
    // before the rows, and only `order-1` lays them after, so a card that
    // drops a row may show nothing the DOM puts ahead of its rows but its
    // title and facts (PR 510 r8: sorted by computed order, the check passed
    // with `order-1` gone).
    test(`every card on the first screen shows the stop rows it has room for at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto("/");
      const cards = page.getByTestId("desktop-landing").getByTestId("sea-grid").getByTestId("discover-card");
      await expect(cards.first()).toBeVisible();
      const ahead = await cards.evaluateAll((els) =>
        els
          .filter((card) => card.getBoundingClientRect().bottom <= window.innerHeight)
          .flatMap((card) => {
            const right = card.getBoundingClientRect().right + 0.5;
            const rows = [...card.querySelectorAll("[data-testid=discover-preview] li")];
            if (rows.length === 0 || rows.every((row) => row.getBoundingClientRect().right <= right)) return [];
            const items = (el: Element): Element[] =>
              [...el.children].flatMap((child) => (getComputedStyle(child).display === "contents" ? items(child) : [child]));
            const before = items(card).slice(0, items(card).indexOf(rows[0]!));
            const wrong = before.filter(
              (part) => part.getBoundingClientRect().right <= right && !part.matches(".landing-sea-head, h3, [data-testid=card-facts]"),
            );
            return [{ card: card.querySelector("h3")!.textContent, wrong: wrong.map((part) => part.textContent!.slice(0, 40)) }];
          }),
      );
      // Not vacuous: first-screen cards do drop rows at both widths.
      expect(ahead.length, "first-screen cards that drop a stop row").toBeGreaterThan(0);
      expect(ahead.filter(({ wrong }) => wrong.length > 0)).toEqual([]);
      const roomy = await cards.evaluateAll((els) =>
        els
          .filter((card) => card.getBoundingClientRect().bottom <= window.innerHeight)
          .flatMap((card) => {
            const box = card.getBoundingClientRect();
            // The card's parts, its flex items, in the order it lays them.
            const items = (el: Element): Element[] =>
              [...el.children].flatMap((child) => (getComputedStyle(child).display === "contents" ? items(child) : [child]));
            const parts = items(card)
              .map((part, i) => ({ part, i, order: Number(getComputedStyle(part).order) }))
              .sort((a, b) => a.order - b.order || a.i - b.i)
              .map(({ part }) => part);
            const shown = (el: Element) => el.getBoundingClientRect().right <= box.right + 0.5;
            const row = card.querySelector("[data-testid=discover-preview] li");
            const dropped = parts.find((part) => !shown(part));
            if (row === null || shown(row) || dropped === undefined) return [];
            if (dropped.matches(".landing-sea-head, h3, [data-testid=card-facts]")) return [];
            const style = getComputedStyle(card);
            const last = Math.max(...parts.filter(shown).map((part) => part.getBoundingClientRect().bottom));
            const room = box.bottom - Number.parseFloat(style.paddingBottom) - Number.parseFloat(style.rowGap) - last;
            return room >= row.getBoundingClientRect().height ? [`${card.querySelector("h3")!.textContent}: ${Math.round(room)}px free`] : [];
          }),
      );
      expect(roomy).toEqual([]);
    });

    // "never two touching" (Mitchell's third walk: accents *"spread out"*):
    // the first screen's accents, which CSS packs `dense`, and the packed
    // background's below them. At 3440×1271, France sat on Mexico (PR 510 r6).
    test(`no two accents touch at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 3440 ? 1271 : 900 });
      await page.goto("/");
      const grid = page.getByTestId("desktop-landing").getByTestId("sea-grid");
      await expect(grid.getByTestId("sea-accent").first()).toBeAttached();
      // Packed again for the columns CSS chose, not the server's six.
      await expect
        .poll(() => grid.evaluate((el) => el.getAttribute("data-cols") === getComputedStyle(el).getPropertyValue("--cols").trim()))
        .toBe(true);
      const touching = await grid.evaluate((el) => {
        const foot = el.getBoundingClientRect().bottom;
        // Past the grid's foot is a first-screen cell that found no room, and is clipped.
        const boxes = [...el.querySelectorAll("[data-testid=sea-accent]")]
          .map((accent) => ({ name: accent.textContent, box: accent.getBoundingClientRect() }))
          .filter(({ box }) => box.bottom <= foot + 1);
        // Neighbours are one 8px gap apart, at an edge or a corner.
        const near = (a: DOMRect, b: DOMRect) =>
          Math.max(a.left - b.right, b.left - a.right) < 12 && Math.max(a.top - b.bottom, b.top - a.bottom) < 12;
        return boxes.flatMap((a, i) => boxes.slice(i + 1).filter((b) => near(a.box, b.box)).map((b) => `${a.name} / ${b.name}`));
      });
      expect(touching).toEqual([]);
    });

  }

  // Mitchell's fourth walk of PR 510, at 1304×822: *"Too much dead space,
  // shrink the whole container down 1 row, then take up the extra space at
  // the bottom of free, plus and premium"*. Three rows, not four; each step
  // reaches the ladder's foot with nothing it holds cut off, and it is still
  // a ladder.
  for (const [width, height] of [
    [1304, 822],
    [1440, 900],
    [3440, 1271],
  ] as const) {
    test(`the pricing is three rows, its steps filling them, at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto("/");
      const pricing = page.getByTestId("desktop-landing").getByRole("region", { name: "Pricing" });
      await pricing.scrollIntoViewIfNeeded();
      await expect(pricing.getByTestId("plan-step").first()).toBeVisible();
      const { rows, steps } = await pricing.evaluate((el) => {
        const ladder = el.querySelector("[data-testid=plan-ladder]")!;
        const foot = ladder.getBoundingClientRect().bottom;
        return {
          rows: el.closest<HTMLElement>("[data-testid=sea-story]")!.style.gridRow,
          steps: [...ladder.children].map((step) => ({
            top: step.getBoundingClientRect().top,
            toFoot: Math.round(foot - step.getBoundingClientRect().bottom),
            cut: step.scrollHeight > step.clientHeight + 1,
          })),
        };
      });
      expect(rows).toMatch(/span 3$/);
      expect(steps.map(({ toFoot, cut }) => ({ toFoot, cut }))).toEqual(steps.map(() => ({ toFoot: 0, cut: false })));
      const [free, plus, premium] = steps.map(({ top }) => top) as [number, number, number];
      expect(free).toBeGreaterThan(plus);
      expect(plus).toBeGreaterThan(premium);
    });
  }

  // A name is never cut mid-word (PR 510 r6: "Switzerlan"; r7: "Switzerlan /
  // d" at 1650 and 3100): where the browser has no hyphenation dictionary,
  // as Linux Chromium has none, it is sized so its longest word fits one
  // line. Counted in line boxes, because `overflow-wrap: anywhere` breaks a
  // word inside its box rather than overflow it, which no scroll width sees.
  for (const width of [1440, 1650, 3100, 3440]) {
    test(`no accent's name breaks inside a word at ${width}px`, async ({ page }) => {
      // A screen tall enough that every band of the sea is near, and mounted.
      await page.setViewportSize({ width, height: 8000 });
      await page.goto("/");
      const names = page.getByTestId("desktop-landing").getByTestId("sea-accent").locator(".landing-sea-stamp-name");
      // Every accent once over, the longest one-word name with them.
      await expect.poll(() => names.count()).toBeGreaterThan(34);
      expect(await names.allTextContents()).toContain("Switzerland");
      const broken = await names.evaluateAll((els) =>
        els.flatMap((name) => {
          const range = document.createRange();
          range.selectNodeContents(name);
          const lines = new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size;
          return lines > name.textContent!.split(" ").length ? [`${name.textContent} in ${lines} lines`] : [];
        }),
      );
      expect(broken).toEqual([]);
    });
  }

  // The front door is the one surface a phone actually reaches signed out,
  // and the shape that silently pushes a page sideways is something laid out
  // past the edge. 402px is the width docs/STATUS.md's design audit walks.
  for (const width of [402, 360]) {
    test(`the landing does not scroll sideways at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      // Witnesses before measuring: an empty shell, a redirect to /signin, or a
      // 500 all have scrollWidth === clientWidth and would sail through the
      // assertion below (CodeRabbit, PR #58). The h1 proves this is the landing
      // page rather than somewhere auth sent us; the second witness proves the
      // widest content on it actually rendered, which is what can overflow.
      //
      // **The second witness is the phone's sea** (M51 decision 11): at these
      // widths the desktop landing is `display: none` and `PhoneFrontDoor` is
      // the page, a grid of cards in its own scroller whose bands mount as the
      // reader nears them. So the walk scrolls the whole page, and measures
      // the document and the scroller at every half screen: a band that
      // mounts too wide is found where it mounts.
      await expect(page.getByRole("heading", { name: "Plan the trip together." })).toBeVisible();
      const door = page.getByTestId("phone-front-door");
      const cells = door.getByTestId("phone-sea").getByTestId("sea-cell");
      await expect(cells.first()).toBeVisible();
      const before = await cells.count();
      const worst = await door.evaluate(async (scroller) => {
        const doc = document.documentElement;
        let found = { doc: 0, scroller: 0, widest: "" };
        for (let top = 0; top <= scroller.scrollHeight; top += scroller.clientHeight / 2) {
          scroller.scrollTop = top;
          await new Promise((settled) => setTimeout(settled, 100));
          const over = { doc: doc.scrollWidth - doc.clientWidth, scroller: scroller.scrollWidth - scroller.clientWidth };
          if (over.doc > found.doc || over.scroller > found.scroller) {
            // Name the worst offender in the failure message — "the page is
            // 40px too wide" on its own costs an afternoon of bisecting by hand.
            // Not one inside a box that clips it, which pushes nothing: a
            // card's clipped second column is far past the edge by design.
            const clipped = (el: Element) => {
              for (let up = el.parentElement; up !== null && up !== scroller; up = up.parentElement) {
                if (getComputedStyle(up).overflowX !== "visible") return true;
              }
              return false;
            };
            let widest = "";
            let right = 0;
            for (const el of Array.from(scroller.querySelectorAll("*"))) {
              if (clipped(el)) continue;
              const edge = el.getBoundingClientRect().right;
              if (edge > right) {
                right = edge;
                widest = `${el.tagName.toLowerCase()}.${(el.className || "").toString().split(" ").slice(0, 3).join(".")} → right=${Math.round(edge)} at ${top}`;
              }
            }
            found = { ...over, widest };
          }
        }
        return found;
      });
      expect(await cells.count(), "the walk mounted no band past the first screen").toBeGreaterThan(before);
      expect({ doc: worst.doc, scroller: worst.scroller }, `widest element: ${worst.widest}`).toEqual({ doc: 0, scroller: 0 });
    });
  }

  // Mitchell, on the old pinned front door: *"the header with the logo and
  // site name and sign in button should still be visible"*. The sea scrolls
  // under it in the phone's own scroller, and `sticky top-0` keeps it put.
  //
  // e2e rather than jsdom, because `position: sticky` is layout: jsdom reports
  // every box at its flow position and would pass this with the property
  // deleted.
  test("the phone front door keeps its header on screen, on paper over the sea", async ({ page }) => {
    await page.setViewportSize({ width: 411, height: 760 });
    await page.goto("/");
    const signIn = page.getByRole("link", { name: "Sign in" });
    await expect(signIn).toBeVisible();
    const atRest = (await signIn.boundingBox())!;

    // **The scroll has to be real.** A front door that could not scroll would
    // pass "the header did not move" for the wrong reason — the same vacuity
    // this suite has been caught by twice elsewhere.
    const scroller = page.getByTestId("phone-front-door");
    await scroller.evaluate((el) => {
      el.scrollTop = el.scrollHeight * 0.5;
    });
    await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(500);

    // Still where it was, rather than merely still in the document: a header
    // that scrolled to y = -400 is `toBeVisible()` to Playwright and gone to a
    // reader.
    const afterScroll = (await signIn.boundingBox())!;
    expect(Math.abs(afterScroll.y - atRest.y), "the header scrolled away with the page").toBeLessThan(2);
    expect(afterScroll.y).toBeLessThan(120);

    // And it is on TOP of the sea: its moments and lit days stand above the
    // scrim, and without a stacking order one would paint over the one
    // control this screen offers somebody who already has an account.
    const onTop = await page.evaluate(() => {
      const link = [...document.querySelectorAll("a")].find((a) => a.textContent?.trim() === "Sign in");
      if (!link) return null;
      const box = link.getBoundingClientRect();
      const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      return hit === link || link.contains(hit);
    });
    expect(onTop, "something is painted over the Sign in link").toBe(true);

    // Paper, not clear: the sea's cards scroll under the bar and must not
    // show through its links. Read as the painted colour, since that is the claim.
    const header = scroller.getByRole("banner");
    await expect.poll(() => header.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe("rgba(0, 0, 0, 0)");
  });

  // PR 516's review: the server packs the phone's sea for an 844px screen,
  // and a shorter one packs it again once mounted, moving pricing up. A hash
  // answered against the server's layout landed 366px past the heading at
  // 390x664, the usual phone with its browser's toolbars showing.
  for (const { width, height } of [
    { width: 390, height: 664 },
    { width: 360, height: 640 },
    { width: 390, height: 844 },
    { width: 430, height: 932 },
  ]) {
    test(`/#pricing lands the pricing heading just under the phone's sticky bar at ${width}x${height}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto("/#pricing");
      const door = page.getByTestId("phone-front-door");
      const bar = door.getByRole("banner");
      // The section opens on its "Pricing · Free → Plus" line, the heading it is named by.
      const heading = door.getByRole("region", { name: "Pricing" });
      await expect(heading).toBeVisible();
      const below = async () => (await heading.boundingBox())!.y - ((await bar.boundingBox())!.y + (await bar.boundingBox())!.height);
      // One poll for both bounds: the first read can come before the scroll,
      // thousands of px down, and a lower bound met then proves nothing.
      await expect
        .poll(async () => {
          const px = Math.round(await below());
          return px >= 0 && px <= 8 ? "just under the bar" : px;
        }, "the pricing heading's top, less the sticky bar's foot, in px")
        .toBe("just under the bar");
    });
  }
});

// `FirstTripStart` (Mitchell, 2026-09-01 — see its own file header) is the
// first authenticated screen for anyone with zero trips, and its four-step
// grid is `sm:grid-cols-2` — collapsed to one column below Tailwind's 640px
// `sm`, a width nothing in this suite exercised (CodeRabbit, PR 104).
//
// Reaching "zero trips" honestly needs a genuinely new account: the shared
// dev user every other test in this file signs in as (`.auth/alice.json`,
// via the narrow project's own `storageState`) has trips from every prior
// spec run. Signed out here for the same reason the landing-page block
// above is, and then signed IN as a one-off `freshUsername()` account, which
// M11a's invite gate admits only with the super code `signInAsDevUser`
// already presents — see that helper's own comment for why dev login goes
// through the gate rather than around it.
test.describe("responsive (new trip sheet, short viewport)", () => {
  // **The sheet has to BE a chat box, not contain one.** Mitchell, on the
  // 5c27d37 preview: *"This is still wrong, the input and decisions are at
  // bototm, and the chat at top, this should look like a chat box"* — anchored
  // to the composer inside the dialog.
  //
  // `Sheet` puts its children in a `flex-1 overflow-y-auto` scrollport, which
  // is a block, so it sizes them to content. `NewTripConversation`'s `flex-1`
  // transcript therefore had nothing to fill: the thread grew the sheet, took
  // the dock down with it, and the composer left the fold as the conversation
  // got longer. §31.3's "original sin", one level up from where it was fixed.
  //
  // This is a layout defect, so it is asserted where layout exists. The
  // invariant §31.3 states is "the transcript scrolls and the dock does not",
  // and its observable form is that **the sheet's own scrollport never has
  // anything to scroll** — the conversation is exactly its height. A short
  // viewport is what makes the broken version overflow deterministically.
  test("the thread scrolls inside the sheet, and the composer stays docked", async ({ page }) => {
    await page.setViewportSize({ width: 420, height: 620 });
    // A trip has to exist, or Home renders the conversation inline instead of
    // in a sheet — that path is bounded by `h-a-thread` and never had this bug.
    await page.request.post("/api/trips", { data: { name: e2eTripName("Dock") } });
    await page.goto("/home");

    await page.getByRole("button", { name: "New trip" }).click();
    const sheet = page.getByRole("dialog", { name: "New trip" });
    await expect(sheet).toBeVisible();

    const scrollport = sheet.getByTestId("sheet-scrollport");
    const thread = sheet.getByRole("log", { name: "Conversation" });

    // Answer the long path — the six-turn one, with the day picker in it — so
    // the thread is as tall as this flow ever gets. A place nobody has
    // published a day for: a city with Playbook days gets an extra turn after
    // it (M27 D13), which would make this walk depend on the shared library.
    // Each click below waits out Cass's typing beat by auto-waiting for the
    // next control to appear — never on a timer.
    await sheet.getByLabel("Where are you going?").fill("Nowhere Bay");
    await sheet.getByRole("button", { name: "Send" }).click();
    await sheet.getByRole("button", { name: "Yes" }).click();
    // `exact`, because Playwright's `getByLabel` is a substring match and the
    // composer on this very turn is labelled "When do you arrive?".
    await sheet.getByLabel("Arrive", { exact: true }).fill("2026-10-03");
    await sheet.getByRole("button", { name: "Use this date" }).click();
    await sheet.getByRole("button", { name: "A week" }).click();
    await sheet.getByRole("button", { name: "Slow" }).click();
    await expect(thread).toContainText("What is the trip about?");

    // The composer is gone on the multi-pick turn, so the control checked here
    // is the one that ends the flow — still the last thing, still on screen.
    const commit = sheet.getByRole("button", { name: "Nothing in particular" });
    await expect(commit).toBeVisible();
    await expect(commit).toBeInViewport();

    // **The sheet does not scroll.** With the bug this overflows by the height
    // of everything the thread added.
    const outer = await scrollport.evaluate((el) => ({ scroll: el.scrollHeight, client: el.clientHeight }));
    expect(outer.scroll, "the sheet scrollport is scrolling — the thread is growing the sheet").toBeLessThanOrEqual(outer.client + 1);

    // …because the thread is the thing that scrolls instead.
    const inner = await thread.evaluate((el) => {
      const port = el.closest("[class*='overflow-y-auto']");
      return port === null ? null : { scroll: port.scrollHeight, client: port.clientHeight };
    });
    expect(inner, "the transcript has no scrollport of its own").not.toBeNull();
    expect(inner!.scroll, "the transcript is not the thing that scrolls").toBeGreaterThan(inner!.client);
  });
});

test.describe("responsive (narrow viewport, first trip)", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("the conversation and both other routes stay visible and operable below sm", async ({ page }) => {
    // Set before signing in, matching this file's own pattern for a
    // breakpoint below the narrow project's own 1100px — 375px is a real
    // phone width, comfortably below the 640px `sm` this grid
    // reflows at.
    await page.setViewportSize({ width: 375, height: 800 });
    await signInAsDevUser(page, freshUsername());

    const card = page.getByTestId("first-trip-start");
    await expect(card).toBeVisible();

    // **The four steps were a numbered list DESCRIBING the questions; the
    // conversation itself is here now** (SPEC §31, 2026-09-18). What this
    // width has to prove is the same thing it always did — that the first-run
    // screen reflows rather than clips — so it is asserted against the parts
    // that exist: the thread, and the field that answers it, both actually on
    // screen rather than merely in the DOM.
    const thread = card.getByRole("log", { name: "Conversation" });
    await expect(thread).toBeVisible();
    await expect(thread).toContainText("Where are you going?");
    const composer = card.getByLabel("Where are you going?");
    await expect(composer).toBeVisible();
    await expect(composer).toBeInViewport();

    // The actions, scoped to the card. Since SPEC §35.2 the page head carries
    // only "New trip", but scoping still says which surface is being measured.
    // The two links are checked for their real destination rather than
    // clicked — clicking either would navigate away from this screen, which is
    // what the composer is checked by doing below instead.
    //
    // *create an empty one* is §35.2's quiet link where the "Create empty"
    // button was, and the empty state's import is its quiet *Have a trip file?
    // Import it*.
    const createEmpty = card.getByRole("button", { name: "create an empty one" });
    const importLink = card.getByRole("button", { name: "Have a trip file? Import it" });
    const playbookLink = card.getByRole("link", { name: "Start from a Playbook" });
    const demoLink = card.getByRole("link", { name: "Look around an example trip" });
    await expect(createEmpty).toBeVisible();
    await expect(importLink).toBeVisible();
    await expect(playbookLink).toBeVisible();
    await expect(playbookLink).toHaveAttribute("href", "/playbooks");
    await expect(demoLink).toBeVisible();
    await expect(demoLink).toHaveAttribute("href", "/demo");

    // Operable, not just visible. Typing an answer at this width has to reach
    // the field — Send only becomes usable once there is something to send,
    // which is what proves the conversation is live rather than painted.
    // (*create an empty one* is live from turn one since M27 D4, and so is no
    // longer the thing that can say so.)
    const send = card.getByRole("button", { name: "Send" });
    await expect(send).toBeDisabled();
    await composer.fill("Reykjavik");
    await expect(send).toBeEnabled();

    // **44px targets at phone width** — SPEC §32.2 draws the new-trip dock with
    // phone-sized controls, and §13.1 is the standing rule they answer to:
    // "44px targets, always". Measured, not read off a class: the class is one
    // way to get there, the rendered height is the thing §13.1 actually asks
    // for, and `toHaveClass` is banned in this suite for exactly that reason.
    for (const [label, control] of [
      ["the answer field", composer],
      ["create an empty one", createEmpty],
      ["the import link", importLink],
      ["a destination chip", card.getByRole("button", { name: "Lisbon" })],
      // The two exits belong in this loop as much as the dock does
      // (CodeRabbit, PR #188). They are `size: "sm"`, which is 28px, and
      // measuring only the controls the dock happened to own made §13.1 hold
      // for those and not for the ones beside them.
      ["the Playbook exit", playbookLink],
      ["the example-trip exit", demoLink],
    ] as const) {
      const box = await control.boundingBox();
      expect(box, `${label} has no box`).not.toBeNull();
      expect(box!.height, `${label} is under the 44px touch floor`).toBeGreaterThanOrEqual(44);
    }
  });
});
