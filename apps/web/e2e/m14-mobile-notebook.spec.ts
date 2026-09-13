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
 * **The inner chip, not the node-view wrapper.** Clicking the wrapper times
 * out: Playwright aims at the centre of its box and the page card underneath
 * takes the hit, because a ProseMirror inline atom's wrapper does not paint the
 * area its bounding box covers. The chip inside is an ordinary `inline-flex`
 * box with a solid hit area, and selecting the node is what a tap anywhere in
 * the widget does regardless of which of the two elements received it.
 */
function widget(page: import("@playwright/test").Page) {
  return page.locator('.tc-page-editor [data-macro-name="cost"]').first().locator("span").first();
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
    await expect(settings.getByRole("button", { name: /: dates/ })).not.toHaveText(/everything/);

    // And it survives the round trip, which is the thing no unit test sees —
    // nor can: jsdom does not turn a click on a node view into a ProseMirror
    // NodeSelection, so the phone inspector has no witness above this layer.
    await page.reload();
    await expect(page.getByRole("heading", { name: "Overview", level: 1 })).toBeVisible();
    await page.getByRole("button", { name: "Edit page" }).click();
    await widget(page).click();
    await expect(
      page.getByTestId("widget-settings").getByRole("button", { name: /: dates/ }),
    ).not.toHaveText(/everything/);
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
    // Left WIDE by the insert, and saying so in one word rather than listing
    // five unset filters (ADR-039 decision 2 — an absent filter is the widest
    // true answer, not an unfilled blank).
    await expect(days).toContainText("everything");
    await days.click();
    await waitForPageSaved(page, () =>
      page.getByRole("group", { name: "Trip days" }).getByRole("button", { name: /Day 3/ }).click(),
    );

    // The control follows the DOCUMENT rather than echoing its own click — the
    // half that was a real defect on desktop (§26, the rebind that closed the
    // panel), asserted here because the phone reaches it through a sheet.
    await expect(
      page.getByTestId("widget-settings").getByRole("button", { name: /: dates/ }),
    ).not.toHaveText(/everything/);
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
