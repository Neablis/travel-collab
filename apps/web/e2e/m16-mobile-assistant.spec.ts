import { expect, test } from "@playwright/test";
import { commandsFor } from "@tc/factories";
import { e2eTripName } from "./tripNames";

// The phone assistant, in a browser at 411×852 — Mitchell's own reported
// device size, run in the "phone" project (playwright.config.ts), the same
// one-project-per-breakpoint pattern responsive.spec.ts uses for "narrow".
//
// THE SHAPE THIS FILE PINS CHANGED ON 2026-09-05, and the history matters
// because the new shape is a reversal of the old one rather than an extension
// of it:
//
//   - KI-84 (PR #88 preview, Mitchell on his own Android phone: "the AI
//     assistant on mobile breaks the entire website, it probably shouldn't be
//     a modal but a full page experience") made the rail a FULL-SCREEN
//     takeover below 768px — `position: fixed; inset: 0` at z-30. Four tests
//     here pinned exactly that: a 411×852 box at (0,0), an in-flow launcher,
//     a typeable composer, and Hide as the only way back.
//   - KI-2026-08-30 made the LAUNCHER an in-flow full-width button at the end
//     of the plan column, because SPEC §13.5 forbids a phone FAB outright.
//   - SPEC §23 (2026-09-05) then specified the phone assistant as an `Ask`
//     pill in the trip header opening a **bottom sheet at `max-height: 80%`**
//     — which is the modal category KI-84 ruled out. Mitchell was shown that
//     conflict and chose to build §23 literally, sheet and all. See
//     `docs/known-issues/open/KI-20260905-aa-…`, which records the decision and
//     why §23's premise ("the phone had no assistant") was itself wrong.
//
// So every test below is the OLD test's purpose re-aimed at the new geometry,
// not a new set of claims. The bugs they were written against are all still
// possible: a floating control over right-aligned costs, a panel that covers
// the whole screen, a composer you cannot type into, and a dismissal that
// leaves the plan stuck. What is genuinely new is the scrim test — DRIFT.md
// build-check 4c, which the full-screen shape had no equivalent for because a
// takeover covered the tab bar by being bigger than it.
test.describe("mobile assistant (phone viewport)", () => {
  // Scoped to the trip header, and it has to be: the phone's plan is the
  // Timeline lens, and every stop on it carries its own `Ask` button (§9's
  // per-stop ask). `getByRole("button", { name: "Ask" })` alone resolved to
  // seven elements on a three-day trip. The pill's own accessible name is
  // deliberately its visible label — see `AskPill` — so the disambiguation
  // belongs here, in the surface it sits in, rather than in a label that
  // disagrees with the word on the control.
  const askPill = (page: import("@playwright/test").Page) =>
    page.locator('header[aria-label="Trip"]').getByRole("button", { name: "Ask", exact: true });

  async function seedTrip(page: import("@playwright/test").Page) {
    const { tripId } = await page.request
      .post("/api/trips", { data: { name: e2eTripName("MobileRail") } })
      .then((r) => r.json());
    for (const command of commandsFor("threeDayTrip", tripId)) {
      await page.request.post(`/api/trips/${tripId}/commands`, { data: command });
    }
    await page.goto(`/trips/${tripId}`);
    return tripId;
  }

  // The launcher half of KI-2026-08-30, re-aimed. SPEC §13.5 is categorical —
  // "Nothing floats over data. No floating action button." — and the old
  // remedy was an in-flow button at the end of the plan column. §23's pill is
  // the same rule answered better: it is in the header's own flow, ABOVE the
  // data rather than after it, and it does not vanish the moment the panel
  // opens. The property being asserted is unchanged: this control is not
  // parked over a scrolling list, and it is a real target.
  test("the entry point is the header's Ask pill: in flow, 44px, and not a FAB (SPEC §13.5/§13.1)", async ({ page }) => {
    await seedTrip(page);

    const pill = askPill(page);
    await expect(pill).toBeVisible();

    // Stated as the spec states it, and asserting "not fixed" rather than
    // "static" so the in-flow presentation stays free to change without this
    // test having an opinion about how.
    const position = await pill.evaluate((el) => getComputedStyle(el).position);
    expect(position).not.toBe("fixed");
    expect(position).not.toBe("absolute");

    const box = await pill.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);

    // The old phone launcher is GONE, not merely moved — two entry points to
    // one panel on a 411px screen is what §23 removes. The desktop pill still
    // exists in the DOM at this width; `hidden` is what keeps it off screen.
    await expect(page.getByRole("button", { name: "Assistant", exact: true })).toBeHidden();

    // And the pill still opens the thing — an entry point that satisfies
    // §13.5 by being inert satisfies nothing.
    await pill.click();
    await expect(page.getByRole("complementary", { name: "Assistant" })).toBeVisible();
  });

  // The direct replacement for "the rail is full-screen, not crushed beside
  // the plan". Its purpose was that the panel has a deliberate, checked
  // geometry rather than whatever the flex row leaves it — which is still the
  // claim; the geometry is now §23's sheet.
  test("the sheet is at most 80% of the viewport, anchored to the bottom, with rounded top corners", async ({ page }) => {
    await seedTrip(page);

    await askPill(page).click();
    const sheet = page.getByRole("complementary", { name: "Assistant" });
    await expect(sheet).toBeVisible();

    const rect = await sheet.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return {
        x: r.x,
        width: r.width,
        height: r.height,
        bottom: r.bottom,
        position: style.position,
        radius: style.borderTopLeftRadius,
        radiusRight: style.borderTopRightRadius,
        radiusBottom: style.borderBottomLeftRadius,
      };
    });

    // Full width, flush to the bottom edge — a sheet, not a card.
    expect(rect.position).toBe("fixed");
    expect(rect.x).toBe(0);
    expect(rect.width).toBe(411);
    expect(rect.bottom).toBe(852);
    // `max-height: 80dvh`. The number is the design's, and the point of
    // asserting it is what it LEAVES: the plan stays visible above the sheet,
    // which is the whole difference between §23 and the KI-84 takeover.
    expect(rect.height).toBeLessThanOrEqual(852 * 0.8);
    expect(rect.height).toBeGreaterThan(0);

    // 18px on the top corners only — it abuts the screen edge on the other
    // three, so rounding them would draw a card floating on nothing.
    expect(rect.radius).toBe("18px");
    expect(rect.radiusRight).toBe("18px");
    expect(rect.radiusBottom).toBe("0px");
  });

  // NEW, and the reason it is new: DRIFT.md build-check 4c. The full-screen
  // shape covered the tab bar by being bigger than the viewport, so there was
  // nothing to test. A sheet that stops at 80% leaves the bar on screen, and a
  // bar you can still tap lets you switch tabs underneath an open conversation
  // — which changes its scope out from under it, the single failure §23's
  // "the pill inherits the surface's scope" exists to prevent.
  //
  // Hit-tested with `elementFromPoint`, the same way the old file's "nothing
  // bleeds through" assertion was: a z-index comparison alone proves nothing
  // if the two are in different stacking contexts, and what the user actually
  // does is put a finger on the tab.
  test("the scrim covers the tab bar: tabs are not tappable behind an open sheet (build-check 4c)", async ({ page }) => {
    await seedTrip(page);

    const planTab = page.getByRole("link", { name: /^Plan/ });
    await expect(planTab).toBeVisible();
    const tabBox = await planTab.boundingBox();
    expect(tabBox).not.toBeNull();

    await askPill(page).click();
    await expect(page.getByRole("complementary", { name: "Assistant" })).toBeVisible();

    const scrim = page.getByTestId("assistant-scrim");
    await expect(scrim).toBeVisible();

    // The tab is still THERE — this is a cover over it, not the bar being
    // unmounted — and it is no longer what a tap at its own centre reaches.
    // What reaches it is the sheet or the scrim; which of the two is not the
    // claim, and pinning it would pin the sheet's content height.
    const onTheTab = await page.evaluate(
      ([x, y]) => {
        const el = document.elementFromPoint(x!, y!);
        if (el === null) return { insideTabBar: false, insideAssistant: false };
        return {
          insideTabBar: el.closest('[aria-label="Phone navigation"]') !== null,
          insideAssistant:
            el.getAttribute("data-testid") === "assistant-scrim" || el.closest('[aria-label="Assistant"]') !== null,
        };
      },
      [tabBox!.x + tabBox!.width / 2, tabBox!.y + tabBox!.height / 2],
    );
    expect(onTheTab.insideTabBar).toBe(false);
    expect(onTheTab.insideAssistant).toBe(true);

    // And the scrim's own half: everything ABOVE the sheet is covered too, so
    // the plan you can still see is not a plan you can still edit. Probed just
    // above the sheet's own top edge, wherever the content puts it.
    const sheetTop = await page.getByRole("complementary", { name: "Assistant" }).evaluate((el) => el.getBoundingClientRect().top);
    expect(sheetTop).toBeGreaterThan(60);
    const abovePlan = await page.evaluate(
      (y) => document.elementFromPoint(205, y)?.getAttribute("data-testid") ?? null,
      sheetTop - 10,
    );
    expect(abovePlan).toBe("assistant-scrim");

    // Scrim above the bar, sheet above the scrim — the ORDER §23 specifies.
    // (The design's own 6/7 do not transfer: this app's bar is z-20 and the
    // takeover tier is 30/31. See `.assistant-sheet` in globals.css.)
    const layers = await page.evaluate(() => {
      const z = (selector: string) => {
        const el = document.querySelector(selector);
        return el === null ? null : Number(getComputedStyle(el).zIndex);
      };
      return {
        bar: z('[aria-label="Phone navigation"]'),
        scrim: z('[data-testid="assistant-scrim"]'),
        sheet: z('[aria-label="Assistant"]'),
      };
    });
    expect(layers.scrim).toBeGreaterThan(layers.bar!);
    expect(layers.sheet).toBeGreaterThan(layers.scrim!);
  });

  test("the composer is clickable and typeable — the reported 'unselectable' input", async ({ page }) => {
    await seedTrip(page);

    await askPill(page).click();
    await expect(page.getByRole("complementary", { name: "Assistant" })).toBeVisible();

    // A real click, deliberately — not `fill()` and not keyboard Enter. The
    // rack/Ask-button bug the `.unscheduled-rack` comment describes survived
    // until someone stopped submitting with Enter; asserting existence alone
    // would miss the same class of bug again. It matters at least as much for
    // the sheet as it did for the takeover: the sheet stops at 80% of the
    // viewport, so there is 20% of other page above it with its own z-index
    // to get wrong.
    const input = page.getByPlaceholder(/Ask about this/);
    await input.click();
    await page.keyboard.type("is this selectable");
    await expect(input).toHaveValue("is this selectable");
  });

  // "Hide is the only way back" is no longer literally true — §23 gives the
  // scrim a tap-to-dismiss as a second ROUTE to the same control — so the
  // purpose is re-aimed rather than dropped: dismissal works, clears the 44px
  // floor, and leaves the plan reachable rather than stuck behind something
  // half-gone. Both routes are exercised, because a scrim that dismisses
  // nothing is a dead layer and a scrim that dismisses without the ✕ working
  // is unreachable by keyboard.
  test("dismissal returns you to the plan, from the ✕ and from the scrim (SPEC §13.1)", async ({ page }) => {
    await seedTrip(page);

    await askPill(page).click();
    const sheet = page.getByRole("complementary", { name: "Assistant" });
    await expect(sheet).toBeVisible();

    // One control, named "Hide" in every presentation; the sheet draws it as
    // an ✕ where the docked rail writes the word.
    const hide = page.getByRole("button", { name: "Hide" });
    const box = await hide.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
    expect(box?.width).toBeGreaterThanOrEqual(44);

    await hide.click();
    await expect(sheet).toBeHidden();
    await expect(page.getByTestId("assistant-scrim")).toBeHidden();

    // The plan is reachable again — not a modal that leaves something stuck.
    //
    // This used to assert the "Day columns" tab was selected. SPEC §10/§16
    // retired that: the phone has two views, not four, so a bare
    // `/trips/<id>` is normalised off Board, and the lens strip is hidden on a
    // phone at all. The assertion's PURPOSE is kept, against the controls a
    // phone actually has: the day rail (§13.4, "the day rail never collapses")
    // and the tab bar, with Plan current.
    await expect(page.getByRole("group", { name: "Days" })).toBeVisible();
    await expect(page.getByRole("link", { name: /^Plan/ })).toHaveAttribute("aria-current", "page");

    // The second route, and the one a thumb reaches first.
    await askPill(page).click();
    await expect(sheet).toBeVisible();
    // Deliberately off the sheet: the scrim fills the viewport, and the top
    // of the screen is the part of it that is definitely not behind the sheet.
    await page.getByTestId("assistant-scrim").click({ position: { x: 205, y: 40 } });
    await expect(sheet).toBeHidden();
    await expect(page.getByRole("group", { name: "Days" })).toBeVisible();
  });
});
