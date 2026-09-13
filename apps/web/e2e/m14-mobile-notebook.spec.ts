import { expect, test } from "@playwright/test";
import { commandsFor } from "@tc/factories";
import { e2eTripName } from "./tripNames";

// The phone Notebook — design handoff 2026-09-03, `SPEC.md` §19, `DRIFT.md`
// §2f. Runs in the "phone" project (playwright.config.ts, 411×852), the same
// one-project-per-breakpoint pattern `m16-mobile-assistant.spec.ts` uses.
//
// **The model is identical and the density is not**, which is exactly what
// these walks are for. §2f: *"This adds no API surface. Everything §2e asks for
// already covers it… What the client owes on top is layout only."* So the
// interesting claims are the two divergences §19 names — the bind sheet and the
// two-step insert sheet — plus the one thing no unit test can prove: that a
// widget bound on a phone is still bound after a reload.
//
// The trip is seeded through the API rather than by clicking, for the reason
// the mobile assistant spec seeds its own: the board's phone layout is not what
// is under test here, and walking it would make every failure ambiguous.
async function openTripOverview(page: import("@playwright/test").Page): Promise<string> {
  const { tripId } = await page.request
    .post("/api/trips", { data: { name: e2eTripName("PhoneNotebook") } })
    .then((r) => r.json());
  for (const command of commandsFor("threeDayTrip", tripId)) {
    await page.request.post(`/api/trips/${tripId}/commands`, { data: command });
  }
  await page.goto(`/trips/${tripId}/pages`);
  await page.getByRole("link", { name: /Overview/ }).first().click();
  await expect(page.getByRole("heading", { name: "Overview", level: 1 })).toBeVisible();
  // §19: "Edit / Done editing is one button… There is no separate phone editor
  // screen — the editor is a mode of the page, exactly as on desktop."
  await page.getByRole("button", { name: "Edit page" }).click();
  return tripId;
}

/**
 * The inserted widget, in the document.
 *
 * Tapping it is how the phone opens its settings since SPEC §26 — the bind
 * button that used to sit in the prose ("Showing …") is gone, along with the
 * inline select row before it, because §26 moved every widget control out of
 * the document and into a side channel. On a phone that channel is a sheet.
 *
 * **The rendered chip, not the node-view wrapper and not the handle.** Two
 * things have to be stepped around, and both were found by watching this time
 * out rather than by reading the markup:
 *
 * The WRAPPER cannot be clicked. Playwright aims at the centre of its box and
 * the page card underneath takes the hit — a ProseMirror inline atom's wrapper
 * does not paint the area its bounding box covers.
 *
 * The HANDLE is the wrapper's first child span, and it is `position: absolute;
 * top: -14px; pointer-events: none` (§26's ▸ affordance, which must not
 * displace the line above it). So it is unclickable by construction, sits
 * OUTSIDE the widget, and on a short page ends up under the sticky header —
 * which is what the second round of this timeout named.
 *
 * What is left is the widget's own rendered output: an ordinary `inline-flex`
 * chip with a solid hit area. Selecting the node is what a tap anywhere in the
 * widget does, so which element receives it does not change the claim.
 *
 * **`.first()` is the INSERTED one, and that is load-bearing rather than
 * incidental.** The seeded Overview carries a `cost` of its own under "What it
 * costs" (2026-09-13), so there are two on the page. `openTripOverview` never
 * places a caret, and `insertAtCursor` inserts at the editor's default
 * selection — the start of the document — so this walk's widget lands ahead of
 * everything the template seeded. Picking the seeded one instead would not fail
 * loudly: it is wide and unbound, so "the bind control reads All days" would
 * pass for entirely the wrong reason.
 */
function widget(page: import("@playwright/test").Page) {
  return page
    .locator('.tc-page-editor [data-macro-name="cost"]')
    .first()
    .locator('span:not([data-testid="widget-handle"])')
    .first();
}

async function waitForPageSaved(
  page: import("@playwright/test").Page,
  action: () => Promise<unknown>,
): Promise<void> {
  await Promise.all([
    page.waitForResponse(
      (r) =>
        /\/api\/trips\/[^/]+\/pages\/[^/]+$/.test(new URL(r.url()).pathname) &&
        r.request().method() === "PATCH" &&
        r.ok(),
    ),
    action(),
  ]);
}

test.describe("phone Notebook (SPEC §19)", () => {
  test("insert is one sheet with a bind step, and the widget lands already pointed", async ({ page }) => {
    await openTripOverview(page);

    await page.getByRole("button", { name: "Insert a widget" }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();

    // Step 1, browse. Same registry, same order, same copy as desktop (§19).
    await sheet.getByRole("searchbox", { name: "Search widgets" }).fill("costs");
    await sheet.getByRole("button", { name: /What it costs/ }).click();

    // Step 2, point it at — a STEP INSIDE THE SAME SHEET, not a sheet over a
    // sheet (project rule 3, restated by §19 as "one sheet deep, ever"). One
    // dialog on screen is the assertion that says so.
    await expect(page.getByRole("dialog")).toHaveCount(1);
    // The DAYS control by name: a primitive declares several (ADR-039 decision
    // 1), so "the control in the sheet" is no longer one thing.
    const days = sheet.getByRole("button", { name: /dates/i });
    await expect(days).toBeVisible();
    // §13 rule 1's 44px floor, on the control the whole step exists for.
    expect((await days.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    await days.click();
    await page.getByRole("group", { name: "Trip days" }).getByRole("button", { name: /Day 2/ }).click();
    await page.keyboard.press("Escape");

    await waitForPageSaved(page, () => sheet.getByRole("button", { name: "Insert it" }).click());

    // **The sheet closes and NOTHING opens behind it**, which is §19's "one
    // sheet deep, ever" applied to the moment after an insert rather than
    // during one. The desktop selects what it inserted so its side column has
    // something to show (§26); the phone has no side column, and its insert
    // has already asked the bind question — so selecting here would answer the
    // user by reopening the question. Asserted as "no dialog at all" rather
    // than "this sheet is hidden", because the failure it caught was a
    // DIFFERENT dialog taking its place under the same locator.
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // Narrowed on arrival. A phone insert that landed wide would mean the bind
    // step decided nothing — the failure this walk exists to catch.
    //
    // Read through the inspector, which is where §26 put the binding: the
    // "Showing …" button this used to assert on was a control in the document
    // flow, and §26's whole point is that there is no longer one. Tapping the
    // widget is how a person opens it.
    await widget(page).click();
    const settings = page.getByTestId("widget-settings");
    // Narrow, stated as "not the wide value" rather than as a date: the seeded
    // trip's days are relative to today. "All days" is what this control reads
    // when nothing is bound — see the rebinding walk below.
    await expect(settings.getByRole("button", { name: /: dates/ })).not.toHaveText("All days");

    // And it survives the round trip, which is the thing no unit test sees —
    // nor can: jsdom does not turn a click on a node view into a ProseMirror
    // NodeSelection, so the phone inspector has no witness above this layer.
    await page.reload();
    await expect(page.getByRole("heading", { name: "Overview", level: 1 })).toBeVisible();
    await page.getByRole("button", { name: "Edit page" }).click();
    await widget(page).click();
    await expect(
      page.getByTestId("widget-settings").getByRole("button", { name: /: dates/ }),
    ).not.toHaveText("All days");
  });

  test("rebinding is a sheet, and the inline select row is gone", async ({ page }) => {
    await openTripOverview(page);

    await page.getByRole("button", { name: "Insert a widget" }).click();
    const insertSheet = page.getByRole("dialog");
    await insertSheet.getByRole("searchbox", { name: "Search widgets" }).fill("costs");
    await insertSheet.getByRole("button", { name: /What it costs/ }).click();
    await waitForPageSaved(page, () => insertSheet.getByRole("button", { name: "Insert it" }).click());

    // §19's divergence was that at 390px the desktop chrome row — a name chip
    // plus a select per input, inline — wraps into unreadability, so the phone
    // showed the resolved binding on a 44px button instead. **SPEC §26 finished
    // the job on both surfaces**: there is no chrome row anywhere now, and the
    // phone's 44px button went with it, because it was still a widget control
    // living in the prose. So the document carries NEITHER — the select row the
    // phone treatment replaced, and the button that replaced it.
    await expect(page.getByRole("combobox")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Showing/ })).toHaveCount(0);
    // And nothing is open: a widget's settings appear because you selected it,
    // not because it exists.
    await expect(page.getByTestId("widget-settings")).toHaveCount(0);

    // Tapping the widget is the phone's way into the side channel.
    await widget(page).click();
    const bindSheet = page.getByRole("dialog");
    await expect(bindSheet).toBeVisible();
    // The sentence §19 asks for, because the page-scope model is recent enough
    // that someone may still expect one control to move every widget.
    await expect(bindSheet).toContainText("This widget only");
    const days = bindSheet.getByRole("button", { name: /: dates/ });
    // §13 rule 1's 44px floor, on the control the sheet exists for.
    expect((await days.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    // Left WIDE by the insert, and saying so in one phrase rather than listing
    // five unset filters (ADR-039 decision 2 — an absent filter is the widest
    // true answer, not an unfilled blank).
    //
    // "All days" is the DATE CONTROL's own word for wide. "everything" was
    // `bindSummary`'s, written for the "Showing …" button §26 deleted — it
    // summarised every dimension at once, where this control answers one. The
    // desktop walk asserts the same string on the same control.
    await expect(days).toHaveText("All days");
    await days.click();
    await waitForPageSaved(page, () =>
      page.getByRole("group", { name: "Trip days" }).getByRole("button", { name: /Day 3/ }).click(),
    );

    // The control follows the DOCUMENT rather than echoing its own click — the
    // half that was a real defect on desktop (§26, the rebind that closed the
    // panel), asserted here because the phone reaches it through a sheet.
    await expect(
      page.getByTestId("widget-settings").getByRole("button", { name: /: dates/ }),
    ).not.toHaveText("All days");
  });

  test("Reading is the default, and it takes the phone's authoring surface away too", async ({ page }) => {
    const tripId = await openTripOverview(page);
    await page.getByRole("button", { name: "Done editing" }).click();

    // §18/§19: Reading is the traveller's view on both surfaces. No insert
    // affordance, and no bind buttons — the same rule the desktop walk pins,
    // asserted here because the phone reaches it through different components.
    await expect(page.getByRole("button", { name: "Insert a widget" })).toBeHidden();
    // The settings side channel, not the bind button: §26 removed that button
    // from both modes, so asserting its absence here says nothing about
    // Reading any more — it would be green in Editing too. The panel is the
    // control surface that still exists, and Reading owes its absence.
    //
    // Not asserted by TAPPING a widget first, which would be the stronger
    // claim: this walk never inserts one, and the page it opens carries only
    // the seeded `open` block. Selecting-does-not-open-settings in Reading is
    // `PageScreen.test.tsx`'s to prove, where the mode is a prop.
    await expect(page.getByTestId("widget-settings")).toHaveCount(0);

    // And a fresh load opens in Reading, rather than the toggle merely having
    // been flipped in this session.
    await page.goto(`/trips/${tripId}/pages`);
    await page.getByRole("link", { name: /Overview/ }).first().click();
    await expect(page.getByRole("button", { name: "Edit page" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Insert a widget" })).toBeHidden();
  });
});

/**
 * The two things §26's phone treatment owes that nothing else was watching —
 * both asked for by CodeRabbit on PR 170, and the second one is Mitchell's own
 * preview note with a number attached.
 */
test.describe("the phone's widget affordances have geometry (SPEC §26)", () => {
  test("the settings sheet closes, and the selection goes with it", async ({ page }) => {
    await openTripOverview(page);

    await page.getByRole("button", { name: "Insert a widget" }).click();
    const list = page.getByRole("dialog");
    await list.getByRole("searchbox", { name: "Search widgets" }).fill("costs");
    await list.getByRole("button", { name: /What it costs/ }).click();
    await waitForPageSaved(page, () => list.getByRole("button", { name: "Insert it" }).click());

    await widget(page).click();
    await expect(page.getByTestId("widget-settings")).toBeVisible();

    // **`PageScreen` clears the selection on `onOpenChange(false)`, and nothing
    // else does.** The sheet is a CONTROLLED dialog — its `open` is
    // `selectedWidget !== null` — so a regression that drops that one line
    // leaves the sheet impossible to dismiss: Radix closes it, React reopens
    // it on the next render, and the walks above would all still pass because
    // none of them ever tries to close it.
    await page.getByRole("dialog").getByRole("button", { name: /close/i }).click();
    await expect(page.getByTestId("widget-settings")).toHaveCount(0);
    // And it STAYS shut, rather than being reopened by the render that follows.
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("the Overview offers no Delete in the index, and no day bar on the trip screen", async ({ page }) => {
    const tripId = await openTripOverview(page);
    await page.getByRole("button", { name: "Done editing" }).click();

    // **No Delete on the row for a page that cannot be deleted.** Mitchell, on
    // the preview: *"should not have a delete button for the overview notebook
    // for a trip since it's not deletable"*. The server has refused this since
    // §25 — in the DELETE's own `WHERE` clause — so the control produced a
    // message rather than a loss, which is still a control that always says no.
    await page.goto(`/trips/${tripId}/pages`);
    const mine = page.getByRole("region", { name: "Your notebooks" });
    await expect(mine.getByRole("listitem")).toHaveCount(1);
    // Named per row, so this is the Overview's own button rather than any.
    await expect(mine.getByRole("button", { name: /^Delete / })).toHaveCount(0);

    // **And the day bar is gone from the phone's Overview**: *"in mobile, hide
    // the day bar here, leave on desktop"*. Asserted as absent from the TREE,
    // not merely hidden — `DayChips` renders one focusable button per day, and
    // `display: none` would leave a screen reader fourteen controls to walk
    // past on a page none of them narrows.
    //
    // By URL rather than by tab, and the witness is the page body rather than a
    // heading: SPEC §10 hides the four-view strip below 768px — the phone's two
    // in-trip destinations stand for it — so there is no "Overview" tab to
    // click and no `h1` on this route (the notebook's own title lives one route
    // down, on `/pages/:id`). A bare `/trips/:id` resolves to Overview, and
    // what it renders is the seeded page.
    await page.goto(`/trips/${tripId}`);
    await expect(page.locator(".tc-page-editor")).toBeVisible();
    await expect(page.getByRole("group", { name: "Days" })).toHaveCount(0);

    // Still there on Plan, which is the half that makes the claim a scope
    // rather than a deletion: the row narrows the day columns, and the phone
    // keeps it where it does something.
    await page.goto(`/trips/${tripId}?view=Plan`);
    await expect(page.getByRole("group", { name: "Days" })).toBeVisible();
  });

  test("the edit handle sits in the gap above its widget, not on the line before it", async ({ page }) => {
    await openTripOverview(page);

    // A new paragraph at the END of the document, so the block above the
    // widget is an ordinary paragraph — which is where Mitchell hit this
    // (`p:nth-of-type(7)` in his report) and where the clearance is decided by
    // the 12px block gap rather than by a heading's tighter margin.
    await page.locator(".tc-page-editor").click();
    await page.keyboard.press("Control+End");
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: "Insert a widget" }).click();
    const list = page.getByRole("dialog");
    await list.getByRole("searchbox", { name: "Search widgets" }).fill("costs");
    await list.getByRole("button", { name: /What it costs/ }).click();
    await waitForPageSaved(page, () => list.getByRole("button", { name: "Insert it" }).click());

    // Measured from the handle of the widget that just landed, against the
    // block that precedes it in the document. `-14px` of overhang into a 12px
    // gap is what *"the indicator to show you can edit it is too much on top of
    // text"* was: two pixels of the marker sitting on the previous line.
    // Red-checked by putting `-14px` back — `expected >= 224.046875, received
    // 222.046875`, which is that overhang measured rather than reasoned about.
    const geometry = await page.evaluate(() => {
      const handles = [...document.querySelectorAll('[data-testid="widget-handle"]')];
      const handle = handles.at(-1);
      if (handle === undefined) return null;
      const block = handle.closest(".tc-page-editor > .tiptap > *");
      const previous = block?.previousElementSibling ?? null;
      if (previous === null) return null;
      const h = handle.getBoundingClientRect();
      return {
        handleTop: h.top,
        handleHeight: h.height,
        previousBottom: previous.getBoundingClientRect().bottom,
        // The marker must never eat the tap that selects the widget (§26 makes
        // the block itself the target), so this rides along with the geometry.
        pointerEvents: getComputedStyle(handle).pointerEvents,
      };
    });
    expect(geometry, "the inserted widget draws a handle with a block above it").not.toBeNull();
    expect(geometry!.handleTop, "the handle overhangs onto the block above it").toBeGreaterThanOrEqual(
      geometry!.previousBottom,
    );
    // And it is a real marker rather than a zero-height one that trivially
    // clears everything.
    expect(geometry!.handleHeight).toBeGreaterThan(0);
    expect(geometry!.pointerEvents).toBe("none");
  });
});
