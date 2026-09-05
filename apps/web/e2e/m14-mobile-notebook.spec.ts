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
  await page.getByRole("link", { name: /Trip Overview/ }).click();
  await expect(page.getByRole("heading", { name: "Trip Overview" })).toBeVisible();
  // §19: "Edit / Done editing is one button… There is no separate phone editor
  // screen — the editor is a mode of the page, exactly as on desktop."
  await page.getByRole("button", { name: "Edit page" }).click();
  return tripId;
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
    await expect(sheet).toBeHidden();

    // Narrowed on arrival. A phone insert that landed wide would mean the bind
    // step decided nothing — the failure this walk exists to catch.
    const bound = page.getByRole("button", { name: /^Showing/ });
    await expect(bound).toBeVisible();
    await expect(bound).not.toHaveText(/everything/);

    // And it survives the round trip, which is the thing no unit test sees.
    await page.reload();
    await expect(page.getByRole("heading", { name: "Trip Overview" })).toBeVisible();
    await page.getByRole("button", { name: "Edit page" }).click();
    await expect(page.getByRole("button", { name: /^Showing/ })).not.toHaveText(/everything/);
  });

  test("rebinding is a sheet, and the inline select row is gone", async ({ page }) => {
    await openTripOverview(page);

    await page.getByRole("button", { name: "Insert a widget" }).click();
    const insertSheet = page.getByRole("dialog");
    await insertSheet.getByRole("searchbox", { name: "Search widgets" }).fill("costs");
    await insertSheet.getByRole("button", { name: /What it costs/ }).click();
    await waitForPageSaved(page, () => insertSheet.getByRole("button", { name: "Insert it" }).click());

    // §19's one real divergence: at 390px the desktop chrome row — a name chip
    // plus a select per input, inline — wraps into unreadability, so the phone
    // shows the resolved binding on a 44px button instead. BOTH halves matter:
    // a phone showing the button *and* keeping the select row would be the same
    // binding twice (project rule 4) and would not have fixed the wrapping.
    await expect(page.getByRole("combobox")).toHaveCount(0);
    const bind = page.getByRole("button", { name: /Showing/ });
    await expect(bind).toBeVisible();
    expect((await bind.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    // Left WIDE by the insert, and saying so in one word rather than listing
    // five unset filters (ADR-039 decision 2 — an absent filter is the widest
    // true answer, not an unfilled blank).
    await expect(bind).toContainText("everything");

    await bind.click();
    const bindSheet = page.getByRole("dialog");
    // The sentence §19 asks for, because the page-scope model is recent enough
    // that someone may still expect one control to move every widget.
    await expect(bindSheet).toContainText("This widget only");
    await bindSheet.getByRole("button", { name: /dates/i }).click();
    await waitForPageSaved(page, () =>
      page.getByRole("group", { name: "Trip days" }).getByRole("button", { name: /Day 3/ }).click(),
    );
    await page.keyboard.press("Escape");
    await bindSheet.getByRole("button", { name: "Close" }).click();

    // The button follows the document rather than being a label written once.
    await expect(page.getByRole("button", { name: /^Showing/ })).not.toHaveText(/everything/);
  });

  test("Reading is the default, and it takes the phone's authoring surface away too", async ({ page }) => {
    const tripId = await openTripOverview(page);
    await page.getByRole("button", { name: "Done editing" }).click();

    // §18/§19: Reading is the traveller's view on both surfaces. No insert
    // affordance, and no bind buttons — the same rule the desktop walk pins,
    // asserted here because the phone reaches it through different components.
    await expect(page.getByRole("button", { name: "Insert a widget" })).toBeHidden();
    await expect(page.getByRole("button", { name: /Showing/ })).toHaveCount(0);

    // And a fresh load opens in Reading, rather than the toggle merely having
    // been flipped in this session.
    await page.goto(`/trips/${tripId}/pages`);
    await page.getByRole("link", { name: /Trip Overview/ }).click();
    await expect(page.getByRole("button", { name: "Edit page" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Insert a widget" })).toBeHidden();
  });
});
